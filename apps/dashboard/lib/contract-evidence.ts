import type { DashboardContractResult, DashboardTopIssue } from "@framelia/contracts";

/**
 * Whether the evidence-notes section (blockers, diagnostics, baseline
 * provenance, evidence hash, masks) has anything to show. Masked-region
 * detail is the reason a masked-pass contract can hit this even when the
 * other four fields are all empty, so it must gate the section on its own
 * rather than only piggyback on the others being present.
 */
export function hasEvidenceNotes(
  contract: Pick<
    DashboardContractResult,
    "blockers" | "diagnostics" | "baseline" | "evidenceHash" | "maskEvidence"
  >,
): boolean {
  return Boolean(
    contract.blockers.length ||
    contract.diagnostics?.length ||
    contract.baseline?.provenance ||
    contract.evidenceHash ||
    contract.maskEvidence,
  );
}

export interface TopIssueGroup {
  /** The check-point selector this group's issues came from; null for a region-scope
   *  contract, which has exactly one implicit origin and carries no selector tag. */
  selector: string | null;
  issues: DashboardTopIssue[];
}

/** Legacy name kept for callers that only ever grouped style mismatches. */
export type StyleMismatchGroup = TopIssueGroup;

const STYLE_MISMATCH_KINDS = new Set(["style-color", "style-typography", "style-check-error"]);

/** Shared by groupStyleMismatches/groupPixelAttributions: buckets a pre-filtered
 *  issue list by its originating check-point selector so a page-scope contract's
 *  multiple check-points render as distinct sections instead of one undifferentiated
 *  list. A region-scope contract's single implicit origin has no selector tag, so it
 *  collapses to one unlabeled group. */
function groupBySelector(issues: DashboardTopIssue[]): TopIssueGroup[] {
  const groups = new Map<string | null, DashboardTopIssue[]>();
  for (const issue of issues) {
    const key = issue.selector ?? null;
    const bucket = groups.get(key);
    if (bucket) bucket.push(issue);
    else groups.set(key, [issue]);
  }
  return [...groups.entries()].map(([selector, groupIssues]) => ({
    selector,
    issues: groupIssues,
  }));
}

/**
 * Style-comparison topIssues (color/typography mismatches, plus style-check-error
 * diagnostics for a check that couldn't run at all), grouped by their originating
 * check-point selector -- see groupBySelector.
 */
export function groupStyleMismatches(topIssues: DashboardTopIssue[] | undefined): TopIssueGroup[] {
  return groupBySelector((topIssues ?? []).filter((issue) => STYLE_MISMATCH_KINDS.has(issue.kind)));
}

/**
 * pixel-attribution topIssues (see @framelia/verify's attributeDiffRegions), grouped by
 * the check-point selector each attributed pixel-diff region overlaps -- same grouping
 * as groupStyleMismatches, so a diff region can be traced back to "this cluster =
 * mismatch on .header" right alongside that check-point's own style-mismatch section.
 */
export function groupPixelAttributions(
  topIssues: DashboardTopIssue[] | undefined,
): TopIssueGroup[] {
  return groupBySelector((topIssues ?? []).filter((issue) => issue.kind === "pixel-attribution"));
}

/**
 * The style-mismatch section's header text -- reflects whether this contract's resolved
 * styleGateEligible (see @framelia/verify's resolveStyleGateEligible) actually blocks the CI
 * merge gate on these mismatches, or leaves them purely informational (the default).
 */
export function styleMismatchGateLabel(styleGateEligible: boolean | undefined): string {
  return styleGateEligible
    ? "Style mismatches vs. Figma — blocking the CI merge gate"
    : "Style mismatches vs. Figma — informational, not blocking";
}
