/** Headroom left between a derived capture deadline and the test's own timeout, so the
 *  capture fails with its own message (and evidence) before Playwright kills the test. */
export const TEST_TIMEOUT_MARGIN_MS = 1_000;

/**
 * What remains of a test's own timeout after `elapsedMs`, minus a safety margin -- never
 * below 1ms. A test timeout of 0 means "unlimited" in Playwright; a deadline is still
 * needed to bound capture, so `unlimitedFallbackMs` is used instead.
 */
export function remainingTestBudgetMs(
  testTimeoutMs: number,
  elapsedMs: number,
  unlimitedFallbackMs: number,
  marginMs = TEST_TIMEOUT_MARGIN_MS,
): number {
  if (testTimeoutMs <= 0) return unlimitedFallbackMs;
  return Math.max(1, testTimeoutMs - elapsedMs - marginMs);
}

/**
 * Races a promise against a timeout, for library calls (Figma REST fetch,
 * navigation) that don't accept a timeoutMs of their own — keeps matchers
 * bounded by `this.timeout` end to end.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms.`)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([promise, timedOut]);
  } finally {
    clearTimeout(timer!);
  }
}
