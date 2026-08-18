import { describe, expect, it } from "vitest";

import { nextSelectionIndex } from "../composables/useRunDashboard";

describe("nextSelectionIndex", () => {
  it("steps forward and backward within bounds", () => {
    expect(nextSelectionIndex(1, 1, 5)).toBe(2);
    expect(nextSelectionIndex(1, -1, 5)).toBe(0);
  });

  it("wraps past the end back to the start", () => {
    expect(nextSelectionIndex(4, 1, 5)).toBe(0);
  });

  it("wraps past the start back to the end", () => {
    expect(nextSelectionIndex(0, -1, 5)).toBe(4);
  });

  it("normalizes a negative direction whose magnitude exceeds the list length", () => {
    expect(nextSelectionIndex(0, -10, 3)).toBe(2);
  });
});
