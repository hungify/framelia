import * as path from "node:path";

import { authoredContractSchema, type Diagnostic } from "@framelia/contracts/workflow";
import {
  AppError,
  assertRawFileState,
  canonicalJsonDigest,
  publishBaselineSnapshot,
  readPinnedBaseline,
  readRawFileState,
  stageFigmaBaseline,
  withAuthoringLock,
  writeAuthoredContract,
  type CanonicalJsonValue,
  type FetchBaselineFn,
} from "@framelia/verify";
import { inspectAuthoredContracts } from "@framelia/verify/project-policy";

import type { CliResult } from "../output.ts";
import type { CliRuntime } from "../runtime-types.ts";
import { optionalFigmaToken } from "./figma-token.ts";
import { openProject } from "./project.ts";

const REFRESH_OUTCOME_FORMAT_VERSION = 1 as const;

export interface ContractRefreshBaselineOptions {
  readonly projectRoot: string | undefined;
  readonly contract: string | undefined;
}

export interface ContractRefreshBaselineDependencies {
  readonly fetchBaseline?: FetchBaselineFn;
  readonly afterSnapshotPublished?: () => void;
}

export interface ContractRefreshBaselineOutcome {
  readonly formatVersion: typeof REFRESH_OUTCOME_FORMAT_VERSION;
  readonly kind: "framelia.contract-refresh-baseline-outcome";
  readonly command: "contract refresh-baseline";
  readonly executionState: "completed" | "error";
  readonly exitCode: 0 | 2;
  readonly contract?: {
    id: string;
    path: string;
    digest: `sha256:${string}`;
    revision: number;
    previousSnapshotDigest: string;
    snapshotDigest: string;
  };
  readonly diagnostics: readonly Diagnostic[];
  readonly next?: { command: string; argv: string[] };
}

function failure(error: unknown): CliResult<ContractRefreshBaselineOutcome> {
  return {
    ok: false,
    exitCode: 2,
    body: {
      formatVersion: REFRESH_OUTCOME_FORMAT_VERSION,
      kind: "framelia.contract-refresh-baseline-outcome",
      command: "contract refresh-baseline",
      executionState: "error",
      exitCode: 2,
      diagnostics: [
        {
          code: error instanceof AppError ? error.code : "BASELINE_REFRESH_FAILED",
          stage: "refresh-baseline",
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    },
  };
}

/** Refresh is pointer-last: every failure leaves the previously pinned snapshot usable. */
export async function contractRefreshBaselineCommand(
  options: ContractRefreshBaselineOptions,
  runtime: CliRuntime,
  dependencies: ContractRefreshBaselineDependencies = {},
): Promise<CliResult<ContractRefreshBaselineOutcome>> {
  try {
    const contractId = options.contract;
    if (!contractId) {
      throw new Error("refresh-baseline requires --contract <exact-id>.");
    }
    const project = openProject(options.projectRoot, runtime);
    const policy = await project.loadConfig();
    const configBefore = policy.configPath ? readRawFileState(policy.configPath) : undefined;
    const inspection = await inspectAuthoredContracts(policy);
    if (inspection.invalid[0]) {
      throw new AppError(inspection.invalid[0].code, inspection.invalid[0].message);
    }
    const discovered = inspection.contracts.find((entry) => entry.contract.id === contractId);
    if (!discovered) {
      throw new Error(`Unknown exact contract id ${JSON.stringify(contractId)}.`);
    }
    const contractPath = path.resolve(policy.root, discovered.file);
    const before = readRawFileState(contractPath);
    const previous = await readPinnedBaseline(policy.root, discovered.contract);
    const staged = await stageFigmaBaseline({
      source: previous.snapshot.source,
      viewport: discovered.contract.viewport,
      scope: discovered.contract.scope,
      token: optionalFigmaToken(runtime),
      ...(dependencies.fetchBaseline ? { fetchBaseline: dependencies.fetchBaseline } : {}),
    });
    const replacement = authoredContractSchema.parse({
      ...discovered.contract,
      revision: discovered.contract.revision + 1,
      baseline: { snapshotDigest: staged.snapshotDigest },
    });
    const digest = canonicalJsonDigest(replacement as CanonicalJsonValue);

    await withAuthoringLock(policy.root, async () => {
      assertRawFileState(contractPath, before);
      if (policy.configPath && configBefore) {
        assertRawFileState(policy.configPath, configBefore);
      }
      const latest = await inspectAuthoredContracts(policy);
      if (latest.invalid[0]) {
        throw new AppError(latest.invalid[0].code, latest.invalid[0].message);
      }
      const owner = latest.contracts.find((entry) => entry.contract.id === contractId);
      if (owner?.file !== discovered.file || owner.digest !== discovered.digest) {
        throw new AppError(
          "AUTHORING_CONFLICT",
          `Contract ${contractId} changed while baseline acquisition was in progress.`,
        );
      }
      await publishBaselineSnapshot(policy.root, replacement, staged);
      dependencies.afterSnapshotPublished?.();
      writeAuthoredContract(contractPath, replacement);
    });

    return {
      ok: true,
      exitCode: 0,
      body: {
        formatVersion: REFRESH_OUTCOME_FORMAT_VERSION,
        kind: "framelia.contract-refresh-baseline-outcome",
        command: "contract refresh-baseline",
        executionState: "completed",
        exitCode: 0,
        contract: {
          id: replacement.id,
          path: discovered.file,
          digest,
          revision: replacement.revision,
          previousSnapshotDigest: discovered.contract.baseline.snapshotDigest,
          snapshotDigest: replacement.baseline.snapshotDigest,
        },
        diagnostics: [],
        next: {
          command: "framelia",
          argv: [
            "check",
            "--contract",
            replacement.id,
            ...(options.projectRoot ? ["--project-root", options.projectRoot] : []),
          ],
        },
      },
    };
  } catch (error) {
    return failure(error);
  }
}
