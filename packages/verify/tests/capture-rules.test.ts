import { describe, expect, it } from "vitest";

import {
  checkFontReadiness,
  checkMaskAreaRatio,
  checkScopeSize,
  checkUniqueMatch,
} from "../src/capture/domain/capture-rules.ts";
import type { FontReadiness } from "../src/capture/types.ts";

function fonts(overrides: Partial<FontReadiness> = {}): FontReadiness {
  return { supported: true, status: "loaded", failed: [], ...overrides };
}

describe("checkFontReadiness", () => {
  it("passes when policy is warn, regardless of font state", () => {
    expect(checkFontReadiness(fonts({ status: "loading" }), "warn")).toBeNull();
  });

  it("passes when policy is required and fonts are complete", () => {
    expect(checkFontReadiness(fonts(), "required")).toBeNull();
  });

  it("rejects when policy is required and fonts are unsupported", () => {
    const result = checkFontReadiness(fonts({ supported: false, status: "unknown" }), "required");
    expect(result).toMatchObject({ ok: false, error: "FONT_READY_FAILED" });
  });

  it("rejects when policy is required and a face failed to load", () => {
    const result = checkFontReadiness(fonts({ failed: ["Inter"] }), "required");
    expect(result?.message).toContain("failed: Inter");
  });

  it("includes the message suffix for context (e.g. after navigation, on sample N)", () => {
    const result = checkFontReadiness(
      fonts({ status: "loading" }),
      "required",
      " after navigation",
    );
    expect(result?.message).toBe("Font loading incomplete after navigation; failed: loading.");
  });
});

describe("checkScopeSize", () => {
  it("passes when no expected size is declared", () => {
    expect(checkScopeSize({ width: 100, height: 50 }, undefined)).toBeNull();
  });

  it("passes when actual matches expected within tolerance", () => {
    expect(checkScopeSize({ width: 100.3, height: 50 }, { width: 100, height: 50 })).toBeNull();
  });

  it("rejects when width differs beyond tolerance", () => {
    const result = checkScopeSize({ width: 110, height: 50 }, { width: 100, height: 50 });
    expect(result).toMatchObject({ ok: false, error: "SCOPE_SIZE_MISMATCH" });
    expect(result?.message).toBe("Region size 110x50 differs from expected 100x50.");
  });

  it("rejects when height differs beyond tolerance", () => {
    const result = checkScopeSize({ width: 100, height: 60 }, { width: 100, height: 50 });
    expect(result).not.toBeNull();
  });
});

describe("checkMaskAreaRatio", () => {
  it("passes at or under the cap", () => {
    expect(checkMaskAreaRatio(0.15, 0.15)).toBeNull();
    expect(checkMaskAreaRatio(0.1, 0.15)).toBeNull();
  });

  it("rejects over the cap with a formatted message", () => {
    const result = checkMaskAreaRatio(0.2, 0.15);
    expect(result).toMatchObject({ ok: false, error: "MASK_AREA_EXCEEDED" });
    expect(result?.message).toBe("Mask area ratio 0.2000 exceeds cap 0.1500.");
  });
});

describe("checkUniqueMatch", () => {
  it("passes for exactly one match", () => {
    expect(checkUniqueMatch(1, "SELECTOR_AMBIGUOUS", "unused")).toBeNull();
  });

  it("rejects for zero matches, carrying matchCount and the given error/message", () => {
    const result = checkUniqueMatch(0, "READY_SELECTOR_AMBIGUOUS", "matched 0");
    expect(result).toMatchObject({ ok: false, error: "READY_SELECTOR_AMBIGUOUS", matchCount: 0 });
  });

  it("rejects for more than one match", () => {
    const result = checkUniqueMatch(3, "SELECTOR_AMBIGUOUS", "matched 3");
    expect(result).toMatchObject({ ok: false, error: "SELECTOR_AMBIGUOUS", matchCount: 3 });
  });
});
