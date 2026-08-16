import { SCHEMA_VERSION } from "../../types.ts";
import type { ExpectSize, RejectResult } from "../../types.ts";
import { fontIncomplete } from "../settle.ts";
import type { FontReadiness } from "../types.ts";

/**
 * Pure pass/fail decisions for capture. No Playwright, no filesystem — every
 * function here takes data already read from the page/disk and returns a
 * verdict. Callers (core.ts, masks.ts, readiness.ts, spec.ts) own reading the
 * data; this module owns deciding what it means.
 */

function reject(error: RejectResult["error"], message: string): RejectResult {
  return { schemaVersion: SCHEMA_VERSION, ok: false, error, message };
}

export function checkFontReadiness(
  fonts: FontReadiness,
  policy: "required" | "warn" | undefined,
  messageSuffix = "",
): RejectResult | null {
  if (policy !== "required" || !fontIncomplete(fonts)) return null;
  return reject(
    "FONT_READY_FAILED",
    `Font loading incomplete${messageSuffix}; failed: ${fonts.failed.join(", ") || fonts.status}.`,
  );
}

export function checkScopeSize(
  actual: { width: number; height: number },
  expected: ExpectSize | undefined,
  tolerancePx = 0.5,
): RejectResult | null {
  if (!expected) return null;
  const dw = Math.abs(actual.width - expected.width);
  const dh = Math.abs(actual.height - expected.height);
  if (dw <= tolerancePx && dh <= tolerancePx) return null;
  return reject(
    "SCOPE_SIZE_MISMATCH",
    `Region size ${Math.round(actual.width)}x${Math.round(actual.height)} differs from expected ${expected.width}x${expected.height}.`,
  );
}

export function checkMaskAreaRatio(ratio: number, cap: number): RejectResult | null {
  if (ratio <= cap) return null;
  return reject(
    "MASK_AREA_EXCEEDED",
    `Mask area ratio ${ratio.toFixed(4)} exceeds cap ${cap.toFixed(4)}.`,
  );
}

export function checkUniqueMatch(
  matchCount: number,
  error: "SELECTOR_AMBIGUOUS" | "READY_SELECTOR_AMBIGUOUS",
  message: string,
): RejectResult | null {
  if (matchCount === 1) return null;
  return { ...reject(error, message), matchCount };
}
