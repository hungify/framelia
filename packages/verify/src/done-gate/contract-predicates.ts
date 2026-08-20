import type { BaselineSource, ProfileOverrides, VisualMask, WebTarget } from "@framelia/contracts";

import { getProfile } from "../profiles.ts";
import type { ExpectSize, ProfileName } from "../types.ts";
import { parseMaskEvidence, type ScoreFile } from "./schemas.ts";

export function sameTarget(actual: WebTarget, expected: WebTarget): boolean {
  return actual.kind === expected.kind && actual.url === expected.url;
}

export function sameBaseline(evidence: ScoreFile["baseline"], source: BaselineSource): boolean {
  return (
    evidence.kind === "figma" &&
    source.kind === "figma" &&
    evidence.fileKey === source.fileKey &&
    evidence.nodeId === source.nodeId
  );
}

export function sameSize(actual: ExpectSize | null | undefined, expected?: ExpectSize): boolean {
  if (!actual && !expected) return true;
  return actual?.width === expected?.width && actual?.height === expected?.height;
}

export function sameMasks(
  actual: VisualMask[] | null | undefined,
  expected?: VisualMask[],
): boolean {
  const a = actual ?? [];
  const b = expected ?? [];
  if (a.length !== b.length) return false;
  return a.every((mask, index) => {
    const other = b[index]!;
    return (
      mask.selector === other.selector &&
      mask.reason === other.reason &&
      (mask.maxMatches ?? 1) === (other.maxMatches ?? 1)
    );
  });
}

/** Absent (`undefined`) resolves to the profile's own default; an explicit value -- including
 *  a deliberate `null` on the nullable maxDiffPixels field -- is never replaced by it. */
function resolvedOverride<T>(value: T | undefined, fallback: T): T {
  return value === undefined ? fallback : value;
}

/**
 * Compares two profileOverrides at the *effective* threshold each resolves to against
 * `profileName`, not at the literal declared-override shape. Without this, a page contract
 * that explicitly writes `maxDiffPixels: null` (page's own default) would false-mismatch
 * against evidence that simply omitted the override -- both apply the same no-cap
 * threshold, only one states it as `undefined` and the other by name.
 */
export function sameProfileOverrides(
  profileName: ProfileName,
  actual: ProfileOverrides | null | undefined,
  expected?: ProfileOverrides,
): boolean {
  const defaults = getProfile(profileName);
  const a = actual ?? {};
  const b = expected ?? {};
  return (
    resolvedOverride(a.minMatch, defaults.minMatch) ===
      resolvedOverride(b.minMatch, defaults.minMatch) &&
    resolvedOverride(a.maxDiffPixels, defaults.maxDiffPixels) ===
      resolvedOverride(b.maxDiffPixels, defaults.maxDiffPixels) &&
    resolvedOverride(a.minSSIM, defaults.minSSIM) ===
      resolvedOverride(b.minSSIM, defaults.minSSIM) &&
    resolvedOverride(a.maxAvgDeltaE, defaults.maxAvgDeltaE) ===
      resolvedOverride(b.maxAvgDeltaE, defaults.maxAvgDeltaE) &&
    resolvedOverride(a.maxAreaGapPercent, defaults.maxAreaGapPercent) ===
      resolvedOverride(b.maxAreaGapPercent, defaults.maxAreaGapPercent)
  );
}

export function isUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function completeMaskEvidence(evidence: unknown, masks: VisualMask[]): boolean {
  const parsed = parseMaskEvidence(evidence);
  if (!parsed) return false;
  if (parsed.requested.length !== masks.length) return false;
  const declared = masks.every((mask, index) => {
    const item = parsed.requested[index]!;
    return (
      item.selector === mask.selector &&
      item.reason === mask.reason &&
      item.maxMatches === (mask.maxMatches ?? 1) &&
      item.matchedCount <= item.maxMatches
    );
  });
  if (!declared) return false;
  const declaredTotal = parsed.requested.reduce((sum, item) => sum + item.matchedCount, 0);
  return declaredTotal === parsed.matchedCount;
}
