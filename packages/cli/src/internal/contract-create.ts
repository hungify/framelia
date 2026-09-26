import * as path from "node:path";

import {
  CONTRACT_FORMAT_VERSION,
  authoredContractSchema,
  type Diagnostic,
} from "@framelia/contracts/workflow";
import {
  AppError,
  assertProjectRelativePath,
  assertRawFileState,
  canonicalJsonDigest,
  publishBaselineSnapshot,
  readRawFileState,
  stageFigmaBaseline,
  withAuthoringLock,
  writeAuthoredContract,
  type CanonicalJsonValue,
  type FetchBaselineFn,
} from "@framelia/verify";
import {
  inspectAuthoredContracts,
  type DiscoveredAuthoredContract,
  type InvalidAuthoredContract,
} from "@framelia/verify/project-policy";

import type { CliRuntime } from "../runtime-types.ts";
import {
  collectContractAnswers,
  type ContractCreateOptions,
  type ContractInterviewDependencies,
} from "./contract-interview.ts";
import { contractListCommand } from "./contract-list.ts";
import { optionalFigmaToken } from "./figma-token.ts";
import type { PlaywrightTransportDependencies } from "./playwright-collection.ts";
import { openProject } from "./project.ts";
import type { PromptAdapter } from "./prompts.ts";

export type { ContractCreateOptions } from "./contract-interview.ts";

const AUTHORING_OUTCOME_FORMAT_VERSION = 1 as const;

export interface ContractCreateDependencies
  extends Partial<ContractInterviewDependencies>, PlaywrightTransportDependencies {
  fetchBaseline?: FetchBaselineFn;
}

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
  readonly next?: { command: string; argv: string[] };
}

export interface ContractCreateResult {
  readonly ok: boolean;
  readonly exitCode: 0 | 2;
  readonly body: ContractCreateOutcome;
}

function portablePath(root: string, filePath: string): string {
  return path.relative(root, filePath).split(path.sep).join("/");
}

function diagnostic(error: unknown): Diagnostic {
  const code = error instanceof AppError ? error.code : "CONTRACT_AUTHORING_FAILED";
  return {
    code,
    stage: "authoring",
    message: error instanceof Error ? error.message : String(error),
  };
}

function failed(error: unknown): ContractCreateResult {
  return {
    ok: false,
    exitCode: 2,
    body: {
      formatVersion: AUTHORING_OUTCOME_FORMAT_VERSION,
      kind: "framelia.contract-create-outcome",
      command: "contract create",
      executionState: "error",
      exitCode: 2,
      authored: false,
      runnable: false,
      diagnostics: [diagnostic(error)],
    },
  };
}

function assertInspectionValid(invalid: readonly InvalidAuthoredContract[]): void {
  if (invalid.length === 0) return;
  const details = invalid.map((entry) => `${entry.code}: ${entry.message}`).join("; ");
  throw new Error(`Contract discovery must be repaired before authoring: ${details}`);
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

function registrationRecipe(contractPath: string): string {
  return [
    'import path from "node:path";',
    'import { defineFigmaTests } from "@framelia/playwright";',
    'import { test } from "@playwright/test";',
    `defineFigmaTests(test, { contracts: path.join(process.cwd(), ${JSON.stringify(contractPath)}),`,
    "  async prepare({ page }, { target }) {",
    "    await page.goto(target.path);",
    "    // Await this application's real scenario readiness before returning.",
    "  },",
    "});",
  ].join("\n");
}

/** Resolves every input and acquires a complete snapshot before the first project write. */
export async function contractCreateCommand(
  options: ContractCreateOptions,
  prompts: PromptAdapter,
  runtime: CliRuntime,
  dependencies: ContractCreateDependencies = {},
): Promise<ContractCreateResult> {
  prompts.intro("Create Framelia visual contract");
  try {
    const project = openProject(options.projectRoot, runtime);
    const policy = await project.loadConfig();
    const inspection = await inspectAuthoredContracts(policy);
    const configBefore = policy.configPath ? readRawFileState(policy.configPath) : undefined;
    assertInspectionValid(inspection.invalid);

    const interviewDependencies =
      dependencies.resolveNodeSpec && dependencies.deriveExpectStyle
        ? {
            resolveNodeSpec: dependencies.resolveNodeSpec,
            deriveExpectStyle: dependencies.deriveExpectStyle,
          }
        : undefined;
    const interview = await collectContractAnswers(
      options,
      prompts,
      runtime,
      interviewDependencies,
    );
    if (interview.kind === "cancelled") {
      throw new Error("Contract authoring was cancelled.");
    }

    const existing = inspection.contracts.find(
      (entry) => entry.contract.id === interview.answers.contractId,
    );
    if (existing && !options.force) {
      throw new Error(
        `Contract ${interview.answers.contractId} already exists at ${existing.file}. Pass --force to replace that exact ID after review.`,
      );
    }
    const outputPath = selectTarget(project.root, options, existing, interview.answers.contractId);
    const before = readRawFileState(outputPath);
    if (before.exists && !existing) {
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
    const staged = await stageFigmaBaseline({
      source: interview.answers.baseline,
      viewport: provisional.viewport,
      scope: provisional.scope,
      token: optionalFigmaToken(runtime),
      ...(dependencies.fetchBaseline ? { fetchBaseline: dependencies.fetchBaseline } : {}),
    });
    const contract = authoredContractSchema.parse({
      ...provisional,
      baseline: { snapshotDigest: staged.snapshotDigest },
    });
    const contractDigest = canonicalJsonDigest(contract as CanonicalJsonValue);

    await withAuthoringLock(project.root, async () => {
      assertRawFileState(outputPath, before);
      if (policy.configPath && configBefore) {
        assertRawFileState(policy.configPath, configBefore);
      }
      const latest = await inspectAuthoredContracts(policy);
      assertInspectionValid(latest.invalid);
      const latestOwner = latest.contracts.find((entry) => entry.contract.id === contract.id);
      if (existing) {
        if (
          latestOwner?.file !== existing.file ||
          latestOwner.digest !== existing.digest ||
          portablePath(project.root, outputPath) !== existing.file
        ) {
          throw new AppError(
            "AUTHORING_CONFLICT",
            `Contract ${contract.id} changed while baseline acquisition was in progress.`,
          );
        }
      } else if (latestOwner) {
        throw new AppError(
          "AUTHORING_CONFLICT",
          `Contract ${contract.id} was created concurrently at ${latestOwner.file}.`,
        );
      }
      await publishBaselineSnapshot(project.root, contract, staged);
      writeAuthoredContract(outputPath, contract);
    });

    const relativePath = portablePath(project.root, outputPath);
    const listed = await contractListCommand({ projectRoot: project.root }, runtime, dependencies);
    const bindings = listed.body.contracts.filter((entry) => entry.contractId === contract.id);
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
    prompts.note(`Wrote ${relativePath} and pinned ${staged.snapshotDigest}.`, "Contract authored");
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
          snapshotDigest: staged.snapshotDigest,
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
        next: runnable
          ? {
              command: "framelia",
              argv: [
                "check",
                "--contract",
                contract.id,
                ...(options.projectRoot ? ["--project-root", options.projectRoot] : []),
              ],
            }
          : {
              command: "framelia",
              argv: [
                "contract",
                "list",
                ...(options.projectRoot ? ["--project-root", options.projectRoot] : []),
              ],
            },
      },
    };
  } catch (error) {
    return failed(error);
  }
}
