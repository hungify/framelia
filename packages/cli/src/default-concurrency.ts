import * as os from "node:os";

const MAX_DEFAULT_CONCURRENCY = 4;

/** Bounded default concurrency for parallel per-contract work: min(4, CPU cores). */
export function defaultConcurrency(): number {
  return Math.min(MAX_DEFAULT_CONCURRENCY, os.availableParallelism?.() ?? 2);
}
