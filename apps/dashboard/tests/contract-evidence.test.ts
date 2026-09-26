import type { DashboardContractResult, DashboardTopIssue } from "@framelia/contracts";
import { describe, expect, it } from "vitest";

import {
  groupPixelAttributions,
  groupStyleMismatches,
  hasEvidenceNotes,
  styleMismatchGateLabel,
} from "../lib/contract-evidence";

type EvidenceInput = Pick<DashboardContractResult, "blockers" | "diagnostics">;

const empty: EvidenceInput = { blockers: [] };

describe("hasEvidenceNotes", () => {
  it("is false when nothing is present", () => {
    expect(hasEvidenceNotes(empty)).toBe(false);
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
});

function styleIssue(overrides: Partial<DashboardTopIssue> = {}): DashboardTopIssue {
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
    const issues: DashboardTopIssue[] = [
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

function attributionIssue(overrides: Partial<DashboardTopIssue> = {}): DashboardTopIssue {
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
    const issues: DashboardTopIssue[] = [styleIssue()];
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
