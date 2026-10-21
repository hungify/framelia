import type { Profile } from "@framelia/contracts";
import type { CompareOutcome } from "@framelia/verify";
import type { MatcherReturnType } from "@playwright/test";

/** Results that report "the comparison could not run" (setup, fetch, capture, navigation)
 *  rather than "the images differ" -- see `operationalFailure`. */
const operationalFailures = new WeakSet<MatcherReturnType>();

/**
 * A `pass: false` result that is not a visual verdict: missing file key, a failed Figma
 * fetch, a failed capture, a missing promoted baseline. Under `.not`, Playwright would
 * invert such a result into a silent pass, so the registered matcher wrappers throw it
 * instead (see `settleMatcherResult`).
 */
export function operationalFailure(message: string): MatcherReturnType {
  const result: MatcherReturnType = { pass: false, message: () => message };
  operationalFailures.add(result);
  return result;
}

/** Registered-matcher glue: under `.not`, an operational failure throws rather than
 *  becoming a pass; every other result is returned unchanged for Playwright to invert. */
export function settleMatcherResult(isNot: boolean, result: MatcherReturnType): MatcherReturnType {
  if (isNot && operationalFailures.has(result)) throw new Error(result.message());
  return result;
}

function formatNumber(value: number | null, digits: number): string {
  return value === null ? "n/a" : value.toFixed(digits);
}

/**
 * One-line explanation of a failed comparison: every measured metric next to the threshold
 * it was judged against, the size/area gap, the cluster check, and the first blocking issue
 * -- enough to see *why* it failed without opening the attachments.
 */
export function describeMismatch(outcome: CompareOutcome, threshold: Profile): string {
  const parts = [
    `matchRatio ${formatNumber(outcome.matchRatio, 4)} (min ${threshold.minMatch})`,
    `ssim ${formatNumber(outcome.ssim, 4)} (min ${threshold.minSSIM})`,
    `avgDeltaE ${formatNumber(outcome.avgDeltaE, 2)} (max ${threshold.maxAvgDeltaE})`,
  ];
  if (threshold.maxDiffPixels !== null) {
    parts.push(`diffPixels ${outcome.diffPixels ?? "n/a"} (max ${threshold.maxDiffPixels})`);
  }
  parts.push(
    `size expected ${outcome.baselineSize.width}x${outcome.baselineSize.height} vs actual ${outcome.actualSize.width}x${outcome.actualSize.height}, areaGap ${outcome.areaGapPercent.toFixed(2)}% (max ${threshold.maxAreaGapPercent}%)`,
  );
  if (outcome.clusterFail) parts.push("diff cluster check failed");
  const blocking = outcome.topIssues.find((issue) => issue.blocking);
  if (blocking) parts.push(`first blocking issue: ${blocking.message}`);
  return parts.join(", ");
}
