import * as path from "node:path";

import { getProfile } from "@framelia/contracts";
import type { PNG } from "pngjs";

import { RUN_ARTIFACT } from "../artifacts.ts";
import { PIXEL_THRESHOLD, WHITE_RGBA } from "../constants.ts";
import type { CompareOptions, CompareOutcome, TopIssue } from "../types.ts";
import { areaGap } from "./area-gap.ts";
import { avgDeltaE2000 } from "./delta-e.ts";
import {
  clusterIssue,
  colorIssue,
  expectSizeIssue,
  pixelIssues,
  residualSignal,
  sizeGapIssue,
  ssimIssue,
} from "./issues.ts";
import { buildMaskBitmap } from "./mask.ts";
import {
  clusterFails,
  diffBoundingBox,
  diffClusters,
  largestCluster,
  pixelCompare,
} from "./pixel.ts";
import { detectBorderColor, flattenAlpha, padTo, parseHexRgb, readPng, writePng } from "./png.ts";
import { SSIM_WINDOW_SIZE, ssimCompare, ssimDownsampleFactor, ssimWindowSize } from "./ssim.ts";

const MAX_AREA_GAP_PERCENT = 100;

// This module's seam is `compare()` alone -- the pipeline orchestrator. Low-level
// building blocks (area-gap, delta-e, pixel, png, ssim) have their own seam at
// internal.ts; import from the submodules directly there, not through this barrel.

interface Size {
  width: number;
  height: number;
}

/** Shared shape for the two early-exit paths: no pixel/SSIM/deltaE signal was ever computed. */
function skippedOutcome(input: {
  areaGapPercent: number;
  baselineSize: Size;
  actualSize: Size;
  topIssues: TopIssue[];
  warnings: string[];
}): CompareOutcome {
  return {
    pass: false,
    matchRatio: null,
    ssim: null,
    avgDeltaE: null,
    areaGapPercent: input.areaGapPercent,
    clusterFail: false,
    diffPixels: null,
    totalPixels: null,
    baselineSize: input.baselineSize,
    actualSize: input.actualSize,
    resizedForCompare: false,
    topIssues: input.topIssues,
    warnings: input.warnings,
    diffPath: null,
    diffClusters: [],
  };
}

/**
 * Drops explicitly-`undefined` keys before merging overrides onto a profile's defaults.
 * An override object built from optional variables (e.g. `{ minMatch: maybeUndefined }`)
 * can carry a present-but-`undefined` key; a plain spread would let that `undefined`
 * clobber the resolved default (comparisons against `undefined` are always false, so
 * `minMatch: undefined` silently fails the match-ratio check with no diagnostic).
 * `null` is preserved -- it's a legitimate value (`maxDiffPixels: null` means no cap).
 */
