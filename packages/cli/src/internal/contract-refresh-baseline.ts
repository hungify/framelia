import * as path from "node:path";

import type { Diagnostic, NextOperation } from "@framelia/contracts/workflow";
import { readPinnedBaseline } from "@framelia/verify";

import type { CommandEnvironment } from "../environment.ts";
import { UsageError } from "../exit.ts";
import type { CliResult } from "../output.ts";
import type { CliRuntime } from "../runtime-types.ts";
import { openContractPinning } from "./contract-pinning.ts";
import { explainFigmaFailure, optionalFigmaToken } from "./figma-token.ts";
import { failureOutcome, frameliaNext } from "./outcome.ts";
import { openProject } from "./project.ts";

const REFRESH_OUTCOME_FORMAT_VERSION = 1 as const;

export interface ContractRefreshBaselineOptions {
  readonly projectRoot: string | undefined;
  readonly contract: string | undefined;
}

/** Test seam: runs after the snapshot is published and before the pointer is written. */
export interface ContractRefreshBaselineSeams {
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
  readonly next?: NextOperation;
}

function failure(
  error: unknown,
  runtime: CliRuntime,
  projectRoot: string | undefined,
): CliResult<ContractRefreshBaselineOutcome> {
  return failureOutcome({
    kind: "framelia.contract-refresh-baseline-outcome",
    command: "contract refresh-baseline",
    error: explainFigmaFailure(error, runtime),
    fallbackCode: "BASELINE_REFRESH_FAILED",
    stage: "refresh-baseline",
    projectRoot,
  });
}

/** Refresh is pointer-last: every failure leaves the previously pinned snapshot usable. */
export async function contractRefreshBaselineCommand(
  options: ContractRefreshBaselineOptions,
  env: CommandEnvironment,
  seams: ContractRefreshBaselineSeams = {},
): Promise<CliResult<ContractRefreshBaselineOutcome>> {
  const runtime = env.process;
  try {
    const contractId = options.contract;
    if (!contractId) {
      throw new UsageError("refresh-baseline requires --contract <exact-id>.", {
        code: "CONTRACT_REQUIRED",
      });
    }
    const policy = await openProject(options.projectRoot, runtime).loadConfig();
    const pinning = await openContractPinning(policy);
    const discovered = pinning.contracts.find((entry) => entry.contract.id === contractId);
    if (!discovered) {
      throw new UsageError(`Unknown exact contract id ${JSON.stringify(contractId)}.`, {
        code: "UNKNOWN_CONTRACT_ID",
      });
    }
    const previous = await readPinnedBaseline(policy.root, discovered.contract);
    const { contract: replacement, digest } = await pinning.pin({
      contractPath: path.resolve(policy.root, discovered.file),
      existing: discovered,
      draft: { ...discovered.contract, revision: discovered.contract.revision + 1 },
      source: previous.snapshot.source,
      token: optionalFigmaToken(runtime),
      fetchBaseline: (await env.adapters.figma()).fetchBaseline,
      ...(seams.afterSnapshotPublished
        ? { afterSnapshotPublished: seams.afterSnapshotPublished }
        : {}),
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
        next: frameliaNext(["check", "--contract", replacement.id], options.projectRoot),
      },
    };
  } catch (error) {
    return failure(error, runtime, options.projectRoot);
  }
}
