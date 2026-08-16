import { describe, expect, it } from "vitest";

import { runWithConcurrency } from "../src/concurrency.ts";

function deferred<T>(value: T, delayMs: number): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), delayMs));
}

describe("runWithConcurrency", () => {
  it("returns results in input order even when later items resolve first", async () => {
    const results = await runWithConcurrency([10, 40, 10], 3, (delayMs, index) =>
      deferred(index, delayMs),
    );
    expect(results).toEqual([0, 1, 2]);
  });

  it("never runs more than `limit` workers at once", async () => {
    let active = 0;
    let observedMax = 0;
    const items = Array.from({ length: 6 }, (_, index) => index);
    await runWithConcurrency(items, 2, async (item) => {
      active += 1;
      observedMax = Math.max(observedMax, active);
      await deferred(undefined, 10);
      active -= 1;
      return item;
    });
    expect(observedMax).toBeLessThanOrEqual(2);
  });

  it("runs concurrently rather than sequentially when limit allows it", async () => {
    const spans: Array<{ start: number; end: number }> = [];
    await runWithConcurrency([30, 30, 30], 3, async (delayMs) => {
      const span = { start: Date.now(), end: 0 };
      spans.push(span);
      await deferred(null, delayMs);
      span.end = Date.now();
    });
    // Overlap (not wall-clock) — wall-clock thresholds flake under scheduler jitter.
    const overlapping = spans.some((a) =>
      spans.some((b) => a !== b && a.start < b.end && b.start < a.end),
    );
    expect(overlapping).toBe(true);
  });

  it("clamps limit to item count and to a minimum of 1", async () => {
    await expect(
      runWithConcurrency([1, 2, 3], 100, (item) => Promise.resolve(item)),
    ).resolves.toEqual([1, 2, 3]);
    await expect(
      runWithConcurrency([1, 2, 3], 0, (item) => Promise.resolve(item)),
    ).resolves.toEqual([1, 2, 3]);
    await expect(
      runWithConcurrency([1, 2, 3], Number.NaN, (item) => Promise.resolve(item)),
    ).resolves.toEqual([1, 2, 3]);
  });

  it("returns an empty array for an empty input without invoking the worker", async () => {
    let calls = 0;
    const results = await runWithConcurrency([], 3, () => {
      calls += 1;
      return Promise.resolve(null);
    });
    expect(results).toEqual([]);
    expect(calls).toBe(0);
  });

  it("propagates a worker rejection", async () => {
    await expect(
      runWithConcurrency([1, 2], 2, async (item) => {
        if (item === 2) throw new Error("boom");
        return item;
      }),
    ).rejects.toThrow("boom");
  });
});
