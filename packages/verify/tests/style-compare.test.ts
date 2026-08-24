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
      lineHeightPx: 24,
      letterSpacingPx: 0.5,
      cornerRadius: { topLeft: 8, topRight: 8, bottomRight: 8, bottomLeft: 8 },
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

  it("flags a mismatched corner independently, tagged with its own corner name", () => {
    const issues = compareStyles(
      { cornerRadius: { topLeft: 8, topRight: 8, bottomRight: 8, bottomLeft: 8 } },
      { cornerRadius: { topLeft: 4, topRight: 8, bottomRight: 8, bottomLeft: 8 } },
    );

    expect(issues).toEqual([
      expect.objectContaining({
        kind: "style-typography",
        message: expect.stringContaining("cornerRadius.topLeft"),
      }),
    ]);
  });

  it("flags every mismatched corner independently, not just the first", () => {
    const issues = compareStyles(
      { cornerRadius: { topLeft: 8, topRight: 8, bottomRight: 8, bottomLeft: 8 } },
      { cornerRadius: { topLeft: 4, topRight: 8, bottomRight: 2, bottomLeft: 8 } },
    );

    expect(issues.map((issue) => issue.message)).toEqual([
      expect.stringContaining("cornerRadius.topLeft"),
      expect.stringContaining("cornerRadius.bottomRight"),
    ]);
  });

  it("does not compare cornerRadius at all when only one side has it", () => {
    const issues = compareStyles(
      { cornerRadius: { topLeft: 8, topRight: 8, bottomRight: 8, bottomLeft: 8 } },
      {},
    );

    expect(issues).toEqual([]);
  });

  it("flags a lineHeightPx mismatch as a non-blocking style-typography issue", () => {
    const issues = compareStyles({ lineHeightPx: 24 }, { lineHeightPx: 18 });

    expect(issues).toEqual([
      expect.objectContaining({
        kind: "style-typography",
        blocking: false,
        message: expect.stringContaining("lineHeightPx"),
      }),
    ]);
  });

  it("flags a letterSpacingPx mismatch as a non-blocking style-typography issue", () => {
    const issues = compareStyles({ letterSpacingPx: 0 }, { letterSpacingPx: 2 });

    expect(issues).toEqual([
      expect.objectContaining({
        kind: "style-typography",
        blocking: false,
        message: expect.stringContaining("letterSpacingPx"),
      }),
    ]);
  });

  it("flags a borderWidth mismatch as a non-blocking style-typography issue", () => {
    const issues = compareStyles({ borderWidth: 1 }, { borderWidth: 3 });

    expect(issues).toEqual([
      expect.objectContaining({
        kind: "style-typography",
        blocking: false,
        message: expect.stringContaining("borderWidth"),
      }),
    ]);
  });

  it("flags a gap mismatch as a non-blocking style-typography issue", () => {
    const issues = compareStyles({ gap: 8 }, { gap: 16 });

    expect(issues).toEqual([
      expect.objectContaining({
        kind: "style-typography",
        blocking: false,
        message: expect.stringContaining("gap"),
      }),
    ]);
  });

  it("flags an opacity mismatch as a non-blocking style-typography issue", () => {
    const issues = compareStyles({ opacity: 1 }, { opacity: 0.5 });

    expect(issues).toEqual([
      expect.objectContaining({
        kind: "style-typography",
        blocking: false,
        message: expect.stringContaining("opacity"),
      }),
    ]);
  });

  it("does not fabricate a borderWidth/gap/opacity mismatch when present on only one side", () => {
    const issues = compareStyles({ borderWidth: 1, gap: 8, opacity: 1 }, {});

    expect(issues).toEqual([]);
  });

  describe("boxShadow", () => {
    const shadow = {
      offsetX: 0,
      offsetY: 4,
      blurRadius: 8,
      spreadRadius: 0,
      color: "#000000ff",
      inset: false,
    };

    it("returns no issue when both box shadows match", () => {
      expect(compareStyles({ boxShadow: shadow }, { boxShadow: { ...shadow } })).toEqual([]);
    });

    it("flags a mismatched offsetY independently, tagged with its own sub-field name", () => {
      const issues = compareStyles(
        { boxShadow: shadow },
        { boxShadow: { ...shadow, offsetY: 12 } },
      );

      expect(issues).toEqual([
        expect.objectContaining({
          kind: "style-typography",
          message: expect.stringContaining("boxShadow.offsetY"),
        }),
      ]);
    });

    it("flags a mismatched blurRadius and spreadRadius independently", () => {
      const issues = compareStyles(
        { boxShadow: shadow },
        { boxShadow: { ...shadow, blurRadius: 20, spreadRadius: 4 } },
      );

      expect(issues.map((issue) => issue.message)).toEqual([
        expect.stringContaining("boxShadow.blurRadius"),
        expect.stringContaining("boxShadow.spreadRadius"),
      ]);
    });

    it("flags a mismatched shadow color as a style-color issue", () => {
      const issues = compareStyles(
        { boxShadow: shadow },
        { boxShadow: { ...shadow, color: "#ffffffff" } },
      );

      expect(issues).toEqual([
        expect.objectContaining({
          kind: "style-color",
          message: expect.stringContaining("boxShadow.color"),
        }),
      ]);
    });

    it("does not compare boxShadow at all when only one side has it", () => {
      expect(compareStyles({ boxShadow: shadow }, {})).toEqual([]);
    });

    it("flags an inner-vs-outer shadow mismatch even when geometry and color are identical", () => {
      const issues = compareStyles(
        { boxShadow: shadow },
        { boxShadow: { ...shadow, inset: true } },
      );

      expect(issues).toEqual([
        expect.objectContaining({
          kind: "style-typography",
          message: expect.stringContaining("boxShadow.inset"),
        }),
      ]);
    });
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

    it("does not flag a lineHeightPx within the default numeric tolerance", () => {
      const issues = compareStyles({ lineHeightPx: 24 }, { lineHeightPx: 24.5 });

      expect(issues).toEqual([]);
    });

    it("does not flag a letterSpacingPx within the default numeric tolerance", () => {
      const issues = compareStyles({ letterSpacingPx: 0.5 }, { letterSpacingPx: 0.55 });

      expect(issues).toEqual([]);
    });

    it("does not flag a borderWidth within the default numeric tolerance", () => {
      expect(compareStyles({ borderWidth: 1 }, { borderWidth: 1.2 })).toEqual([]);
    });

    it("does not flag a gap within the default numeric tolerance", () => {
      expect(compareStyles({ gap: 8 }, { gap: 8.5 })).toEqual([]);
    });

    it("does not flag an opacity within the default numeric tolerance", () => {
      expect(compareStyles({ opacity: 1 }, { opacity: 0.995 })).toEqual([]);
    });

    it("does not flag box-shadow numeric sub-fields within the default tolerance", () => {
      const shadow = {
        offsetX: 0,
        offsetY: 4,
        blurRadius: 8,
        spreadRadius: 0,
        color: "#000000ff",
        inset: false,
      };

      expect(
        compareStyles({ boxShadow: shadow }, { boxShadow: { ...shadow, offsetY: 4.5 } }),
      ).toEqual([]);
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

    it("applies a tightened maxLineHeightDeltaPx override to flag a lineHeightPx that would otherwise pass", () => {
      const issues = compareStyles(
        { lineHeightPx: 24 },
        { lineHeightPx: 24.5 },
        { maxLineHeightDeltaPx: 0 },
      );

      expect(issues).toEqual([expect.objectContaining({ kind: "style-typography" })]);
    });

    it("applies a tightened maxLetterSpacingDeltaPx override to flag a letterSpacingPx that would otherwise pass", () => {
      const issues = compareStyles(
        { letterSpacingPx: 0.5 },
        { letterSpacingPx: 0.55 },
        { maxLetterSpacingDeltaPx: 0 },
      );

      expect(issues).toEqual([expect.objectContaining({ kind: "style-typography" })]);
    });

    it("applies a tightened maxBorderWidthDeltaPx override to flag a borderWidth that would otherwise pass", () => {
      const issues = compareStyles(
        { borderWidth: 1 },
        { borderWidth: 1.2 },
        { maxBorderWidthDeltaPx: 0 },
      );

      expect(issues).toEqual([expect.objectContaining({ kind: "style-typography" })]);
    });

    it("applies a tightened maxGapDeltaPx override to flag a gap that would otherwise pass", () => {
      const issues = compareStyles({ gap: 8 }, { gap: 8.5 }, { maxGapDeltaPx: 0 });

      expect(issues).toEqual([expect.objectContaining({ kind: "style-typography" })]);
    });

    it("applies a tightened maxOpacityDelta override to flag an opacity that would otherwise pass", () => {
      const issues = compareStyles({ opacity: 1 }, { opacity: 0.995 }, { maxOpacityDelta: 0 });

      expect(issues).toEqual([expect.objectContaining({ kind: "style-typography" })]);
    });

    it("applies a tightened maxBoxShadowDeltaPx override to flag a box-shadow that would otherwise pass", () => {
      const shadow = {
        offsetX: 0,
        offsetY: 4,
        blurRadius: 8,
        spreadRadius: 0,
        color: "#000000ff",
        inset: false,
      };
      const issues = compareStyles(
        { boxShadow: shadow },
        { boxShadow: { ...shadow, offsetY: 4.5 } },
        { maxBoxShadowDeltaPx: 0 },
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
      maxLineHeightDeltaPx: 1,
      maxLetterSpacingDeltaPx: 0.1,
      maxBorderWidthDeltaPx: 0.5,
      maxGapDeltaPx: 1,
      maxOpacityDelta: 0.01,
      maxBoxShadowDeltaPx: 1,
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
