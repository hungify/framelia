import * as path from "node:path";

import type { PNG } from "pngjs";

import { RUN_ARTIFACT } from "../artifacts.ts";
import { PIXEL_THRESHOLD } from "../constants.ts";
import { getProfile } from "../profiles.ts";
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
import {
  clusterFails,
  countRealDiffPixels,
  diffBoundingBox,
  largestRealDiffCluster,
  pixelCompare,
} from "./pixel.ts";
import { detectBorderColor, padTo, readPng, writePng } from "./png.ts";
import { ssimCompare } from "./ssim.ts";

const MAX_AREA_GAP_PERCENT = 100;

export { areaGap } from "./area-gap.ts";
export { avgDeltaE2000 } from "./delta-e.ts";
export {
  countRealDiffPixels,
  diffBoundingBox,
  largestRealDiffCluster,
  pixelCompare,
} from "./pixel.ts";
export {
  compositeOnCanvas,
  detectBorderColor,
  makeSolidPng,
  padTo,
  parseHexRgb,
  parsePng,
  readPng,
  writePng,
} from "./png.ts";
export { ssimCompare } from "./ssim.ts";

interface Size {
  width: number;
  height: number;
}

/** Shared shape for the two early-exit paths: no pixel/SSIM/deltaE signal was ever computed. */
function skippedOutcome(input: {
  areaGapPercent: number;
  goldSize: Size;
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
    goldSize: input.goldSize,
    actualSize: input.actualSize,
    resizedForCompare: false,
    topIssues: input.topIssues,
    warnings: input.warnings,
    diffPath: null,
  };
}

export function compare(
  goldPath: string,
  actualPath: string,
  outDir: string,
  options: CompareOptions,
): CompareOutcome {
  const profile = getProfile(options.profile);

  let gold: PNG;
  let actual: PNG;
  try {
    gold = readPng(goldPath);
    actual = readPng(actualPath);
  } catch (err) {
    return skippedOutcome({
      areaGapPercent: MAX_AREA_GAP_PERCENT,
      goldSize: { width: 0, height: 0 },
      actualSize: { width: 0, height: 0 },
      topIssues: [
        {
          severity: "high",
          kind: "pixel",
          message: `Cannot read PNG: ${err instanceof Error ? err.message : String(err)}`,
          hint: "Check gold and actual paths",
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

  const gap = areaGap(gold, actual);
  const sizeGapProblem = sizeGapIssue(gap, profile);
  if (sizeGapProblem) {
    topIssues.push(sizeGapProblem);
    return skippedOutcome({
      areaGapPercent: gap.areaGapPercent,
      goldSize: gap.goldSize,
      actualSize: gap.actualSize,
      topIssues,
      warnings,
    });
  }

  const width = Math.max(gold.width, actual.width);
  const height = Math.max(gold.height, actual.height);
  const resizedForCompare = gold.width !== actual.width || gold.height !== actual.height;
  const fillColor = detectBorderColor(gold);
  const goldAligned = padTo(gold, width, height, fillColor);
  const actualAligned = padTo(actual, width, height, fillColor);

  const pixel = pixelCompare(goldAligned, actualAligned, PIXEL_THRESHOLD, false);
  const diffPath = path.join(outDir, RUN_ARTIFACT.diff);
  writePng(diffPath, pixel.diff);

  const ssim = ssimCompare(goldAligned, actualAligned);

  const bbox = diffBoundingBox(pixel.diff);
  const avgDeltaE = bbox ? avgDeltaE2000(goldAligned, actualAligned, bbox) : 0;

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
    realDiffs: countRealDiffPixels(pixel.diff),
    largestCluster: largestRealDiffCluster(pixel.diff),
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
    goldSize: gap.goldSize,
    actualSize: gap.actualSize,
    resizedForCompare,
    topIssues,
    warnings,
    diffPath,
  };
}
