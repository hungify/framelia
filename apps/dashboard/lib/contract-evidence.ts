import type { DashboardContractResult } from "@framelia/contracts";

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
