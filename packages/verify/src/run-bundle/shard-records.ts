import * as fs from "node:fs";

import {
  runPlanFragmentSchema,
  shardCompletionSchema,
  type Diagnostic,
  type RunPlanFragment,
  type RunShard,
  type ShardCompletion,
} from "@framelia/contracts/workflow";

import { canonicalJsonDigest } from "../canonical-json.ts";
import { AppError } from "../types.ts";
import {
  PLAN_FRAGMENT_FILE_NAME,
  SHARD_COMPLETION_FILE_NAME,
  planFragmentDir,
  planFragmentPath,
  runPlanPath,
  runRecordPath,
  shardCompletionDir,
  shardCompletionPath,
  shardDirName,
  shardsDir,
} from "./layout.ts";
import { withRunLock } from "./lock.ts";
import { publishBundleUnit } from "./staged-write.ts";

/**
 * A sharded direct run's own per-shard records (see layout.ts): each shard's immutable plan
 * fragment and completion marker. Its own module, free of run.ts, so run.ts (readers) and
 * sharded-run.ts (composition, which needs run.ts) can both import it without a cycle.
 */

/** Which of a shard's two records are not published yet. */
export type ShardPart = "plan" | "completion";

export interface MissingShard {
  current: number;
  total: number;
  parts: ShardPart[];
}

export interface ShardRecords {
  shard: RunShard;
  fragment?: RunPlanFragment;
  completion?: ShardCompletion;
}

export interface ShardedRunState {
  runId: string;
  /** The shard total every published shard record agrees on. */
  total: number;
  /** One entry per shard `1..total`, in shard order, published or not. */
  shards: ShardRecords[];
  /** Shards whose completion marker is published. */
  completed: number[];
  /** Shards still missing their plan fragment and/or completion marker. */
  missing: MissingShard[];
}

const SHARD_DIR_PATTERN = /^(\d+)-of-(\d+)$/u;

function readJson<T>(filePath: string, schema: { parse: (input: unknown) => T }, label: string): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new AppError(
      "RUN_BUNDLE_INVALID",
      `${label} at ${filePath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}.`,
    );
  }
  try {
    return schema.parse(parsed);
  } catch (error) {
    throw new AppError(
      "RUN_BUNDLE_INVALID",
      `${label} at ${filePath} failed schema validation: ${error instanceof Error ? error.message : String(error)}.`,
    );
  }
}

function shardLabel(shard: RunShard): string {
  return `shard ${shard.current}/${shard.total}`;
}

function checkIdentity(
  record: { runId: string; shard: RunShard },
  runId: string,
  shard: RunShard,
  filePath: string,
): void {
  if (
    record.runId !== runId ||
    record.shard.current !== shard.current ||
    record.shard.total !== shard.total
  ) {
    throw new AppError(
      "RUN_BUNDLE_INVALID",
      `Shard record at ${filePath} belongs to run "${record.runId}" ${shardLabel(record.shard)}, not run "${runId}" ${shardLabel(shard)}.`,
    );
  }
}

/** Reads one shard's published plan fragment. */
export function readPlanFragment(root: string, runId: string, shard: RunShard): RunPlanFragment {
  const filePath = planFragmentPath(root, runId, shard);
  if (!fs.existsSync(filePath)) {
    throw new AppError(
      "RUN_BUNDLE_MISSING",
      `No plan fragment for run "${runId}" ${shardLabel(shard)} at ${filePath}.`,
    );
  }
  const fragment = readJson(
    filePath,
    runPlanFragmentSchema,
    `plan fragment of ${shardLabel(shard)}`,
  );
  checkIdentity(fragment, runId, shard, filePath);
  return fragment;
}

function readShardCompletion(root: string, runId: string, shard: RunShard): ShardCompletion {
  const filePath = shardCompletionPath(root, runId, shard);
  const completion = readJson(
    filePath,
    shardCompletionSchema,
    `completion marker of ${shardLabel(shard)}`,
  );
  checkIdentity(completion, runId, shard, filePath);
  return completion;
}

/**
 * Publishes one shard's plan fragment as an immutable unit. Refused once the run already has
 * a frozen plan or run record: a composed (or unsharded) run never gains cases afterwards.
 */
export async function publishPlanFragment(root: string, fragment: RunPlanFragment): Promise<void> {
  const validated = runPlanFragmentSchema.parse(fragment);
  await withRunLock(root, validated.runId, () => {
    if (
      fs.existsSync(runPlanPath(root, validated.runId)) ||
      fs.existsSync(runRecordPath(root, validated.runId))
    ) {
      throw new AppError(
        "RUN_BUNDLE_INVALID",
        `Run "${validated.runId}" already has a frozen plan, so ${shardLabel(validated.shard)} cannot add a plan fragment to it. Give every new sharded run its own run ID (for example include the CI run attempt).`,
      );
    }
    publishBundleUnit(planFragmentDir(root, validated.runId, validated.shard), [
      { relativePath: PLAN_FRAGMENT_FILE_NAME, content: `${JSON.stringify(validated, null, 2)}\n` },
    ]);
  });
}

