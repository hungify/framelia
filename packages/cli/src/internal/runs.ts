import * as fs from "node:fs";

import type { Diagnostic, NextOperation, RunRecordStatus } from "@framelia/contracts/workflow";
import { portableErrorMessage } from "@framelia/verify";
import {
  finalizeShardedRun,
  inspectShardedRun,
  listRuns,
  runDir,
  toProjectRelative,
  type InvalidRunEntry,
  type MissingShard,
  type RunSummary,
} from "@framelia/verify/run-bundle";

import type { CommandEnvironment } from "../environment.ts";
import { UsageError } from "../exit.ts";
import type { CliResult } from "../output.ts";
import { failureOutcome, frameliaNext, type FailureOutcome } from "./outcome.ts";
import { openProject } from "./project.ts";

export interface RunsListOptions {
  readonly projectRoot: string | undefined;
}

export interface RunsListOutcome {
  readonly formatVersion: 1;
  readonly kind: "framelia.runs-list-outcome";
  readonly command: "runs list";
  readonly executionState: "completed";
  readonly exitCode: 0;
  /** Newest first. Listing never selects a run; every reader still takes `--run <id>`. */
  readonly runs: readonly RunSummary[];
  /** Run directories without a readable record of their own run; never pruned. */
  readonly invalid: readonly InvalidRunEntry[];
  readonly diagnostics: readonly Diagnostic[];
  readonly next: NextOperation;
}

function invalidDiagnostics(invalid: readonly InvalidRunEntry[]): Diagnostic[] {
  return invalid.map((entry) => ({ code: entry.code, stage: "runs", message: entry.message }));
}

/** Lists durable runs so a person or CI can pick the explicit `--run` other commands need. */
export function runsListCommand(
  options: RunsListOptions,
  env: Pick<CommandEnvironment, "process">,
): CliResult<RunsListOutcome | FailureOutcome<"framelia.runs-list-outcome", "runs list">> {
  try {
    const project = openProject(options.projectRoot, env.process);
    const { runs, invalid } = listRuns(project.root);
    const newest = runs[0];
    return {
      ok: true,
      exitCode: 0,
      body: {
        formatVersion: 1,
        kind: "framelia.runs-list-outcome",
        command: "runs list",
        executionState: "completed",
        exitCode: 0,
        runs,
        invalid,
        diagnostics: invalidDiagnostics(invalid),
        next: newest
          ? frameliaNext(["open", "--run", newest.runId], options.projectRoot)
          : frameliaNext(["check", "--all"], options.projectRoot),
      },
    };
  } catch (error) {
    return failureOutcome({
      kind: "framelia.runs-list-outcome",
      command: "runs list",
      error,
      fallbackCode: "RUNS_LIST_FAILED",
      stage: "runs",
      projectRoot: options.projectRoot,
    });
  }
}

export interface RunsPruneOptions {
  readonly projectRoot: string | undefined;
  /** Always keep this many newest runs, whatever their age. */
  readonly keep: number | undefined;
  /** Only remove runs created longer ago than this, e.g. `30m`, `12h`, `7d`, `2w`. */
  readonly olderThan: string | undefined;
  readonly dryRun: boolean | undefined;
}

export interface PrunedRun {
  readonly runId: string;
  readonly bundlePath: string;
  readonly createdAt: string;
}

export interface SkippedRun extends PrunedRun {
  readonly reason: "in-progress" | "locked";
}

export interface RunsPruneOutcome {
  readonly formatVersion: 1;
  readonly kind: "framelia.runs-prune-outcome";
  readonly command: "runs prune";
  readonly executionState: "completed";
  readonly exitCode: 0;
  readonly dryRun: boolean;
  /** Removed runs, or with `--dry-run` the runs that would be removed. */
  readonly removed: readonly PrunedRun[];
  /** Runs the criteria selected but that are still being written; never removed. */
  readonly skipped: readonly SkippedRun[];
  readonly kept: number;
  readonly diagnostics: readonly Diagnostic[];
}

const DURATION_UNITS_MS = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 } as const;

export function parseDuration(value: string): number {
  const match = /^(\d+)([mhdw])$/u.exec(value.trim());
  if (!match) {
    throw new UsageError(
      `--older-than must be a whole number of m, h, d or w (e.g. 7d), not ${JSON.stringify(value)}.`,
      { code: "INVALID_INPUT" },
    );
  }
  return Number(match[1]) * DURATION_UNITS_MS[match[2] as keyof typeof DURATION_UNITS_MS];
}

/** Which runs the criteria select, newest first: beyond the kept window and old enough. */
function selectForPruning(
  runs: readonly RunSummary[],
  options: RunsPruneOptions,
  now: Date,
): RunSummary[] {
  const keep = options.keep ?? 0;
  const cutoff =
    options.olderThan === undefined ? undefined : now.getTime() - parseDuration(options.olderThan);
  return runs
    .slice(keep)
    .filter((run) => cutoff === undefined || Date.parse(run.createdAt) < cutoff);
}

/**
 * Removes old durable runs. A run that is still planned/running or holds its lock is never
 * removed, and a directory without a valid record of its own run is never touched.
 */
