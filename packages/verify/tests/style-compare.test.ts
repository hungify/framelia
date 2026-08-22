import { styleToleranceOverridesSchema, verificationContractSchema } from "@framelia/contracts";
import { describe, expect, it } from "vitest";

import type { StyleSnapshot } from "../src/figma-node-style.ts";
import { compareStyles } from "../src/style-compare.ts";

describe("compareStyles", () => {
  it("returns no issues when both snapshots are empty", () => {
    expect(compareStyles({}, {})).toEqual([]);
  });

  it("returns no issues when every present field matches", () => {
    const snapshot: StyleSnapshot = {
      color: "#e5e5e5ff",
      fontSize: 16,
      fontWeight: 700,
      cornerRadius: 8,
      spacing: { top: 8, right: 16, bottom: 8, left: 16 },
    };

    expect(compareStyles(snapshot, { ...snapshot })).toEqual([]);
  });

  it("flags a color mismatch as a non-blocking style-color issue", () => {
    const issues = compareStyles({ color: "#e5e5e5ff" }, { color: "#000000ff" });

    expect(issues).toEqual([
      expect.objectContaining({
        kind: "style-color",
        blocking: false,
        repairCandidate: true,
        message: expect.stringContaining("color"),
      }),
    ]);
  });

  it("flags a backgroundColor mismatch as a non-blocking style-color issue", () => {
    const issues = compareStyles(
      { backgroundColor: "#e5e5e5ff" },
      { backgroundColor: "#000000ff" },
    );

    expect(issues).toEqual([
      expect.objectContaining({
        kind: "style-color",
        blocking: false,
        repairCandidate: true,
        message: expect.stringContaining("backgroundColor"),
      }),
    ]);
  });

  it("flags a fontSize mismatch as a non-blocking style-typography issue", () => {
    const issues = compareStyles({ fontSize: 16 }, { fontSize: 14 });

    expect(issues).toEqual([
      expect.objectContaining({
        kind: "style-typography",
        blocking: false,
        message: expect.stringContaining("fontSize"),
      }),
    ]);
  });

  it("flags a fontWeight mismatch", () => {
    const issues = compareStyles({ fontWeight: 700 }, { fontWeight: 400 });

    expect(issues).toEqual([expect.objectContaining({ kind: "style-typography" })]);
    expect(issues[0]?.message).toContain("fontWeight");
  });

  it("flags a cornerRadius mismatch", () => {
    const issues = compareStyles({ cornerRadius: 8 }, { cornerRadius: 4 });

    expect(issues[0]?.message).toContain("cornerRadius");
  });

  it("flags each mismatched spacing side independently", () => {
    const issues = compareStyles(
      { spacing: { top: 8, right: 16, bottom: 8, left: 16 } },
      { spacing: { top: 8, right: 12, bottom: 8, left: 20 } },
    );

    expect(issues).toHaveLength(2);
    expect(issues.map((issue) => issue.message)).toEqual([
      expect.stringContaining("spacing.right"),
      expect.stringContaining("spacing.left"),
    ]);
  });

  it("does not fabricate a mismatch when a field is present on only one side", () => {
    const issues = compareStyles({ color: "#e5e5e5ff" }, {});

    expect(issues).toEqual([]);
  });

  it("does not compare spacing at all when only one side has a spacing box", () => {
    const issues = compareStyles({ spacing: { top: 8, right: 16, bottom: 8, left: 16 } }, {});

    expect(issues).toEqual([]);
  });

  it("reports both expected and actual values in the message", () => {
    const issues = compareStyles({ fontSize: 16 }, { fontSize: 14 });

    expect(issues[0]?.message).toContain("16");
    expect(issues[0]?.message).toContain("14");
  });

  describe("tolerance", () => {
    it("does not flag a color within the default perceptual distance threshold", () => {
      // #e5e5e5ff vs #e4e4e4ff -- a 1-unit-per-channel nudge, well under the JND threshold.
      const issues = compareStyles({ color: "#e5e5e5ff" }, { color: "#e4e4e4ff" });

      expect(issues).toEqual([]);
    });

    it("still flags a color mismatch clearly outside the default perceptual distance threshold", () => {
      const issues = compareStyles({ color: "#ffffffff" }, { color: "#000000ff" });

      expect(issues).toEqual([expect.objectContaining({ kind: "style-color" })]);
    });

    it("does not flag a fontSize within the default numeric tolerance", () => {
      const issues = compareStyles({ fontSize: 16 }, { fontSize: 16.2 });

      expect(issues).toEqual([]);
    });

    it("still flags a fontSize mismatch outside the default numeric tolerance", () => {
      const issues = compareStyles({ fontSize: 16 }, { fontSize: 20 });

      expect(issues).toEqual([expect.objectContaining({ kind: "style-typography" })]);
    });

    it("does not flag a spacing side within the default numeric tolerance", () => {
      const issues = compareStyles(
        { spacing: { top: 8, right: 16, bottom: 8, left: 16 } },
        { spacing: { top: 8.5, right: 16, bottom: 8, left: 16 } },
      );

      expect(issues).toEqual([]);
    });

    it("applies a widened maxColorDeltaE override to pass a color that would otherwise flag", () => {
      const issues = compareStyles(
        { color: "#ffffffff" },
        { color: "#000000ff" },
        { maxColorDeltaE: 1000 },
      );

      expect(issues).toEqual([]);
    });

    it("applies a tightened maxFontSizeDeltaPx override to flag a color that would otherwise pass", () => {
      const issues = compareStyles({ fontSize: 16 }, { fontSize: 16.2 }, { maxFontSizeDeltaPx: 0 });

      expect(issues).toEqual([expect.objectContaining({ kind: "style-typography" })]);
    });

    it("applies a tightened maxSpacingDeltaPx override to flag spacing that would otherwise pass", () => {
      const issues = compareStyles(
        { spacing: { top: 8, right: 16, bottom: 8, left: 16 } },
        { spacing: { top: 8.5, right: 16, bottom: 8, left: 16 } },
        { maxSpacingDeltaPx: 0 },
      );

      expect(issues).toEqual([expect.objectContaining({ kind: "style-typography" })]);
    });

    it("leaves unspecified override fields at their default tolerance", () => {
      const issues = compareStyles({ fontSize: 16 }, { fontSize: 16.2 }, { maxColorDeltaE: 1000 });

      expect(issues).toEqual([]);
    });
  });
});

