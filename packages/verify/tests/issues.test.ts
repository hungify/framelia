import { describe, expect, it } from "vitest";

import type { AreaGapResult } from "../src/compare/area-gap.ts";
import {
  clusterIssue,
  colorIssue,
  expectSizeIssue,
  pixelIssues,
  residualSignal,
  sizeGapIssue,
  ssimIssue,
} from "../src/compare/issues.ts";
import type { DiffCluster, PixelResult } from "../src/compare/pixel.ts";
import { getProfile } from "../src/profiles.ts";

const profile = getProfile("component/strict");

function pixelResult(overrides: Partial<PixelResult> = {}): PixelResult {
  return {
    matchRatio: 1,
    diffPixels: 0,
    totalPixels: 10_000,
    // Real callers pass a pngjs PNG; issues.ts never reads it, only the
    // numeric fields, so a minimal stand-in is safe here.
    diff: {} as PixelResult["diff"],
    worstCellMatchRatio: 1,
    ...overrides,
  };
}

describe("expectSizeIssue", () => {
  it("returns null when no expectSize is declared", () => {
    expect(expectSizeIssue({ width: 100, height: 50 }, undefined)).toBeNull();
  });

  it("returns null within tolerance", () => {
    expect(expectSizeIssue({ width: 101, height: 50 }, { width: 100, height: 50 })).toBeNull();
  });

  it("returns a blocking, repair-candidate issue beyond tolerance", () => {
    const issue = expectSizeIssue({ width: 110, height: 50 }, { width: 100, height: 50 });
    expect(issue).toMatchObject({
      severity: "high",
      kind: "expect-size",
      repairCandidate: true,
      blocking: true,
    });
    expect(issue?.message).toContain("actual is 110x50, expected 100x50");
  });
});

describe("sizeGapIssue", () => {
  const gap: AreaGapResult = {
    areaGapPercent: 0,
    baselineSize: { width: 100, height: 100 },
    actualSize: { width: 100, height: 100 },
  };

  it("returns null at or under the profile's maxAreaGapPercent", () => {
    expect(sizeGapIssue({ ...gap, areaGapPercent: profile.maxAreaGapPercent }, profile)).toBeNull();
  });

  it("returns a blocking size issue over the cap", () => {
    const issue = sizeGapIssue({ ...gap, areaGapPercent: profile.maxAreaGapPercent + 1 }, profile);
    expect(issue).toMatchObject({ severity: "high", kind: "size", blocking: true });
  });
});

describe("pixelIssues", () => {
  it("returns no issues when both matchRatio and diffPixels budget are within profile", () => {
    expect(pixelIssues(pixelResult(), profile)).toEqual([]);
  });

  it("flags matchRatio below the profile minimum", () => {
    const issues = pixelIssues(
      pixelResult({ matchRatio: profile.minMatch - 0.01, diffPixels: 5, totalPixels: 1000 }),
      profile,
    );
    expect(issues.some((i) => i.message.includes("matchRatio"))).toBe(true);
  });

  it("flags diffPixels exceeding the profile's maxDiffPixels budget", () => {
    const overBudget = (profile.maxDiffPixels ?? 0) + 1;
    const issues = pixelIssues(pixelResult({ diffPixels: overBudget }), profile);
    expect(issues.some((i) => i.message.includes("exceeds budget"))).toBe(true);
  });

  it("can flag both at once", () => {
    const overBudget = (profile.maxDiffPixels ?? 0) + 1;
    const issues = pixelIssues(
      pixelResult({ matchRatio: profile.minMatch - 0.5, diffPixels: overBudget }),
      profile,
    );
    expect(issues).toHaveLength(2);
  });
});

describe("ssimIssue", () => {
  it("returns null at or above the profile minimum", () => {
    expect(ssimIssue(profile.minSSIM, profile)).toBeNull();
  });

  it("returns a non-blocking-repair, medium-severity issue below the minimum", () => {
    const issue = ssimIssue(profile.minSSIM - 0.01, profile);
    expect(issue).toMatchObject({
      severity: "medium",
      kind: "ssim",
      blocking: true,
      repairCandidate: false,
    });
  });
});

describe("colorIssue", () => {
  it("returns null at or under maxAvgDeltaE", () => {
    expect(colorIssue(profile.maxAvgDeltaE, profile)).toBeNull();
  });

  it("returns a color issue over the threshold", () => {
    const issue = colorIssue(profile.maxAvgDeltaE + 1, profile);
    expect(issue).toMatchObject({ kind: "color", blocking: true });
  });
});

describe("clusterIssue", () => {
  it("returns null when clusterFail is false", () => {
    expect(clusterIssue(false, pixelResult({ worstCellMatchRatio: 0 }))).toBeNull();
  });

  it("returns a blocking cluster issue when clusterFail is true", () => {
    const issue = clusterIssue(true, pixelResult({ worstCellMatchRatio: 0.5 }));
    expect(issue).toMatchObject({ severity: "high", kind: "cluster", blocking: true });
    expect(issue?.message).toContain("50.00%");
  });
});

describe("residualSignal", () => {
  const residualBox = { x0: 0, y0: 0, x1: 10, y1: 10 };
  const bigCluster: DiffCluster = { pixels: 200, bbox: residualBox };
  const smallCluster: DiffCluster = { pixels: 3, bbox: residualBox };

  it("is silent when pass is false", () => {
    expect(
      residualSignal({ pass: false, realDiffs: 5, largestCluster: smallCluster, residualBox }),
    ).toEqual({ topIssue: null, warning: null });
  });

  it("is silent when there is no residual box (nothing to report)", () => {
    expect(
      residualSignal({ pass: true, realDiffs: 0, largestCluster: null, residualBox: null }),
    ).toEqual({ topIssue: null, warning: null });
  });

  it("warns and produces a medium topIssue when pass=true but a large cluster survives", () => {
    const signal = residualSignal({
      pass: true,
      realDiffs: 200,
      largestCluster: bigCluster,
      residualBox,
    });
    expect(signal.warning).toContain("pass=true but largest residual cluster");
    expect(signal.topIssue).toMatchObject({
      severity: "medium",
      kind: "residual",
      blocking: false,
    });
  });

  it("produces a low, non-blocking, warning-free topIssue for small dispersed residuals", () => {
    const signal = residualSignal({
      pass: true,
      realDiffs: 3,
      largestCluster: smallCluster,
      residualBox,
    });
    expect(signal.warning).toBeNull();
    expect(signal.topIssue).toMatchObject({ severity: "low", kind: "residual", blocking: false });
  });

  it("is silent when pass=true, a residual box exists, but there are zero real diffs and no cluster", () => {
    expect(residualSignal({ pass: true, realDiffs: 0, largestCluster: null, residualBox })).toEqual(
      { topIssue: null, warning: null },
    );
  });
});