export function runsPruneCommand(
  options: RunsPruneOptions,
  env: Pick<CommandEnvironment, "process" | "now">,
): CliResult<RunsPruneOutcome | FailureOutcome<"framelia.runs-prune-outcome", "runs prune">> {
  try {
    if (options.keep === undefined && options.olderThan === undefined) {
      throw new UsageError("runs prune requires --keep <n> and/or --older-than <duration>.", {
        code: "INVALID_INPUT",
      });
    }
    if (options.keep !== undefined && (!Number.isInteger(options.keep) || options.keep < 0)) {
      throw new UsageError("--keep must be a non-negative whole number.", {
        code: "INVALID_INPUT",
      });
    }
    const project = openProject(options.projectRoot, env.process);
    const { runs, invalid } = listRuns(project.root);
    const selected = selectForPruning(runs, options, env.now());
    const removed: PrunedRun[] = [];
    const skipped: SkippedRun[] = [];
    for (const run of selected) {
      const entry = { runId: run.runId, bundlePath: run.bundlePath, createdAt: run.createdAt };
      if (!run.terminal) {
        skipped.push({ ...entry, reason: "in-progress" });
        continue;
      }
      if (run.locked) {
        skipped.push({ ...entry, reason: "locked" });
        continue;
      }
      if (!options.dryRun) fs.rmSync(runDir(project.root, run.runId), { recursive: true });
      removed.push(entry);
    }
    return {
      ok: true,
      exitCode: 0,
      body: {
        formatVersion: 1,
        kind: "framelia.runs-prune-outcome",
        command: "runs prune",
        executionState: "completed",
        exitCode: 0,
        dryRun: options.dryRun ?? false,
        removed,
        skipped,
        kept: runs.length - removed.length,
        diagnostics: invalidDiagnostics(invalid),
      },
    };
  } catch (error) {
    return failureOutcome({
      kind: "framelia.runs-prune-outcome",
      command: "runs prune",
      error,
      fallbackCode: "RUNS_PRUNE_FAILED",
      stage: "runs",
      projectRoot: options.projectRoot,
    });
  }
}

export interface RunsFinalizeOptions {
  readonly projectRoot: string | undefined;
  readonly run: string | undefined;
}

export interface RunsFinalizeOutcome {
  readonly formatVersion: 1;
  readonly kind: "framelia.runs-finalize-outcome";
  readonly command: "runs finalize";
  /** `incomplete` while shards are missing; nothing was composed or finalized then. */
  readonly executionState: "completed" | "incomplete";
  readonly exitCode: 0 | 2;
  readonly runId: string;
  readonly bundlePath: string;
  /**
   * `finalized` by this call, `already-finalized` earlier (by the last shard or a previous
   * call), `waiting` for missing shards, or `empty` when no shard planned a contract case.
   */
  readonly state: "finalized" | "already-finalized" | "waiting" | "empty";
  /** The finalized run record's status. */
  readonly status?: RunRecordStatus;
  readonly shards?: {
    readonly total: number;
    readonly completed: readonly number[];
    readonly missing: readonly MissingShard[];
  };
  readonly diagnostics: readonly Diagnostic[];
  readonly next?: NextOperation;
}

/**
 * Composes and finalizes a sharded direct run whose shards ran on separate machines, once
 * every shard's `.framelia/runs/<run>` directory was collected into this project root. Each
 * shard finalizes the run itself when it is the last to finish on one machine, so this is a
 * no-op (`already-finalized`) for a run that is already finalized.
 */
export async function runsFinalizeCommand(
  options: RunsFinalizeOptions,
  env: Pick<CommandEnvironment, "process">,
): Promise<
  CliResult<RunsFinalizeOutcome | FailureOutcome<"framelia.runs-finalize-outcome", "runs finalize">>
> {
  let root: string | undefined;
  try {
    if (!options.run) {
      throw new UsageError("runs finalize requires --run <id>; list durable runs to choose one.", {
        code: "RUN_SELECTION_MISSING",
      });
    }
    const runId = options.run;
    root = openProject(options.projectRoot, env.process).root;
    const result = await finalizeShardedRun(root, runId);
    const base = {
      formatVersion: 1,
      kind: "framelia.runs-finalize-outcome",
      command: "runs finalize",
      runId,
      bundlePath: toProjectRelative(root, runDir(root, runId)),
    } as const;
    if (result.state === "waiting") {
      const missing = result.missing
        .map((entry) => `shard ${entry.current}/${entry.total} (${entry.parts.join(", ")})`)
        .join(", ");
      return {
        ok: false,
        exitCode: 2,
        body: {
          ...base,
          executionState: "incomplete",
          exitCode: 2,
          state: "waiting",
          shards: { total: result.total, completed: result.completed, missing: result.missing },
          diagnostics: [
            {
              code: "RUN_SHARDS_MISSING",
              stage: "runs",
              message: `Run "${runId}" is missing ${missing}. Collect every shard's .framelia/runs/<run> directory into this project root, then run this command again.`,
            },
          ],
          next: frameliaNext(["runs", "list"], options.projectRoot),
        },
      };
    }
    const shards = inspectShardedRun(root, runId);
    return {
      ok: true,
      exitCode: 0,
      body: {
        ...base,
        executionState: "completed",
        exitCode: 0,
        state: result.state,
        ...(result.state === "finalized" || result.state === "already-finalized"
          ? { status: result.record.status }
          : {}),
        ...(shards
          ? {
              shards: { total: shards.total, completed: shards.completed, missing: shards.missing },
            }
          : {}),
        diagnostics:
          result.state === "empty"
            ? [
                {
                  code: "RUN_SHARDS_EMPTY",
                  stage: "runs",
                  message: `No shard of run "${runId}" planned a framelia.contract case; nothing was recorded.`,
                },
              ]
            : [],
        ...(result.state === "empty"
          ? {}
          : { next: frameliaNext(["open", "--run", runId], options.projectRoot) }),
      },
    };
  } catch (error) {
    return failureOutcome({
      kind: "framelia.runs-finalize-outcome",
      command: "runs finalize",
      error,
      fallbackCode: "RUNS_FINALIZE_FAILED",
      stage: "runs",
      projectRoot: options.projectRoot,
      ...(root === undefined ? {} : { message: portableErrorMessage(error, root) }),
    });
  }
}
