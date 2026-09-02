/**
 * Captures the value a function throws, unconditionally -- avoids the
 * `vitest/no-conditional-expect` lint rule that a bare try/catch containing
 * `expect(...)` calls would trigger. If `fn` doesn't throw, this itself
 * throws, which still fails the test (just not via a conditional `expect`).
 */
export function captureThrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected function to throw, but it did not.");
}
