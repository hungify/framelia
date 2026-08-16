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
