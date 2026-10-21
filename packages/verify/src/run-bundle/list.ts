import * as fs from "node:fs";
import * as path from "node:path";

import {
  isTerminalRunStatus,
  runRecordSchema,
  type RunRecordStatus,
} from "@framelia/contracts/workflow";

import { portableErrorMessage } from "../portable.ts";
import { AppError } from "../types.ts";
import {
  ATTEMPTS_DIR_NAME,
  CASES_DIR_NAME,
  PLAN_DIR_NAME,
  PLAN_FRAGMENT_FILE_NAME,
  RUN_BUNDLE_DIR_SEGMENTS,
  RUN_RECORD_FILE_NAME,
  SHARDS_DIR_NAME,
  runDir,
  slug,
  toProjectRelative,
} from "./layout.ts";
import { finalizeShardedRunHint, inspectShardedRun } from "./shard-records.ts";

/** The lock directory `withRunLock` holds while an attempt or finalization is publishing. */
const LOCK_DIR_NAME = "lock";

/** One durable run, summarized from its own `run.json` coordination record. */
export interface RunSummary {
  readonly runId: string;
  /** Project-relative, forward-slash bundle directory (`.framelia/runs/<slug(runId)>`). */
  readonly bundlePath: string;
  readonly status: RunRecordStatus;
  /** True once the run is `finalized`, `incomplete` or `error`; nothing will write it again. */
  readonly terminal: boolean;
  /** True while a publisher or finalizer holds the run's lock. */
  readonly locked: boolean;
  readonly createdAt: string;
  readonly finalizedAt?: string;
  readonly caseCount: number;
  readonly attemptCount: number;
  readonly selectedAttemptCount: number;
  /** Only for a sharded run still waiting to be composed from its shards. */
  readonly shards?: RunShardProgress;
}

/** Which shards of an un-composed sharded run completed, by one-based shard index. */
export interface RunShardProgress {
  readonly total: number;
  readonly completed: number[];
  readonly missing: number[];
}

/** A run directory whose record is missing, unreadable, or not this directory's run. */
export interface InvalidRunEntry {
  readonly bundlePath: string;
  readonly locked: boolean;
  readonly code: "RUN_BUNDLE_MISSING" | "RUN_BUNDLE_INVALID" | "RUN_BUNDLE_SHARD_CONFLICT";
  readonly message: string;
}

export interface RunListing {
  /** Newest first by `createdAt`, then by run ID for a stable order. */
  readonly runs: RunSummary[];
  readonly invalid: InvalidRunEntry[];
}

function summarize(root: string, directory: string): RunSummary | InvalidRunEntry {
  const bundlePath = toProjectRelative(root, directory);
  const locked = fs.existsSync(path.join(directory, LOCK_DIR_NAME));
  const recordPath = path.join(directory, RUN_RECORD_FILE_NAME);
  if (!fs.existsSync(recordPath) && fs.existsSync(path.join(directory, SHARDS_DIR_NAME))) {
    return summarizePendingShards(root, directory, bundlePath, locked);
  }
  if (!fs.existsSync(recordPath)) {
    return {
      bundlePath,
      locked,
      code: "RUN_BUNDLE_MISSING",
      message: `${bundlePath} has no ${RUN_RECORD_FILE_NAME}; its run never started or is still being planned.`,
    };
  }
  let parsed;
  try {
    parsed = runRecordSchema.safeParse(JSON.parse(fs.readFileSync(recordPath, "utf8")));
  } catch (error) {
    return {
      bundlePath,
      locked,
      code: "RUN_BUNDLE_INVALID",
      message: `${bundlePath}/${RUN_RECORD_FILE_NAME} is not readable JSON: ${portableErrorMessage(error, root)}`,
    };
  }
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    return {
      bundlePath,
      locked,
      code: "RUN_BUNDLE_INVALID",
      message: `${bundlePath}/${RUN_RECORD_FILE_NAME} is not a valid run record: ${issues}`,
    };
  }
  const record = parsed.data;
  if (path.basename(directory) !== slug(record.runId)) {
    return {
      bundlePath,
      locked,
      code: "RUN_BUNDLE_INVALID",
      message: `${bundlePath} holds the record of run "${record.runId}", which belongs at ${toProjectRelative(root, runDir(root, record.runId))}.`,
    };
  }
  return {
    runId: record.runId,
    bundlePath,
    status: record.status,
    terminal: isTerminalRunStatus(record.status),
    locked,
    createdAt: record.createdAt,
    ...(record.finalizedAt ? { finalizedAt: record.finalizedAt } : {}),
    caseCount: record.cases.length,
    attemptCount: record.cases.reduce((total, entry) => total + entry.attemptIds.length, 0),
    selectedAttemptCount: record.cases.filter((entry) => entry.selectedAttemptId !== undefined)
      .length,
  };
}

