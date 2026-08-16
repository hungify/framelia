/**
 * Low-level building blocks behind the primary compare()/done-gate pipeline.
 * Import from here only when composing a custom diagnostic pipeline (see cli
 * `debug` commands) — everything here bypasses the gating logic that the
 * primary entry points apply on top of it.
 */

export {
  areaGap,
  avgDeltaE2000,
  compositeOnCanvas,
  countRealDiffPixels,
  diffBoundingBox,
  largestRealDiffCluster,
  makeSolidPng,
  padTo,
  parseHexRgb,
  parsePng,
  pixelCompare,
  readPng,
  ssimCompare,
  writePng,
} from "./compare/index.ts";

export { resolveSelector } from "./capture/readiness.ts";
export { captureReadyPage } from "./capture/core.ts";
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

export { diffPhase } from "./phases.ts";

export {
  clearNodeMetaCache,
  deriveExpectStyle,
  getNodeMetadata,
  resolveNodeSpec,
  resolveToken,
} from "./figma-api.ts";
export type { NodeMetadata, ResolveNodeSpecOutcome } from "./figma-api.ts";
