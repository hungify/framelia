/**
 * Low-level building blocks behind the primary compare()/done-gate pipeline.
 * Real callers: @framelia/playwright's capture.ts and score-attachment.ts
 * depend on captureReadyPage/CaptureCoreOutcome/CaptureEvidence for every
 * matcher run, not just diagnostic tooling — everything here bypasses the
 * gating logic that the primary entry points apply on top of it, so treat
 * it as a second real interface (capture primitives), not a scratch space.
 */

export { areaGap } from "./compare/area-gap.ts";
export { avgDeltaE2000 } from "./compare/delta-e.ts";
export {
  countRealDiffPixels,
  diffBoundingBox,
  diffClusters,
  largestCluster,
  largestRealDiffCluster,
  pixelCompare,
} from "./compare/pixel.ts";
export {
  compositeOnCanvas,
  makeSolidPng,
  padTo,
  parseHexRgb,
  parsePng,
  readPng,
  writePng,
} from "./compare/png.ts";
export { ssimCompare } from "./compare/ssim.ts";

export { resolveSelector } from "./capture/readiness.ts";
export { captureReadyPage } from "./capture/core.ts";
export { checkMaskAreaRatio } from "./capture/domain/capture-rules.ts";
export { unionArea } from "./capture/masks.ts";
export { settle } from "./capture/settle.ts";
export { MASK_COLOR } from "./capture/types.ts";
export type {
  CaptureEvidence,
  CaptureCoreOutcome,
  FontReadiness,
  MaskBounds,
  MaskEvidence,
  ReadyCaptureSpec,
} from "./capture/types.ts";
