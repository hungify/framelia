import type { DashboardContractResult } from "@framelia/contracts";
import { describe, expect, it } from "vitest";

import { hasEvidenceNotes } from "../lib/contract-evidence";

type EvidenceInput = Pick<
  DashboardContractResult,
  "blockers" | "diagnostics" | "baseline" | "evidenceHash" | "maskEvidence"
>;

const empty: EvidenceInput = { blockers: [] };

describe("hasEvidenceNotes", () => {
  it("is false when nothing is present", () => {
    expect(hasEvidenceNotes(empty)).toBe(false);
  });

  it("is true for a masked-pass contract with no other evidence", () => {
    // The regression this guards: a masked-pass contract can have no
    // blockers, diagnostics, baseline provenance, or evidence hash — masks
    // must not depend on any of those also being present.
    const contract: EvidenceInput = {
      blockers: [],
      maskEvidence: {
        requested: [{ selector: "#avatar", reason: "live user data", maxMatches: 1 }],
        matchedCount: 1,
        bounds: [{ x: 0, y: 0, width: 10, height: 10 }],
        unionMaskedArea: 100,
        maskedAreaRatio: 0.05,
        maskColor: "#FF00FF",
        status: "applied",
      },
    };
    expect(hasEvidenceNotes(contract)).toBe(true);
  });

  it("is true when only blockers are present", () => {
    expect(hasEvidenceNotes({ ...empty, blockers: [{ code: "X", message: "y" }] })).toBe(true);
  });

  it("is true when only diagnostics are present", () => {
    expect(
      hasEvidenceNotes({
        ...empty,
        diagnostics: [{ kind: "warning", code: "X", message: "y", blocking: false }],
      }),
    ).toBe(true);
  });

  it("is true when only baseline provenance is present", () => {
    expect(
      hasEvidenceNotes({ ...empty, baseline: { path: "baseline.png", provenance: "figma" } }),
    ).toBe(true);
  });

  it("is true when only evidenceHash is present", () => {
    expect(hasEvidenceNotes({ ...empty, evidenceHash: "abc123" })).toBe(true);
  });
});
