import type { BaselineSource, VisualMask, WebTarget } from "@framelia/contracts";

import type { ExpectSize, ProfileName } from "../types.ts";
import type { SCHEMA_VERSION } from "../types.ts";

export interface DoneGateViewport {
  /** Contract id this viewport was derived from. Verdicts are matched back to contracts by
   * id, not array position, so callers that filter/reorder viewports don't misattribute
   * a verdict to the wrong contract. Optional for callers that only ever inspect the
   * returned verdict by index and never re-associate it with a contract afterward. */
  id?: string;
  viewport: string;
  outDir: string;
  baseline: BaselineSource;
  target: WebTarget;
  profile: ProfileName;
  selector?: string;
  expectSize?: ExpectSize;
  pageReason?: string;
  masks?: VisualMask[];
  maxMaskedAreaRatio?: number;
}

export interface DoneGateOptions {
  viewports: DoneGateViewport[];
  maxScoreAgeMs?: number;
  maxBaselineAgeMs?: number;
  now?: () => number;
  cwd?: string;
}

export interface ViewportVerdict {
  /** Mirrors DoneGateViewport.id when the producing DoneGateViewport set one. */
  id?: string;
  viewport: string;
  done: boolean;
  reasons: string[];
}

export interface DoneGateVerdict {
  schemaVersion: typeof SCHEMA_VERSION;
  done: boolean;
  viewports: ViewportVerdict[];
}
