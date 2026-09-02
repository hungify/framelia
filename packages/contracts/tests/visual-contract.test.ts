import { describe, expect, it } from "vitest";

import {
  componentProfileSchema,
  contractScopeSchema,
  expectStyleSchema,
  pageScopeSchema,
  profileOverridesSchema,
  profileSchema,
  regionScopeSchema,
  styleCheckPointSchema,
  styleToleranceOverridesSchema,
  verificationContractSchema,
  viewportSchema,
  visualMaskSchema,
} from "../src/visual-contract.ts";

const pageContract = {
  id: "home",
  name: "Home page",
  baseline: { kind: "figma" as const, fileKey: "abc", nodeId: "123:45" },
  viewport: { preset: "desktop", width: 1440, height: 900 },
  scope: { kind: "page" as const, pageReason: "top-level landing page" },
};

const regionContract = {
  id: "home.hero",
  name: "Home hero",
  baseline: { kind: "figma" as const, fileKey: "abc", nodeId: "123:45" },
  viewport: { preset: "desktop", width: 1440, height: 900 },
  scope: { kind: "region" as const, selector: ".hero" },
  profile: "component/strict" as const,
};

describe("profileSchema / componentProfileSchema", () => {
  it("profileSchema includes page and both component variants", () => {
    expect(profileSchema.options).toEqual(["page", "component/strict", "component/dev"]);
  });

  it("componentProfileSchema excludes page", () => {
    expect(componentProfileSchema.safeParse("page").success).toBe(false);
    expect(componentProfileSchema.safeParse("component/strict").success).toBe(true);
    expect(componentProfileSchema.safeParse("component/dev").success).toBe(true);
  });
});

describe("viewportSchema", () => {
  it("round-trips a valid viewport", () => {
    const value = { preset: "desktop", width: 1440, height: 900 };
    const result = viewportSchema.safeParse(value);
    expect(result.success).toBe(true);
    expect(result.success && result.data).toEqual(value);
  });

  it("rejects a non-positive width", () => {
    expect(viewportSchema.safeParse({ preset: "d", width: 0, height: 900 }).success).toBe(false);
  });

  it("rejects a non-integer height", () => {
    expect(viewportSchema.safeParse({ preset: "d", width: 100, height: 900.5 }).success).toBe(
      false,
    );
  });

  it("rejects an empty preset", () => {
    expect(viewportSchema.safeParse({ preset: "", width: 100, height: 100 }).success).toBe(false);
  });
});

describe("expectStyleSchema", () => {
  it("round-trips a fully populated style expectation", () => {
    const value = {
      fontWeight: 700,
      fontSizePx: 16,
      lineHeightPx: 24,
      letterSpacingPx: 0.5,
      color: { r: 255, g: 0, b: 0, a: 1 },
      colorProperty: "color" as const,
    };
    const result = expectStyleSchema.safeParse(value);
    expect(result.success).toBe(true);
    expect(result.success && result.data).toEqual(value);
  });

  it("round-trips an empty style expectation (every field optional)", () => {
    expect(expectStyleSchema.safeParse({}).success).toBe(true);
  });

  it("rejects a color channel out of 0-255 range", () => {
    expect(expectStyleSchema.safeParse({ color: { r: 256, g: 0, b: 0, a: 1 } }).success).toBe(
      false,
    );
  });

  it("rejects an alpha out of 0-1 range", () => {
    expect(expectStyleSchema.safeParse({ color: { r: 0, g: 0, b: 0, a: 2 } }).success).toBe(false);
  });

  it("rejects an unknown colorProperty value", () => {
    expect(expectStyleSchema.safeParse({ colorProperty: "border" }).success).toBe(false);
  });
});

