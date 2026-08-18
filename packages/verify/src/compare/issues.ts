import { CLUSTER_GRID, EXPECT_SIZE_TOLERANCE_PX, RESIDUAL_CLUSTER_BLOCK } from "../constants.ts";
import type { Profile } from "../profiles.ts";
import type { ExpectSize, TopIssue } from "../types.ts";
import type { AreaGapResult } from "./area-gap.ts";
import type { DiffCluster, PixelResult } from "./pixel.ts";

export function expectSizeIssue(
  actual: { width: number; height: number },
  expectSize: ExpectSize | undefined,
): TopIssue | null {
  if (!expectSize) return null;
  const dw = Math.abs(actual.width - expectSize.width);
  const dh = Math.abs(actual.height - expectSize.height);
  if (dw <= EXPECT_SIZE_TOLERANCE_PX && dh <= EXPECT_SIZE_TOLERANCE_PX) return null;
  return {
    severity: "high",
    kind: "expect-size",
    message: `actual is ${actual.width}x${actual.height}, expected ${expectSize.width}x${expectSize.height} (+/-${EXPECT_SIZE_TOLERANCE_PX}px)`,
    hint: "Check the captured element's CSS size against the Figma frame spec.",
    repairCandidate: true,
    blocking: true,
  };
}

export function sizeGapIssue(gap: AreaGapResult, profile: Profile): TopIssue | null {
  if (gap.areaGapPercent <= profile.maxAreaGapPercent) return null;
  return {
    severity: "high",
    kind: "size",
    message:
      `per-axis size gap ${gap.areaGapPercent.toFixed(2)}% exceeds ` +
      `${profile.maxAreaGapPercent}% (baseline ${gap.baselineSize.width}x${gap.baselineSize.height}, ` +
      `actual ${gap.actualSize.width}x${gap.actualSize.height})`,
    hint: "Fix the element's rendered size first; pixel/SSIM/deltaE were skipped as they would only reflect the size skew.",
    repairCandidate: true,
    blocking: true,
  };
}

export function pixelIssues(pixel: PixelResult, profile: Profile): TopIssue[] {
  const issues: TopIssue[] = [];
  if (pixel.matchRatio < profile.minMatch) {
    issues.push({
      severity: "high",
      kind: "pixel",
      message: `matchRatio ${(pixel.matchRatio * 100).toFixed(2)}% below ${(profile.minMatch * 100).toFixed(2)}% (${pixel.diffPixels}/${pixel.totalPixels} px differ)`,
      hint: "Inspect diff.png for red regions.",
      repairCandidate: false,
      blocking: true,
    });
  }
  if (profile.maxDiffPixels !== null && pixel.diffPixels > profile.maxDiffPixels) {
    issues.push({
      severity: "high",
      kind: "pixel",
      message: `diffPixels ${pixel.diffPixels} exceeds budget ${profile.maxDiffPixels}`,
      hint: "Component-level budget: localize the change via diff.png.",
      repairCandidate: false,
      blocking: true,
    });
  }
  return issues;
}

export function ssimIssue(ssim: number, profile: Profile): TopIssue | null {
  if (ssim >= profile.minSSIM) return null;
  return {
    severity: "medium",
    kind: "ssim",
    message: `SSIM ${ssim.toFixed(4)} below ${profile.minSSIM} (structural mismatch: layout/spacing/shape)`,
    repairCandidate: false,
    blocking: true,
  };
}

export function colorIssue(avgDeltaE: number, profile: Profile): TopIssue | null {
  if (avgDeltaE <= profile.maxAvgDeltaE) return null;
  return {
    severity: "medium",
    kind: "color",
    message: `avg deltaE2000 ${avgDeltaE.toFixed(2)} over diff region exceeds ${profile.maxAvgDeltaE} (color/token mismatch)`,
    hint: "Check color tokens against Figma variables.",
    repairCandidate: false,
    blocking: true,
  };
}

export function clusterIssue(clusterFail: boolean, pixel: PixelResult): TopIssue | null {
  if (!clusterFail) return null;
  return {
    severity: "high",
    kind: "cluster",
    message: `worst ${CLUSTER_GRID}x${CLUSTER_GRID} grid cell matchRatio ${(pixel.worstCellMatchRatio * 100).toFixed(2)}%; localized region is broken while the page average passes`,
    hint: "Full-page ratio is diluted; verify the failing region with a content-crop run.",
    repairCandidate: false,
    blocking: true,
  };
}

export interface ResidualSignal {
  topIssue: TopIssue | null;
  warning: string | null;
}

export function residualSignal(input: {
  pass: boolean;
  realDiffs: number;
  largestCluster: DiffCluster | null;
  residualBox: { x0: number; y0: number; x1: number; y1: number } | null;
}): ResidualSignal {
  const { pass, realDiffs, largestCluster, residualBox } = input;
  if (!pass || !residualBox) return { topIssue: null, warning: null };

  if (largestCluster && largestCluster.pixels >= RESIDUAL_CLUSTER_BLOCK) {
    const message =
      `pass=true but largest residual cluster has ${largestCluster.pixels}/${realDiffs} red px ` +
      `in bbox ${largestCluster.bbox.x0},${largestCluster.bbox.y0}-${largestCluster.bbox.x1},${largestCluster.bbox.y1}; ` +
      `inspect diff.png (CTA / inputs / icons may still be wrong).`;
    return {
      warning: message,
      topIssue: {
        severity: "medium",
        kind: "residual",
        message,
        hint: "Do not claim done on pass alone. Prefer content-crop (component/strict + selector) if this is a full-page run.",
        repairCandidate: false,
        blocking: false,
      },
    };
  }

  if (realDiffs > 0) {
    return {
      warning: null,
      topIssue: {
        severity: "low",
        kind: "residual",
        message: `${realDiffs} dispersed residual red diff px; largest cluster ${largestCluster?.pixels ?? 0} (bbox ${residualBox.x0},${residualBox.y0}-${residualBox.x1},${residualBox.y1})`,
        hint: "Read diff.png before claiming visual done.",
        repairCandidate: false,
        blocking: false,
      },
    };
  }

  return { topIssue: null, warning: null };
}
