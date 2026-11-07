import * as path from "node:path";

import {
  CONTRACT_FORMAT_VERSION,
  authoredContractSchema,
  type Diagnostic,
  type NextOperation,
} from "@framelia/contracts/workflow";
import {
  assertProjectRelativePath,
  portableErrorMessage,
  readRawFileState,
} from "@framelia/verify";
import type { DiscoveredAuthoredContract } from "@framelia/verify/project-policy";

import type { CommandEnvironment } from "../environment.ts";
import type { CliRuntime } from "../runtime-types.ts";
import { registrationRecipe } from "./binding-reconciliation.ts";
import { collectContractAnswers, type ContractCreateOptions } from "./contract-interview.ts";
import { listContractBindings } from "./contract-list.ts";
import { openContractPinning } from "./contract-pinning.ts";
import { explainFigmaFailure, optionalFigmaToken } from "./figma-token.ts";
import { failureDiagnostic, failureOutcome, frameliaNext } from "./outcome.ts";
import { openProject } from "./project.ts";

export type { ContractCreateOptions } from "./contract-interview.ts";

const AUTHORING_OUTCOME_FORMAT_VERSION = 1 as const;

export interface ContractCreateOutcome {
  readonly formatVersion: typeof AUTHORING_OUTCOME_FORMAT_VERSION;
  readonly kind: "framelia.contract-create-outcome";
  readonly command: "contract create";
  readonly executionState: "completed" | "error";
  readonly exitCode: 0 | 2;
  readonly authored: boolean;
  readonly runnable: boolean;
  readonly contract?: {
    id: string;
    path: string;
    digest: `sha256:${string}`;
    revision: number;
    snapshotDigest: `sha256:${string}`;
  };
  readonly outcome?: "created" | "replaced";
  readonly diagnostics: Diagnostic[];
  readonly registration?: {
    status: "unbound" | "collection-blocked";
    recipe: string;
  };
  readonly next?: NextOperation;
}

export interface ContractCreateResult {
  readonly ok: boolean;
  readonly exitCode: 0 | 2;
  readonly body: ContractCreateOutcome;
}

function portablePath(root: string, filePath: string): string {
  return path.relative(root, filePath).split(path.sep).join("/");
}

function failed(
  error: unknown,
  runtime: CliRuntime,
  projectRoot: string | undefined,
): ContractCreateResult {
  const failure = failureOutcome({
    kind: "framelia.contract-create-outcome",
    command: "contract create",
    error: explainFigmaFailure(error, runtime),
    fallbackCode: "CONTRACT_AUTHORING_FAILED",
    stage: "authoring",
    projectRoot,
  });
  return { ...failure, body: { ...failure.body, authored: false, runnable: false } };
}

function selectTarget(
  root: string,
  options: ContractCreateOptions,
  existing: DiscoveredAuthoredContract | undefined,
  contractId: string,
): string {
  const requested = options.output ?? `.framelia/contracts/${contractId}/visual-contract.json`;
  assertProjectRelativePath(root, requested, "contract output path");
  const requestedAbsolute = path.resolve(root, requested);
  if (existing) {
    const existingAbsolute = path.resolve(root, existing.file);
    if (options.output !== undefined && requestedAbsolute !== existingAbsolute) {
      throw new Error(
        `Contract ${existing.contract.id} already exists at ${existing.file}; --force replaces that exact globally unique ID and cannot move it through --output.`,
      );
    }
    return existingAbsolute;
  }
  return requestedAbsolute;
}