describe("styleCheckPointSchema", () => {
  it("round-trips a minimal check-point", () => {
    const value = { selector: ".title", nodeId: "123:45" };
    const result = styleCheckPointSchema.safeParse(value);
    expect(result.success).toBe(true);
    expect(result.success && result.data).toEqual(value);
  });

  it("rejects a malformed nodeId", () => {
    expect(styleCheckPointSchema.safeParse({ selector: ".title", nodeId: "bad" }).success).toBe(
      false,
    );
  });
});

describe("contractScopeSchema (page/region discriminated union)", () => {
  it("accepts a valid page scope", () => {
    expect(pageScopeSchema.safeParse({ kind: "page", pageReason: "landing" }).success).toBe(true);
  });

  it("accepts a valid region scope", () => {
    expect(regionScopeSchema.safeParse({ kind: "region", selector: ".hero" }).success).toBe(true);
  });

  it("discriminates on kind", () => {
    expect(contractScopeSchema.safeParse({ kind: "page", pageReason: "x" }).success).toBe(true);
    expect(contractScopeSchema.safeParse({ kind: "region", selector: ".x" }).success).toBe(true);
    expect(contractScopeSchema.safeParse({ kind: "other" }).success).toBe(false);
  });

  it("page scope requires a non-empty pageReason", () => {
    expect(pageScopeSchema.safeParse({ kind: "page", pageReason: "" }).success).toBe(false);
  });

  it("region scope requires a non-empty selector", () => {
    expect(regionScopeSchema.safeParse({ kind: "region", selector: "" }).success).toBe(false);
  });
});

describe("profileOverridesSchema", () => {
  it("round-trips a fully populated overrides object", () => {
    const value = {
      minMatch: 0.9,
      maxDiffPixels: 100,
      minSSIM: 0.95,
      maxAvgDeltaE: 2,
      maxAreaGapPercent: 1,
    };
    const result = profileOverridesSchema.safeParse(value);
    expect(result.success).toBe(true);
    expect(result.success && result.data).toEqual(value);
  });

  it("allows maxDiffPixels to be explicitly null", () => {
    expect(profileOverridesSchema.safeParse({ maxDiffPixels: null }).success).toBe(true);
  });

  it("rejects minMatch outside 0-1", () => {
    expect(profileOverridesSchema.safeParse({ minMatch: 1.5 }).success).toBe(false);
  });
});

describe("styleToleranceOverridesSchema", () => {
  it("round-trips a fully populated tolerance override", () => {
    const value = {
      maxColorDeltaE: 1,
      maxSpacingDeltaPx: 1,
      maxFontSizeDeltaPx: 1,
      maxLineHeightDeltaPx: 1,
      maxLetterSpacingDeltaPx: 1,
      maxBorderWidthDeltaPx: 1,
      maxGapDeltaPx: 1,
      maxOpacityDelta: 0.1,
      maxBoxShadowDeltaPx: 1,
    };
    const result = styleToleranceOverridesSchema.safeParse(value);
    expect(result.success).toBe(true);
    expect(result.success && result.data).toEqual(value);
  });

  it("rejects a negative tolerance", () => {
    expect(styleToleranceOverridesSchema.safeParse({ maxColorDeltaE: -1 }).success).toBe(false);
  });
});

