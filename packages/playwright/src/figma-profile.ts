import type { ProfileName } from "@framelia/verify";

/**
 * Figma-baselined matches default to component/strict (not compare-pages's component/dev)
 * because they're eligible for done-gate, which forbids component/dev outright -- see
 * done-gate/validate.ts. The one place both toMatchFigma and the reporter's live-run
 * reconstruction of the same score apply this rule, so it can't drift between them.
 */
export function defaultFigmaProfile(
  explicit: ProfileName | undefined,
  hasSelector: boolean,
): ProfileName {
  return explicit ?? (hasSelector ? "component/strict" : "page");
}
