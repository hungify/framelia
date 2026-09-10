import type { BaselineSource, VisualMask } from "@framelia/contracts";

import type { ComputedTextStyle, RejectResult } from "../types.ts";

export const MASK_COLOR = "#FF00FF";

export interface MaskBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MaskEvidence {
  requested: Array<{ selector: string; reason: string; maxMatches: number; matchedCount: number }>;
  matchedCount: number;
  bounds: MaskBounds[];
  unionMaskedArea: number;
  maskedAreaRatio: number;
  maskColor: typeof MASK_COLOR;
  status: "applied" | "skipped" | "failed";
  code?: string;
  message?: string;
  resolvedAt: string;
}

type CaptureScope =
  | { kind: "page"; fullPage: boolean }
  | { kind: "region"; selector: string; expectedSize?: { width: number; height: number } };

/**
 * Spec for {@link captureReadyPage} (core.ts) — screenshots a `Page` the
 * caller has already navigated, authenticated, and interacted with. No
 * `url`/`navigation`/`state`/`readyEvent`/`readySelector`/`retry` field:
 * this primitive never navigates, so it has no navigation-time concerns, and
 * it never reloads between samples, so it captures exactly one sample (a
 * reload would discard the caller's own auth/form state).
 */
export interface ReadyCaptureSpec {
  /** Contract identity retained in evidence; renderer never derives state from CLI flags. */
  identity?: { id: string; baseline: BaselineSource };
  outPath: string;
  scope: CaptureScope;
  screenshot: { masks?: VisualMask[]; maxMaskedAreaRatio?: number };
  timeoutMs?: number;
  devtoolsSelector?: true | string;
  /** Device pixel ratio to capture at (matches the Page's own context configuration --
   *  see captureReadyPage's doc comment). 1 (the default) captures one PNG pixel per CSS
   *  px, unchanged from before this option existed. >1 captures at that many physical
   *  pixels per CSS px instead, for a sharper image; every CSS-px-based bound this module
   *  reports (mask evidence, selector bounds) is scaled to match. */
  scale?: number;
  fontPolicy?: "required" | "warn";
  animationPolicy?: "freeze" | "allow";
}

export interface FontReadiness {
  supported: boolean;
  status: "loaded" | "loading" | "unknown";
  failed: string[];
}

export interface CaptureEvidence {
  contract: ReadyCaptureSpec["identity"] | null;
  capturePaths: string[];
  /** Always empty for captureReadyPage (single-sample, no reload) — kept for
   * evidence-shape compatibility with CaptureSuccess's original stability-sample field. */
  ephemeralSamplePaths: string[];
  capturedAt: string;
  startedAt: string;
  finishedAt: string;
  finalUrl: string;
  viewport: { width: number; height: number } | null;
  readiness: {
    selector?: string;
    event?: string;
    matchCount?: number;
    status: "passed" | "failed";
  } | null;
  fonts: FontReadiness;
  scope: CaptureScope;
  screenshotHashes: string[];
  elementRect: { width: number; height: number } | null;
  computedStyle: ComputedTextStyle | null;
  warnings: string[];
  /** Always empty: navigation-action retry evidence no longer exists once framelia stopped owning navigation. */
  actions: never[];
  maskEvidence: MaskEvidence | null;
}

export type CaptureCoreOutcome = ({ ok: true } & CaptureEvidence) | RejectResult;
