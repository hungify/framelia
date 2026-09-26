import * as fs from "node:fs";
import * as path from "node:path";

import { AppError } from "../types.ts";
import { runDir } from "./layout.ts";

const LOCK_DIR_NAME = "lock";
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_BACKOFF_MS = 50;

function lockDirPath(root: string, runId: string): string {
  return path.join(runDir(root, runId), LOCK_DIR_NAME);
}

/**
 * Waits `ms` without blocking the event loop -- critical for same-process correctness:
 * two concurrent callers of `withRunLock` for the same run (e.g. two attempts published
 * back-to-back by one Reporter process) both run on the *same* thread. A blocking sleep
 * here (e.g. `Atomics.wait` on the main thread) would freeze the entire event loop while
 * waiting for the lock, which would also freeze the lock *holder's* own pending
 * continuation (its `await fn()` / release, scheduled as a microtask/timer on that same
 * frozen loop) -- a guaranteed same-process deadlock. An `await`-based wait yields back
 * to the event loop, letting the holder's own release actually run.
 */
function sleepAsync(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Cross-process mutual exclusion for one run's own coordination state, based on the
 * atomicity of `fs.mkdirSync`: POSIX `mkdir()` either creates the directory or fails with
 * `EEXIST`, with no window where two callers can both believe they created it -- the same
 * portable primitive `staged-write.ts` builds its own atomic-rename guarantee on top of,
 * just used here for exclusion instead of visibility.
 *
 * `publishAttempt` and `finalizeRunRecord` both wrap their entire body in this lock (not
 * just a status check): without it, a `publishAttempt` call that reads `run.json` as
 * still `"running"` and a `finalizeRunRecord` call that scans the attempts directory can
 * interleave arbitrarily, producing either an attempt that exists on disk but is invisible
 * to the finalized record's membership, or a finalized run whose own membership check
 * (`readRunBundle`) rejects it outright. Wrapping the whole critical section in one lock
 * makes these two operations strictly ordered relative to each other for a given run --
 * whichever acquires the lock first runs to completion before the other starts.
 *
 * This is a short critical section (a directory scan, or a stage-then-rename), never
 * expected to be held for long -- `acquire` polls with a short, capped exponential
 * backoff rather than blocking indefinitely, and throws `RUN_BUNDLE_LOCK_TIMEOUT` if
 * `timeoutMs` elapses without acquiring the lock, rather than hanging forever on a truly
 * stuck holder.
 *
 * Stale-lock recovery (a coordinator that crashed while holding the lock) is deliberately
 * NOT implemented: distinguishing "still legitimately held" from "abandoned" without
 * reintroducing a race (e.g. a heartbeat file another caller could itself race to delete
 * or misread) needs real process-liveness detection this module doesn't have. A lock left
 * behind by a crashed coordinator is an operational concern -- remove the lock directory
 * (`.framelia/runs/<runId>/lock`) manually.
 */
export async function withRunLock<T>(
  root: string,
  runId: string,
  fn: () => T | Promise<T>,
  options: { timeoutMs?: number } = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const lockDir = lockDirPath(root, runId);
  fs.mkdirSync(path.dirname(lockDir), { recursive: true });

  const deadline = Date.now() + timeoutMs;
  let backoffMs = 2;
  for (;;) {
    try {
      fs.mkdirSync(lockDir);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() >= deadline) {
        throw new AppError(
          "RUN_BUNDLE_LOCK_TIMEOUT",
          `Timed out after ${timeoutMs}ms waiting for run "${runId}"'s lock at ${lockDir}. Another process may still be publishing an attempt or finalizing this run, or a crashed coordinator left the lock behind -- if the latter, remove ${lockDir} manually.`,
        );
      }
      // A retry-with-backoff acquire loop is inherently sequential: each attempt must
      // observe the previous one's outcome before deciding whether to retry, so there is
      // nothing here to run in parallel.
      // eslint-disable-next-line no-await-in-loop
      await sleepAsync(Math.min(backoffMs, MAX_BACKOFF_MS));
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
    }
  }

  try {
    return await fn();
  } finally {
    fs.rmSync(lockDir, { recursive: true, force: true });
  }
}