describe("styleToleranceOverridesSchema", () => {
  it("accepts the known override fields", () => {
    const result = styleToleranceOverridesSchema.safeParse({
      maxColorDeltaE: 5,
      maxSpacingDeltaPx: 2,
      maxFontSizeDeltaPx: 1,
    });

    expect(result.success).toBe(true);
  });

  it("rejects an unknown field, mirroring profileOverridesSchema's strict()", () => {
    expect(
      styleToleranceOverridesSchema.safeParse({ maxColorDeltaE: 5, cluster: true }).success,
    ).toBe(false);
  });

  it("rejects a negative tolerance value", () => {
    expect(styleToleranceOverridesSchema.safeParse({ maxColorDeltaE: -1 }).success).toBe(false);
  });

  it("region contracts accept an optional styleToleranceOverrides field, following the profileOverrides pattern", () => {
    const contract = {
      id: "auth-login-desktop",
      baseline: { kind: "figma", fileKey: "file-key", nodeId: "153:5181" },
      viewport: { name: "desktop", width: 1280, height: 800 },
      scope: { kind: "region", selector: '[data-testid="auth.login"]' },
      styleToleranceOverrides: { maxColorDeltaE: 5 },
    };

    const result = verificationContractSchema.safeParse(contract);

    expect(result.success).toBe(true);
    expect(result.success && result.data.styleToleranceOverrides).toEqual({ maxColorDeltaE: 5 });
  });
});
