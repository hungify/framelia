import * as path from "node:path";

import type { Diagnostic } from "@framelia/contracts/workflow";
import { readPinnedBaseline, type FetchBaselineFn } from "@framelia/verify";

import type { CliResult } from "../output.ts";
import type { CliRuntime } from "../runtime-types.ts";
import { openContractPinning } from "./contract-pinning.ts";
import { optionalFigmaToken } from "./figma-token.ts";
import { failureDiagnostic, frameliaNext } from "./outcome.ts";
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
      diagnostics: [failureDiagnostic(error, "BASELINE_REFRESH_FAILED", "refresh-baseline")],
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
    const policy = await openProject(options.projectRoot, runtime).loadConfig();
    const pinning = await openContractPinning(policy);
    const discovered = pinning.contracts.find((entry) => entry.contract.id === contractId);
    if (!discovered) {
      throw new Error(`Unknown exact contract id ${JSON.stringify(contractId)}.`);
    }
    const previous = await readPinnedBaseline(policy.root, discovered.contract);
    const { contract: replacement, digest } = await pinning.pin({
      contractPath: path.resolve(policy.root, discovered.file),
      existing: discovered,
      draft: { ...discovered.contract, revision: discovered.contract.revision + 1 },
      source: previous.snapshot.source,
      token: optionalFigmaToken(runtime),
      ...(dependencies.fetchBaseline ? { fetchBaseline: dependencies.fetchBaseline } : {}),
      ...(dependencies.afterSnapshotPublished
        ? { afterSnapshotPublished: dependencies.afterSnapshotPublished }
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
    return failure(error);
  }
}
