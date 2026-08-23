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

export interface StyleMismatchGroup {
  /** The check-point selector this group's issues came from; null for a region-scope
   *  contract, which has exactly one implicit origin and carries no selector tag. */
  selector: string | null;
  issues: DashboardTopIssue[];
}

/**
 * Style-comparison topIssues (color/typography), grouped by their originating check-point
 * selector so a page-scope contract's multiple check-points render as distinct sections
 * instead of one undifferentiated list. A region-scope contract's single implicit origin
 * has no selector tag, so it collapses to one unlabeled group -- unchanged from today.
 */
export function groupStyleMismatches(
  topIssues: DashboardTopIssue[] | undefined,
): StyleMismatchGroup[] {
  const styleIssues = (topIssues ?? []).filter(
    (issue) => issue.kind === "style-color" || issue.kind === "style-typography",
  );
  const groups = new Map<string | null, DashboardTopIssue[]>();
  for (const issue of styleIssues) {
    const key = issue.selector ?? null;
    const bucket = groups.get(key);
    if (bucket) bucket.push(issue);
    else groups.set(key, [issue]);
  }
  return [...groups.entries()].map(([selector, issues]) => ({ selector, issues }));
}
