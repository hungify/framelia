import { describe, it, expect } from "vitest";

import { areaGap } from "../src/compare/area-gap.ts";
import { makeSolidPng } from "../src/compare/png.ts";
import { passingScoreThresholdReasons } from "../src/run-bundle/selected-run.ts";

describe("areaGap", () => {
  it("returns 0% for same-size images", () => {
    const a = makeSolidPng(100, 100, [255, 255, 255, 255]);
    const b = makeSolidPng(100, 100, [0, 0, 0, 255]);
    const result = areaGap(a, b);
    expect(result.areaGapPercent).toBe(0);
  });

  it("detects different sizes", () => {
    const a = makeSolidPng(100, 100, [255, 255, 255, 255]);
    const b = makeSolidPng(200, 200, [0, 0, 0, 255]);
    const result = areaGap(a, b);
    expect(result.areaGapPercent).toBeGreaterThan(0);
  });

  it("same area different aspect fails", () => {
    const baseline = makeSolidPng(400, 100, [0, 0, 0, 255]);
    const actual = makeSolidPng(200, 200, [0, 0, 0, 255]);
    const r = areaGap(baseline, actual);
    expect(r.areaGapPercent).toBeGreaterThan(50);
  });

  it("compare() and the selected-run gate agree: 100x100 vs 102x102 is a 2% gap", () => {
    const baselineSize = { width: 100, height: 100 };
    const actualSize = { width: 102, height: 102 };
    expect(areaGap(baselineSize, actualSize).areaGapPercent).toBeCloseTo(2);
    const passing = {
      matchRatio: 1,
      ssim: 1,
      avgDeltaE: 0,
      diffPixels: 0,
      baselineSize,
      actualSize,
    };
    const threshold = {
      minMatch: 0.99,
      minSSIM: 0.97,
      maxAvgDeltaE: 4,
      maxDiffPixels: null,
      maxAreaGapPercent: 2,
    };
    // The old total-area formula reported 4.04% here and rejected a legitimate pass.
    expect(passingScoreThresholdReasons(passing, threshold)).toEqual([]);
    expect(
      passingScoreThresholdReasons(
        { ...passing, actualSize: { width: 103, height: 100 } },
        threshold,
      ),
    ).toEqual(["passing score size gap exceeds the resolved threshold"]);
  });

  it("same size still 0", () => {
    const a = makeSolidPng(100, 80, [0, 0, 0, 255]);
    const b = makeSolidPng(100, 80, [255, 255, 255, 255]);
    expect(areaGap(a, b).areaGapPercent).toBe(0);
  });
});
