import type { BaselineSource, VisualMask, WebTarget } from "@framelia/contracts";

import type { ExpectSize, ProfileName } from "../types.ts";
import type { SCHEMA_VERSION } from "../types.ts";

export interface DoneGateViewport {
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
  viewport: string;
  done: boolean;
  reasons: string[];
}

export interface DoneGateVerdict {
  schemaVersion: typeof SCHEMA_VERSION;
  done: boolean;
  viewports: ViewportVerdict[];
}