function countPublishedAttempts(directory: string): number {
  const casesRoot = path.join(directory, CASES_DIR_NAME);
  if (!fs.existsSync(casesRoot)) return 0;
  let count = 0;
  for (const caseName of fs.readdirSync(casesRoot)) {
    const attempts = path.join(casesRoot, caseName, ATTEMPTS_DIR_NAME);
    if (!fs.existsSync(attempts)) continue;
    count += fs
      .readdirSync(attempts, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).length;
  }
  return count;
}

/**
 * A sharded run with no run record yet: its plan is composed only once every shard completed,
 * so it is in progress. Its run ID, creation time and cases come from the shards' fragments.
 */
function summarizePendingShards(
  root: string,
  directory: string,
  bundlePath: string,
  locked: boolean,
): RunSummary | InvalidRunEntry {
  const shardsRoot = path.join(directory, SHARDS_DIR_NAME);
  let runId: string | undefined;
  for (const name of fs.readdirSync(shardsRoot).toSorted()) {
    const fragmentPath = path.join(shardsRoot, name, PLAN_DIR_NAME, PLAN_FRAGMENT_FILE_NAME);
    try {
      runId = (JSON.parse(fs.readFileSync(fragmentPath, "utf8")) as { runId?: unknown }).runId as
        | string
        | undefined;
    } catch {
      continue;
    }
    if (typeof runId === "string") break;
  }
  if (typeof runId !== "string" || path.basename(directory) !== slug(runId)) {
    return {
      bundlePath,
      locked,
      code: "RUN_BUNDLE_INVALID",
      message: `${bundlePath} holds shard records without a readable plan fragment of this directory's run.`,
    };
  }
  try {
    const state = inspectShardedRun(root, runId)!;
    const fragments = state.shards.flatMap((shard) => (shard.fragment ? [shard.fragment] : []));
    const caseCount = fragments.reduce((total, fragment) => total + fragment.casePlans.length, 0);
    if (state.missing.length === 0 && caseCount === 0) {
      return {
        bundlePath,
        locked,
        code: "RUN_BUNDLE_MISSING",
        message: `Sharded run "${runId}": every shard completed without a framelia.contract case, so no run was recorded.`,
      };
    }
    return {
      runId,
      bundlePath,
      status: "running",
      terminal: false,
      locked,
      createdAt: fragments
        .map((fragment) => fragment.createdAt)
        .toSorted((left, right) => Date.parse(left) - Date.parse(right))[0]!,
      caseCount,
      attemptCount: countPublishedAttempts(directory),
      selectedAttemptCount: 0,
      shards: {
        total: state.total,
        completed: state.completed,
        missing: state.missing.map((entry) => entry.current),
      },
    };
  } catch (error) {
    return {
      bundlePath,
      locked,
      code:
        error instanceof AppError && error.code === "RUN_BUNDLE_SHARD_CONFLICT"
          ? "RUN_BUNDLE_SHARD_CONFLICT"
          : "RUN_BUNDLE_INVALID",
      message: `${portableErrorMessage(error, root)} ${finalizeShardedRunHint(runId)}`,
    };
  }
}

/**
 * Lists every durable run under `.framelia/runs/` from its own coordination record. It is a
 * discovery aid only: it never selects a run for reporting or gating, which stays explicit.
 */
export function listRuns(root: string): RunListing {
  const runsRoot = path.join(root, ...RUN_BUNDLE_DIR_SEGMENTS);
  let names: string[];
  try {
    names = fs
      .readdirSync(runsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { runs: [], invalid: [] };
    throw error;
  }
  const runs: RunSummary[] = [];
  const invalid: InvalidRunEntry[] = [];
  for (const name of names.toSorted()) {
    const entry = summarize(root, path.join(runsRoot, name));
    if ("runId" in entry) runs.push(entry);
    else invalid.push(entry);
  }
  runs.sort(
    (left, right) =>
      right.createdAt.localeCompare(left.createdAt) || left.runId.localeCompare(right.runId),
  );
  return { runs, invalid };
}
