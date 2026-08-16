import { describe, expect, it } from "vitest";

import { formatRatio } from "../lib/format";

describe("formatRatio", () => {
  it("renders dash for nullish", () => {
    expect(formatRatio(null)).toBe("—");
    expect(formatRatio(undefined)).toBe("—");
  });

  it("formats percentages", () => {
    expect(formatRatio(0)).toBe("0.00%");
    expect(formatRatio(0.012)).toBe("1.20%");
    expect(formatRatio(1)).toBe("100.00%");
  });

  it("clamps tiny positive ratios", () => {
    expect(formatRatio(0.00001)).toBe("<0.01%");
  });
});