/**
 * Publishes one shard's completion marker once its own attempts settled. It binds the
 * fragment the shard planned by digest, so composition can tell a fragment changed after
 * the shard completed. A shard completes once; its attempts are refused afterwards.
 */
export async function publishShardCompletion(
  root: string,
  runId: string,
  shard: RunShard,
  outcome: {
    resultStatus: ShardCompletion["resultStatus"];
    globalErrors: readonly string[];
    diagnostics: readonly Diagnostic[];
    completedAt?: string;
  },
): Promise<ShardCompletion> {
  return withRunLock(root, runId, () => {
    const fragment = readPlanFragment(root, runId, shard);
    const completion = shardCompletionSchema.parse({
      formatVersion: 1,
      kind: "framelia.shard-completion",
      runId,
      shard,
      planFragmentDigest: canonicalJsonDigest(fragment),
      resultStatus: outcome.resultStatus,
      globalErrors: outcome.globalErrors,
      diagnostics: outcome.diagnostics,
      completedAt: outcome.completedAt ?? new Date().toISOString(),
    });
    publishBundleUnit(shardCompletionDir(root, runId, shard), [
      {
        relativePath: SHARD_COMPLETION_FILE_NAME,
        content: `${JSON.stringify(completion, null, 2)}\n`,
      },
    ]);
    return completion;
  });
}

export function isShardCompleted(root: string, runId: string, shard: RunShard): boolean {
  return fs.existsSync(shardCompletionPath(root, runId, shard));
}

/**
 * Reads every shard record of a sharded run, or `undefined` when the run has none. Shards
 * that disagree on the shard total are a conflict: they cannot belong to one run.
 */
export function inspectShardedRun(root: string, runId: string): ShardedRunState | undefined {
  const dir = shardsDir(root, runId);
  if (!fs.existsSync(dir)) return undefined;
  const found: RunShard[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const match = SHARD_DIR_PATTERN.exec(entry.name);
    const current = Number(match?.[1]);
    const total = Number(match?.[2]);
    if (!match || current < 1 || current > total) {
      throw new AppError(
        "RUN_BUNDLE_INVALID",
        `Run "${runId}" contains unexpected shard directory "${entry.name}".`,
      );
    }
    found.push({ current, total });
  }
  if (found.length === 0) return undefined;
  const totals = [...new Set(found.map((shard) => shard.total))].toSorted((a, b) => a - b);
  if (totals.length > 1) {
    throw new AppError(
      "RUN_BUNDLE_SHARD_CONFLICT",
      `Run "${runId}" has shards that disagree on the shard total (${found
        .toSorted((a, b) => a.total - b.total || a.current - b.current)
        .map(shardDirName)
        .join(", ")}); every shard of one run must use the same --shard total.`,
    );
  }
  const total = totals[0]!;
  const shards: ShardRecords[] = [];
  const completed: number[] = [];
  const missing: MissingShard[] = [];
  for (let current = 1; current <= total; current += 1) {
    const shard = { current, total };
    const records: ShardRecords = { shard };
    const parts: ShardPart[] = [];
    if (fs.existsSync(planFragmentPath(root, runId, shard))) {
      records.fragment = readPlanFragment(root, runId, shard);
    } else {
      parts.push("plan");
    }
    if (fs.existsSync(shardCompletionPath(root, runId, shard))) {
      records.completion = readShardCompletion(root, runId, shard);
      completed.push(current);
    } else {
      parts.push("completion");
    }
    if (parts.length > 0) missing.push({ current, total, parts });
    shards.push(records);
  }
  return { runId, total, shards, completed, missing };
}

/** "shard 2/3 (plan, completion), shard 3/3 (completion)" */
export function describeMissingShards(missing: readonly MissingShard[]): string {
  return missing.map((entry) => `${shardLabel(entry)} (${entry.parts.join(", ")})`).join(", ");
}

/** How to finish a sharded run whose plan is not composed yet. */
export function finalizeShardedRunHint(runId: string): string {
  return `Once every shard finished, collect each shard's .framelia/runs/<run> directory into one project root and run \`framelia runs finalize --run ${runId}\`.`;
}

/**
 * The reader-facing error for a sharded run that has no composed plan yet: it is still in
 * progress (or waits for `framelia runs finalize`), never a missing or broken run.
 */
export function shardsPendingError(runId: string, state: ShardedRunState): AppError {
  const waiting =
    state.missing.length > 0
      ? `waiting for ${describeMissingShards(state.missing)}`
      : "every shard completed, but the run was not finalized yet";
  return new AppError(
    "RUN_BUNDLE_SHARDS_PENDING",
    `Run "${runId}" is a sharded run whose plan has not been composed yet: ${waiting}. ${finalizeShardedRunHint(runId)}`,
  );
}
