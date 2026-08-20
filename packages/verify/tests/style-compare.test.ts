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
});
