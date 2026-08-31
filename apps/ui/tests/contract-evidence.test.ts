import type { UIContractResult, UITopIssue } from "@framelia/contracts";
import { describe, expect, it } from "vitest";

import {
  groupPixelAttributions,
  groupStyleMismatches,
  hasEvidenceNotes,
  styleMismatchGateLabel,
} from "../lib/contract-evidence";

type EvidenceInput = Pick<
  UIContractResult,
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

function styleIssue(overrides: Partial<UITopIssue> = {}): UITopIssue {
  return {
    severity: "low",
    kind: "style-color",
    message: "style mismatch on color: expected #000000ff, actual #111111ff",
    repairCandidate: true,
    blocking: false,
    ...overrides,
  };
}

describe("groupStyleMismatches", () => {
  it("returns no groups when there are no style issues (unchanged: renders no section)", () => {
    expect(groupStyleMismatches(undefined)).toEqual([]);
    expect(groupStyleMismatches([])).toEqual([]);
  });

  it("ignores non-style topIssues", () => {
    const issues: UITopIssue[] = [
      {
        severity: "high",
        kind: "pixel",
        message: "pixel mismatch",
        repairCandidate: false,
        blocking: true,
      },
    ];
    expect(groupStyleMismatches(issues)).toEqual([]);
  });

  it("collapses a region-scope contract's selector-less issues into one unlabeled group", () => {
    const issues = [styleIssue(), styleIssue({ kind: "style-typography" })];
    expect(groupStyleMismatches(issues)).toEqual([{ selector: null, issues }]);
  });

  it("includes style-check-error diagnostics alongside real mismatches", () => {
    const errorIssue = styleIssue({
      kind: "style-check-error",
      message: 'style check for "#missing" could not run: element not found',
      repairCandidate: false,
      selector: "#missing",
    });
    expect(groupStyleMismatches([errorIssue])).toEqual([
      { selector: "#missing", issues: [errorIssue] },
    ]);
  });

  it("groups a page-scope contract's issues into distinct groups by check-point selector", () => {
    const headerIssue = styleIssue({ selector: "header" });
    const heroIssue = styleIssue({ kind: "style-typography", selector: ".hero" });
    const secondHeaderIssue = styleIssue({ message: "another color mismatch", selector: "header" });

    expect(groupStyleMismatches([headerIssue, heroIssue, secondHeaderIssue])).toEqual([
      { selector: "header", issues: [headerIssue, secondHeaderIssue] },
      { selector: ".hero", issues: [heroIssue] },
    ]);
  });
});

function attributionIssue(overrides: Partial<UITopIssue> = {}): UITopIssue {
  return {
    severity: "low",
    kind: "pixel-attribution",
    message: 'pixel-diff region (42px, bbox [10,10]-[30,25]) overlaps style check-point "header"',
    repairCandidate: false,
    blocking: false,
    ...overrides,
  };
}

describe("groupPixelAttributions", () => {
  it("returns no groups when there are no attribution issues", () => {
    expect(groupPixelAttributions(undefined)).toEqual([]);
    expect(groupPixelAttributions([])).toEqual([]);
  });

  it("ignores non-attribution topIssues, including style mismatches", () => {
    const issues: UITopIssue[] = [styleIssue()];
    expect(groupPixelAttributions(issues)).toEqual([]);
  });

  it("groups attribution issues by the check-point selector they overlap", () => {
    const headerHit = attributionIssue({ selector: "header" });
    const heroHit = attributionIssue({ selector: ".hero", message: "another region" });

    expect(groupPixelAttributions([headerHit, heroHit])).toEqual([
      { selector: "header", issues: [headerHit] },
      { selector: ".hero", issues: [heroHit] },
    ]);
  });
});

describe("styleMismatchGateLabel", () => {
  it("reads as informational when styleGateEligible is unset (the default)", () => {
    expect(styleMismatchGateLabel(undefined)).toBe(
      "Style mismatches vs. Figma — informational, not blocking",
    );
  });

  it("reads as informational when styleGateEligible is explicitly false", () => {
    expect(styleMismatchGateLabel(false)).toBe(
      "Style mismatches vs. Figma — informational, not blocking",
    );
  });

  it("reads as blocking when styleGateEligible is true", () => {
    expect(styleMismatchGateLabel(true)).toBe(
      "Style mismatches vs. Figma — blocking the CI merge gate",
    );
  });
});
