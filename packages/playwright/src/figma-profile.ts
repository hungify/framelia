import type { ProfileName } from "@framelia/verify";

export interface FigmaCompareOptions {
  profile: ProfileName;
  clusterCheck?: boolean;
}

/**
 * Figma-baselined matches default to component/strict (not compare-pages's component/dev)
 * because they're eligible for done-gate, which forbids component/dev outright -- see
 * done-gate/validate.ts. The one place both toMatchFigma and the reporter's live-run
 * reconstruction of the same score apply this rule, so it can't drift between them.
 *
 * The default component comparison also forces the cluster check on, independent of
 * component/strict's own `cluster: false` setting -- a defect concentrated in one small
 * region of an otherwise-matching component can clear the overall match-ratio and
 * maxDiffPixels thresholds while still being a real, visible break. An explicitly-chosen
 * profile is left untouched: opting into a named profile should mean exactly what that
 * profile says, with no default-only exception layered on top.
 */
export function resolveFigmaCompareOptions(
  explicit: ProfileName | undefined,
  hasSelector: boolean,
): FigmaCompareOptions {
  if (explicit) return { profile: explicit };
  return hasSelector ? { profile: "component/strict", clusterCheck: true } : { profile: "page" };
}
