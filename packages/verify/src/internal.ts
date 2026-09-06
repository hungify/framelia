/**
 * The capture seam: everything a matcher runner needs to drive a page capture
 * and enforce the masked-area cap, and nothing else.
 *
 * Callers here bypass the gating logic the primary entry point applies on top
 * of capture, so this is a second real interface -- not a scratch space. Keep
 * it at the union of what crosses the package line; compare and PNG maths stay
 * private behind `compare()`. Test fixtures live at `./testing`.
 */

export { captureReadyPage } from "./capture/core.ts";
export { checkMaskAreaRatio } from "./capture/domain/capture-rules.ts";
export { unionArea } from "./capture/masks.ts";
export { readPng } from "./compare/png.ts";
export type {
  CaptureCoreOutcome,
  CaptureEvidence,
  FontReadiness,
  MaskBounds,
  MaskEvidence,
  ReadyCaptureSpec,
} from "./capture/types.ts";
