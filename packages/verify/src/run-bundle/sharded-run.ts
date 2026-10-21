import * as fs from "node:fs";

import {
  isTerminalRunStatus,
  type CasePlan,
  type Diagnostic,
  type RunPlanFragment,
  type RunRecord,
  type ShardCompletion,
} from "@framelia/contracts/workflow";

import { canonicalJsonDigest } from "../canonical-json.ts";
import { AppError } from "../types.ts";
import { buildDirectRunPlan } from "./direct-plan.ts";
import { runDir, runPlanPath, runRecordPath } from "./layout.ts";
import { withRunLock } from "./lock.ts";
import {
  finalizeRunRecordLocked,
  freezeRunPlan,
  readRunPlan,
  readRunRecord,
  sealRunFinalizationError,
  startRunRecord,
} from "./run.ts";
import { inspectShardedRun, type MissingShard, type ShardRecords } from "./shard-records.ts";

/** Composing and finalizing reconciles every case; give it longer than a single publish. */
const FINALIZE_LOCK_TIMEOUT_MS = 120_000;

/** Worst first: the run is only as finished as its least finished shard. */
const RESULT_STATUS_SEVERITY: Record<ShardCompletion["resultStatus"], number> = {
  passed: 0,
  failed: 1,
  timedout: 2,
  interrupted: 3,
};

export type ShardedRunFinalization =
  | { state: "finalized"; runId: string; total: number; record: RunRecord }
  | { state: "already-finalized"; runId: string; record: RunRecord }
  | { state: "waiting"; runId: string; total: number; completed: number[]; missing: MissingShard[] }
  | { state: "empty"; runId: string; total: number };

interface CompletedShard {
  label: string;
  fragment: RunPlanFragment;
  completion: ShardCompletion;
}

/**
 * The single finalization step of a sharded direct run, shared by every shard's own onEnd
 * and `framelia runs finalize`. Under the run lock it:
 *
 * - returns `already-finalized` when the run record is already terminal (a no-op, so every
 *   shard and a later CLI call can trigger it safely);
 * - returns `waiting` while any shard `1..total` lacks its plan fragment or completion marker;
 * - otherwise verifies the shards agree (total, policy, retry acceptance, disjoint cases, each
 *   fragment unchanged since its shard completed), freezes the plan composed from the union of
 *   every fragment in case-ID order, and finalizes the run once with the worst shard result
 *   status and every shard's diagnostics and global errors.
 *
 * Disagreeing shards throw `RUN_BUNDLE_SHARD_CONFLICT` and compose nothing. When no shard
 * planned any case there is nothing to record (`empty`), as for an unsharded run.
 */
export function finalizeShardedRun(
  root: string,
  runId: string,
  options: { now?: () => Date } = {},
): Promise<ShardedRunFinalization> {
  if (!fs.existsSync(runDir(root, runId))) {
    // Checked before locking: taking the lock would create the run directory.
    return Promise.reject(missingShardRecords(runId));
  }
  return withRunLock(
    root,
    runId,
    async (): Promise<ShardedRunFinalization> => {
      if (fs.existsSync(runRecordPath(root, runId))) {
        const record = readRunRecord(root, runId);
        if (isTerminalRunStatus(record.status)) {
          return { state: "already-finalized", runId, record };
        }
      }
      const state = inspectShardedRun(root, runId);
      if (!state) throw missingShardRecords(runId);
      if (state.missing.length > 0) {
        return {
          state: "waiting",
          runId,
          total: state.total,
          completed: state.completed,
          missing: state.missing,
        };
      }

      const shards = verifyShards(runId, state.shards);
      const casePlans = composeCasePlans(runId, shards);
      if (casePlans.length === 0) return { state: "empty", runId, total: state.total };

      const [first] = shards;
      const plan = buildDirectRunPlan({
        runId,
        policyDigest: first!.fragment.policyDigest,
        retryAcceptance: first!.fragment.retryAcceptance,
        casePlans,
      });
      if (fs.existsSync(runPlanPath(root, runId))) {
        // A previous composition froze the plan but stopped before finalizing.
        const frozen = readRunPlan(root, runId);
        if (canonicalJsonDigest(frozen) !== canonicalJsonDigest(plan)) {
          throw new AppError(
            "RUN_BUNDLE_DIGEST_MISMATCH",
            `Run "${runId}"'s frozen plan does not match the plan its shards compose to.`,
          );
        }
      } else {
        freezeRunPlan(root, plan, casePlans);
      }
      if (!fs.existsSync(runRecordPath(root, runId))) {
        const createdAt = shards
          .map((shard) => shard.fragment.createdAt)
          .toSorted((left, right) => Date.parse(left) - Date.parse(right))[0]!;
        startRunRecord(root, plan, createdAt);
      }

      const diagnostics: Diagnostic[] = shards.flatMap((shard) => [
        ...shard.completion.diagnostics.map((diagnostic) => ({
          ...diagnostic,
          message: `${shard.label}: ${diagnostic.message}`,
        })),
        ...shard.completion.globalErrors.map((message) => ({
          code: "execution-global-error",
          stage: "execution",
          message: `${shard.label}: ${message}`,
        })),
      ]);
      const resultStatus = shards
        .map((shard) => shard.completion.resultStatus)
        .reduce((worst, status) =>
          RESULT_STATUS_SEVERITY[status] > RESULT_STATUS_SEVERITY[worst] ? status : worst,
        );
      const finalizeOptions = {
        retryAcceptance: plan.retryAcceptance,
        diagnostics,
        resultStatus,
        ...(options.now ? { now: options.now } : {}),
      };
      try {
        const record = await finalizeRunRecordLocked(root, runId, finalizeOptions);
        return { state: "finalized", runId, total: state.total, record };
      } catch (error) {
        try {
          sealRunFinalizationError(root, runId, error, finalizeOptions);
        } catch {
          // Best effort, as in finalizeRunRecord: the original failure is what matters.
        }
        throw error;
      }
    },
    { timeoutMs: FINALIZE_LOCK_TIMEOUT_MS },
  );
}

