import type { RunShard } from "@framelia/contracts/workflow";

/** Environment fallback for the reporter's `runId` option; shared by every shard of one run. */
export const RUN_ID_ENV = "FRAMELIA_RUN_ID";

export interface RunIdentity {
  runId: string;
  /** Set when this invocation is one shard of a run whose ID every shard shares. */
  sharedShard?: RunShard;
  /** A shard without a shared run ID: its `runId` carries a `-shard-<current>-of-<total>`
   *  suffix and it records a bundle of its own. */
  perShardBundle: boolean;
}

/**
 * Decides the run ID of a direct Playwright invocation: the reporter's `runId` option, else
 * `FRAMELIA_RUN_ID`, else a fresh ID. Sharded invocations either share that explicit ID (and
 * contribute to one run) or, without one, each record a suffixed per-shard bundle.
 */
export function resolveRunIdentity(input: {
  optionRunId?: string | undefined;
  envRunId?: string | undefined;
  shard?: RunShard | null | undefined;
  newId: () => string;
}): RunIdentity {
  const explicit = input.optionRunId ?? (input.envRunId?.trim() || undefined);
  const shard = input.shard ?? undefined;
  const sharedShard = shard && explicit !== undefined ? shard : undefined;
  const baseRunId = explicit ?? input.newId();
  const perShardBundle = shard !== undefined && sharedShard === undefined;
  return {
    runId: perShardBundle ? `${baseRunId}-shard-${shard.current}-of-${shard.total}` : baseRunId,
    ...(sharedShard
      ? { sharedShard: { current: sharedShard.current, total: sharedShard.total } }
      : {}),
    perShardBundle,
  };
}
