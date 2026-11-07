import { describe, expect, it } from "vitest";

import { remainingTestBudgetMs, TEST_TIMEOUT_MARGIN_MS } from "../src/timeout.ts";

describe("remainingTestBudgetMs", () => {
  it("returns what is left of the test timeout after elapsed time and the margin", () => {
    expect(remainingTestBudgetMs(30_000, 12_000, 60_000)).toBe(
      30_000 - 12_000 - TEST_TIMEOUT_MARGIN_MS,
    );
  });

  it("never returns less than 1ms once the budget is spent", () => {
    expect(remainingTestBudgetMs(5_000, 9_000, 60_000)).toBe(1);
  });

  it("uses the fallback for an unlimited (0) test timeout", () => {
    expect(remainingTestBudgetMs(0, 12_000, 60_000)).toBe(60_000);
  });
});
