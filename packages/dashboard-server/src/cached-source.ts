import type { DashboardRun } from "@framelia/contracts";

import type { DashboardSource } from "./server.ts";

/** How long a still-changing run's projection is reused when no event says it changed. */
export const DEFAULT_SOURCE_CACHE_TTL_MS = 1_000;

interface Entry<T> {
  readonly value: Promise<T>;
  readonly generation: number;
  readonly createdAt: number;
  /** Known to describe a finished run: valid until invalidated, regardless of age. */
  settled: boolean;
}

export interface CachedDashboardSource extends DashboardSource {
  /** Drops every memoized projection (the next call re-reads the source). */
  readonly invalidate: () => void;
  /** Releases the cache's own subscription to the source. */
  readonly dispose: () => void;
}

/**
 * Memoizes a source's `snapshot()`/`files()` for the dashboard server.
 *
 * Real sources re-read and re-hash the whole selected run on every call, and the server
 * used to call them per request -- once per artifact image, once per SSE sync. Here each
 * projection is computed at most once per change:
 *
 * - a source event (`subscribe`) invalidates immediately, so live updates are never
 *   served stale;
 * - a finished run (`finishedAt` set) is immutable, so its projection is kept until the
 *   next event;
 * - anything else (an unfinished run read from disk with no event channel) is reused
 *   for at most `ttlMs`.
 *
 * A rejected computation is never cached.
 */
export function cacheDashboardSource(
  source: DashboardSource,
  options: { ttlMs?: number; now?: () => number } = {},
): CachedDashboardSource {
  const ttlMs = options.ttlMs ?? DEFAULT_SOURCE_CACHE_TTL_MS;
  const now = options.now ?? Date.now;
  let generation = 0;
  let finishedGeneration: number | undefined;
  let snapshotEntry: Entry<DashboardRun> | undefined;
  let filesEntry: Entry<Map<string, string>> | undefined;

  const invalidate = () => {
    generation += 1;
    finishedGeneration = undefined;
    snapshotEntry = undefined;
    filesEntry = undefined;
  };
  const unsubscribe = source.subscribe?.(invalidate);

  const fresh = <T>(entry: Entry<T> | undefined): entry is Entry<T> =>
    entry !== undefined &&
    entry.generation === generation &&
    (entry.settled || now() - entry.createdAt < ttlMs);

  function remember<T>(
    compute: () => T | Promise<T>,
    store: (entry: Entry<T> | undefined) => void,
    current: () => Entry<T> | undefined,
  ): Entry<T> {
    const entry: Entry<T> = {
      value: Promise.resolve().then(compute),
      generation,
      createdAt: now(),
      settled: finishedGeneration === generation,
    };
    store(entry);
    entry.value.catch(() => {
      if (current() === entry) store(undefined);
    });
    return entry;
  }

  return {
    snapshot: () => {
      if (fresh(snapshotEntry)) return snapshotEntry.value;
      const entry = remember(
        () => source.snapshot(),
        (next) => (snapshotEntry = next),
        () => snapshotEntry,
      );
      void entry.value.then(
        (run) => {
          if (run.finishedAt && entry.generation === generation) {
            finishedGeneration = generation;
            entry.settled = true;
          }
          return undefined;
        },
        () => undefined,
      );
      return entry.value;
    },
    files: () => {
      if (fresh(filesEntry)) return filesEntry.value;
      return remember(
        () => source.files(),
        (next) => (filesEntry = next),
        () => filesEntry,
      ).value;
    },
    ...(source.subscribe ? { subscribe: source.subscribe } : {}),
    invalidate,
    dispose: () => unsubscribe?.(),
  };
}