function definedOverrides<T extends object>(overrides: T | undefined): Partial<T> {
  if (!overrides) return {};
  return Object.fromEntries(
    Object.entries(overrides).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

export function compare(
  baselinePath: string,
  actualPath: string,
  outDir: string,
  options: CompareOptions,
): CompareOutcome {
  const profile = { ...getProfile(options.profile), ...definedOverrides(options.profileOverrides) };

  let baseline: PNG;
  let actual: PNG;
  try {
    baseline = readPng(baselinePath);
    actual = readPng(actualPath);
  } catch (err) {
    return skippedOutcome({
      areaGapPercent: MAX_AREA_GAP_PERCENT,
      baselineSize: { width: 0, height: 0 },
      actualSize: { width: 0, height: 0 },
      topIssues: [
        {
          severity: "high",
          kind: "pixel",
          message: `Cannot read PNG: ${err instanceof Error ? err.message : String(err)}`,
          hint: "Check baseline and actual paths",
          repairCandidate: false,
          blocking: true,
        },
      ],
      warnings: [],
    });
  }

  const topIssues: TopIssue[] = [];
  const warnings: string[] = [];

  const expectSizeProblem = expectSizeIssue(actual, options.expectSize);
  if (expectSizeProblem) topIssues.push(expectSizeProblem);

  const gap = areaGap(baseline, actual);
  const sizeGapProblem = sizeGapIssue(gap, profile);
  if (sizeGapProblem) {
    topIssues.push(sizeGapProblem);
    return skippedOutcome({
      areaGapPercent: gap.areaGapPercent,
      baselineSize: gap.baselineSize,
      actualSize: gap.actualSize,
      topIssues,
      warnings,
    });
  }

  const width = Math.max(baseline.width, actual.width);
  const height = Math.max(baseline.height, actual.height);
  const resizedForCompare = baseline.width !== actual.width || baseline.height !== actual.height;
  const fillColor = detectBorderColor(baseline);
  // Flatten both aligned images onto one opaque background once, up front. Otherwise each
  // metric treats alpha its own way -- pixelmatch blends onto white, SSIM and ΔE read raw
  // RGB and ignore alpha -- so a transparent pixel could match under one and not another.
  const background: [number, number, number] = options.canvasFill
    ? parseHexRgb(options.canvasFill)
    : fillColor[3] === 255
      ? [fillColor[0], fillColor[1], fillColor[2]]
      : [WHITE_RGBA[0], WHITE_RGBA[1], WHITE_RGBA[2]];
  const baselineAligned = flattenAlpha(padTo(baseline, width, height, fillColor), background);
  const actualAligned = flattenAlpha(padTo(actual, width, height, fillColor), background);

  const maskBitmap = options.maskBounds?.length
    ? buildMaskBitmap(width, height, options.maskBounds)
    : null;

  const pixel = pixelCompare(baselineAligned, actualAligned, PIXEL_THRESHOLD, false, maskBitmap);
  const diffPath = path.join(outDir, RUN_ARTIFACT.diff);
  writePng(diffPath, pixel.diff);

  const ssim = ssimCompare(baselineAligned, actualAligned, maskBitmap);
  const ssimWindow = ssimWindowSize(width, height);
  if (ssimWindow < SSIM_WINDOW_SIZE) {
    warnings.push(
      `ssim used a reduced ${ssimWindow}x${ssimWindow} window: the ${width}x${height} comparison is narrower than the standard ${SSIM_WINDOW_SIZE}px window.`,
    );
  }
  const ssimFactor = ssimDownsampleFactor(width, height);
  if (ssimFactor > 1) {
    warnings.push(
      `ssim computed on a ${ssimFactor}x box-downsampled copy of the ${width}x${height} comparison (memory budget); pixel and ΔE metrics use full resolution.`,
    );
  }

  const bbox = diffBoundingBox(pixel.diff);
  const avgDeltaE = bbox
    ? avgDeltaE2000(baselineAligned, actualAligned, bbox, undefined, maskBitmap)
    : 0;
  const clusters = diffClusters(pixel.diff);

  const clusterOn = options.clusterCheck ?? profile.cluster;
  const clusterFail =
    clusterOn && clusterFails(pixel.matchRatio, pixel.worstCellMatchRatio, profile.minMatch);

  topIssues.push(...pixelIssues(pixel, profile));
  const ssimProblem = ssimIssue(ssim, profile);
  if (ssimProblem) topIssues.push(ssimProblem);
  const colorProblem = colorIssue(avgDeltaE, profile);
  if (colorProblem) topIssues.push(colorProblem);
  const clusterProblem = clusterIssue(clusterFail, pixel);
  if (clusterProblem) topIssues.push(clusterProblem);

  const expectSizeFail = topIssues.some((i) => i.kind === "expect-size");
  const pass =
    !expectSizeFail &&
    pixel.matchRatio >= profile.minMatch &&
    (profile.maxDiffPixels === null || pixel.diffPixels <= profile.maxDiffPixels) &&
    ssim >= profile.minSSIM &&
    avgDeltaE <= profile.maxAvgDeltaE &&
    !clusterFail;

  const residual = residualSignal({
    pass,
    realDiffs: pixel.diffPixels,
    largestCluster: largestCluster(clusters),
    residualBox: bbox,
  });
  if (residual.warning) warnings.push(residual.warning);
  if (residual.topIssue) topIssues.push(residual.topIssue);

  return {
    pass,
    matchRatio: pixel.matchRatio,
    ssim,
    avgDeltaE,
    areaGapPercent: gap.areaGapPercent,
    clusterFail,
    diffPixels: pixel.diffPixels,
    totalPixels: pixel.totalPixels,
    baselineSize: gap.baselineSize,
    actualSize: gap.actualSize,
    resizedForCompare,
    topIssues,
    warnings,
    diffPath,
    diffClusters: clusters,
  };
}