function missingShardRecords(runId: string): AppError {
  return new AppError(
    "RUN_BUNDLE_MISSING",
    `Run "${runId}" has no shard records under .framelia/runs; it is not a sharded run, or no shard of it was collected into this project root.`,
  );
}

/** Every shard is complete here; checks they can belong to one run. */
function verifyShards(runId: string, records: readonly ShardRecords[]): CompletedShard[] {
  const shards = records.map((record): CompletedShard => {
    const label = `shard ${record.shard.current}/${record.shard.total}`;
    const fragment = record.fragment!;
    const completion = record.completion!;
    const digest = canonicalJsonDigest(fragment);
    if (digest !== completion.planFragmentDigest) {
      throw new AppError(
        "RUN_BUNDLE_DIGEST_MISMATCH",
        `Run "${runId}" ${label}'s plan fragment recomputes to ${digest}, but the shard completed with fragment ${completion.planFragmentDigest}; it changed after the shard completed.`,
      );
    }
    return { label, fragment, completion };
  });
  const [first, ...rest] = shards;
  for (const shard of rest) {
    if (shard.fragment.policyDigest !== first!.fragment.policyDigest) {
      throw new AppError(
        "RUN_BUNDLE_SHARD_CONFLICT",
        `Run "${runId}" shards disagree on the project policy: ${first!.label} planned with ${first!.fragment.policyDigest}, ${shard.label} with ${shard.fragment.policyDigest}. Run every shard from the same commit and framelia.config.`,
      );
    }
    if (shard.fragment.retryAcceptance !== first!.fragment.retryAcceptance) {
      throw new AppError(
        "RUN_BUNDLE_SHARD_CONFLICT",
        `Run "${runId}" shards disagree on the retry acceptance policy: ${first!.label} has "${first!.fragment.retryAcceptance}", ${shard.label} "${shard.fragment.retryAcceptance}".`,
      );
    }
  }
  return shards;
}

/** The union of every shard's case plans in case-ID order; a case planned twice conflicts. */
function composeCasePlans(runId: string, shards: readonly CompletedShard[]): CasePlan[] {
  const owners = new Map<string, string[]>();
  const casePlans: CasePlan[] = [];
  for (const shard of shards) {
    for (const casePlan of shard.fragment.casePlans) {
      const labels = owners.get(casePlan.caseId) ?? [];
      if (labels.length === 0) casePlans.push(casePlan);
      labels.push(shard.label);
      owners.set(casePlan.caseId, labels);
    }
  }
  const duplicates = [...owners].filter(([, labels]) => labels.length > 1);
  if (duplicates.length > 0) {
    throw new AppError(
      "RUN_BUNDLE_SHARD_CONFLICT",
      `Run "${runId}" has case(s) planned by more than one shard: ${duplicates
        .map(([caseId, labels]) => `"${caseId}" (${labels.join(", ")})`)
        .join(
          "; ",
        )}. Each case must run in exactly one shard; run every shard with the same config, projects and test filter.`,
    );
  }
  // Code-point order, not locale order: every machine must compose the same plan.
  return casePlans.toSorted((left, right) =>
    left.caseId < right.caseId ? -1 : left.caseId > right.caseId ? 1 : 0,
  );
}