describe("visualMaskSchema", () => {
  it("accepts an ordinary selector", () => {
    expect(
      visualMaskSchema.safeParse({ selector: ".approval-count", reason: "dynamic count" }).success,
    ).toBe(true);
  });

  it("accepts a selector that merely contains 'app'/'shell' as a substring, not a whole word", () => {
    expect(
      visualMaskSchema.safeParse({ selector: ".appointment-badge", reason: "x" }).success,
    ).toBe(true);
  });

  it("rejects html/body/#root/#app broad selectors", () => {
    for (const selector of ["html", "body", "#root", "#app"]) {
      expect(visualMaskSchema.safeParse({ selector, reason: "x" }).success).toBe(false);
    }
  });

  it("rejects qualified html/body/#root/#app selectors that still target that element", () => {
    for (const selector of ["body.loading", "html.dark", "#root[hidden]", "#app:not(.x)"]) {
      expect(visualMaskSchema.safeParse({ selector, reason: "x" }).success).toBe(false);
    }
  });

  it("rejects a class selector with a whole-word 'app' or 'shell' token", () => {
    expect(visualMaskSchema.safeParse({ selector: ".app-shell", reason: "x" }).success).toBe(false);
    expect(visualMaskSchema.safeParse({ selector: ".shell-root", reason: "x" }).success).toBe(
      false,
    );
  });

  it("rejects a data-testid selector naming framelia/app/shell", () => {
    expect(
      visualMaskSchema.safeParse({ selector: '[data-testid="app-shell"]', reason: "x" }).success,
    ).toBe(false);
  });

  it("rejects an empty reason", () => {
    expect(visualMaskSchema.safeParse({ selector: ".x", reason: "" }).success).toBe(false);
  });

  it("rejects maxMatches above MAX_MASK_SELECTORS (10)", () => {
    expect(
      visualMaskSchema.safeParse({ selector: ".x", reason: "x", maxMatches: 11 }).success,
    ).toBe(false);
  });

  it("accepts maxMatches at the boundary (10)", () => {
    expect(
      visualMaskSchema.safeParse({ selector: ".x", reason: "x", maxMatches: 10 }).success,
    ).toBe(true);
  });
});

describe("verificationContractSchema", () => {
  it("round-trips a minimal page contract, deriving outDir from the id", () => {
    const result = verificationContractSchema.safeParse(pageContract);
    expect(result.success).toBe(true);
    expect(result.success && result.data.outDir).toBe(".framelia/visual-verifications/home");
  });

  it("round-trips a minimal region contract with an explicit component profile", () => {
    const result = verificationContractSchema.safeParse(regionContract);
    expect(result.success).toBe(true);
  });

  it("preserves an explicit outDir instead of deriving one", () => {
    const explicit = {
      ...pageContract,
      outDir: ".framelia/visual-verifications/custom/home",
    };
    const result = verificationContractSchema.safeParse(explicit);
    expect(result.success).toBe(true);
    expect(result.success && result.data.outDir).toBe(explicit.outDir);
  });

  it("rejects an outDir that escapes the visual-verifications root", () => {
    const escaping = { ...pageContract, outDir: "../escape" };
    expect(verificationContractSchema.safeParse(escaping).success).toBe(false);
  });

  it("rejects an id that doesn't match CONTRACT_ID_PATTERN", () => {
    expect(verificationContractSchema.safeParse({ ...pageContract, id: "Home Page" }).success).toBe(
      false,
    );
  });

  it("superRefine: rejects a page-scope contract that also sets a component profile", () => {
    const invalid = { ...pageContract, profile: "component/strict" as const };
    const result = verificationContractSchema.safeParse(invalid);
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    expect(result.error.issues).toContainEqual(
      expect.objectContaining({
        path: ["profile"],
        message: "page contract must not set component profile",
      }),
    );
  });

  it("allows a region-scope contract to set a component profile", () => {
    expect(verificationContractSchema.safeParse(regionContract).success).toBe(true);
  });

  it("allows a region-scope contract to omit profile", () => {
    const { profile: _profile, ...withoutProfile } = regionContract;
    expect(verificationContractSchema.safeParse(withoutProfile).success).toBe(true);
  });

  it("rejects an unknown top-level field (strict)", () => {
    expect(verificationContractSchema.safeParse({ ...pageContract, extra: "nope" }).success).toBe(
      false,
    );
  });

  it("rejects an empty masks array (min 1 when present)", () => {
    expect(verificationContractSchema.safeParse({ ...pageContract, masks: [] }).success).toBe(
      false,
    );
  });

  it("accepts a masks array within bounds", () => {
    expect(
      verificationContractSchema.safeParse({
        ...pageContract,
        masks: [{ selector: ".x", reason: "dynamic" }],
      }).success,
    ).toBe(true);
  });
});