/** Resolves every input and acquires a complete snapshot before the first project write. */
export async function contractCreateCommand(
  options: ContractCreateOptions,
  env: CommandEnvironment,
): Promise<ContractCreateResult> {
  const runtime = env.process;
  const prompts = await env.adapters.prompts(runtime);
  prompts.intro("Create Framelia visual contract");
  try {
    const project = openProject(options.projectRoot, runtime);
    const policy = await project.loadConfig();
    const pinning = await openContractPinning(policy);

    const figma = await env.adapters.figma();
    const interview = await collectContractAnswers(options, prompts, runtime, figma);
    if (interview.kind === "cancelled") {
      throw new Error("Contract authoring was cancelled.");
    }

    const existing = pinning.contracts.find(
      (entry) => entry.contract.id === interview.answers.contractId,
    );
    if (existing && !options.force) {
      throw new Error(
        `Contract ${interview.answers.contractId} already exists at ${existing.file}. Pass --force to replace that exact ID after review.`,
      );
    }
    const outputPath = selectTarget(project.root, options, existing, interview.answers.contractId);
    if (readRawFileState(outputPath).exists && !existing) {
      throw new Error(
        `${portablePath(project.root, outputPath)} already exists but does not own contract ${interview.answers.contractId}; it is never overwritten, even with --force.`,
      );
    }

    const provisional = authoredContractSchema.parse({
      ...existing?.contract,
      formatVersion: CONTRACT_FORMAT_VERSION,
      kind: "framelia.contract",
      id: interview.answers.contractId,
      name: interview.answers.name,
      revision: (existing?.contract.revision ?? 0) + 1,
      target: { path: interview.answers.targetPath },
      viewport: interview.answers.viewport,
      scope: interview.answers.scope,
      baseline: { snapshotDigest: `sha256:${"0".repeat(64)}` },
      required: existing?.contract.required ?? true,
    });
    const {
      contract,
      digest: contractDigest,
      snapshotDigest,
    } = await pinning.pin({
      contractPath: outputPath,
      existing,
      draft: provisional,
      source: interview.answers.baseline,
      token: optionalFigmaToken(runtime),
      fetchBaseline: figma.fetchBaseline,
    });

    const relativePath = portablePath(project.root, outputPath);
    // The contract is already authored; a binding-inspection failure only blocks `runnable`.
    const bindings = await listContractBindings(policy, env).then(
      (listed) => listed.entries.filter((entry) => entry.contractId === contract.id),
      (error: unknown) => [
        {
          contractPath: relativePath,
          status: "invalid" as const,
          diagnostics: [
            failureDiagnostic(
              error,
              "CONTRACT_LIST_FAILED",
              "binding",
              portableErrorMessage(error, project.root),
            ),
          ],
        },
      ],
    );
    const runnable =
      bindings.length > 0 && bindings.every((entry) => entry.status === "executable");
    const bindingDiagnostics = runnable
      ? []
      : bindings.flatMap((entry) => entry.diagnostics).length > 0
        ? bindings.flatMap((entry) => entry.diagnostics)
        : [
            {
              code: "CONTRACT_UNBOUND",
              stage: "binding",
              message: `Authored ${contract.id}; register ${relativePath} with defineFigmaTests before check can execute it.`,
            },
          ];
    const unbound = bindingDiagnostics.some((entry) => entry.code === "CONTRACT_UNBOUND");
    prompts.note(`Wrote ${relativePath} and pinned ${snapshotDigest}.`, "Contract authored");
    prompts.outro(
      runnable
        ? "The application scenario is registered and executable."
        : "Register the application scenario, then run framelia contract list.",
    );
    return {
      ok: true,
      exitCode: 0,
      body: {
        formatVersion: AUTHORING_OUTCOME_FORMAT_VERSION,
        kind: "framelia.contract-create-outcome",
        command: "contract create",
        executionState: "completed",
        exitCode: 0,
        authored: true,
        runnable,
        contract: {
          id: contract.id,
          path: relativePath,
          digest: contractDigest,
          revision: contract.revision,
          snapshotDigest: snapshotDigest,
        },
        outcome: existing ? "replaced" : "created",
        diagnostics: bindingDiagnostics,
        ...(!runnable
          ? {
              registration: {
                status: unbound ? ("unbound" as const) : ("collection-blocked" as const),
                recipe: registrationRecipe(relativePath),
              },
            }
          : {}),
        next: frameliaNext(
          runnable ? ["check", "--contract", contract.id] : ["contract", "list"],
          options.projectRoot,
        ),
      },
    };
  } catch (error) {
    return failed(error, runtime, options.projectRoot);
  }
}
