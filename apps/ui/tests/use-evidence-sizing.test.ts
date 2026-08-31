import type { UIContractResult } from "@framelia/contracts";
import { describe, expect, it } from "vitest";

import { resolveEvidenceSize, type NaturalSizes } from "../composables/useEvidenceSizing";

function contract(
  partial: Pick<UIContractResult, "id" | "name" | "status"> & Partial<UIContractResult>,
): UIContractResult {
  return {
    tags: [],
    phase: "complete",
    baselineKind: "figma",
    capture: { kind: "viewport", viewport: { width: 1280, height: 720 } },
    blockers: [],
    ...partial,
  };
}

const emptySizes: NaturalSizes = {
  baseline: { width: 0, height: 0 },
  actual: { width: 0, height: 0 },
  diff: { width: 0, height: 0 },
};

describe("resolveEvidenceSize", () => {
  it("prefers the evidence's own dimensions when present", () => {
    const item = contract({
      id: "a",
      name: "A",
      status: "passed",
      baseline: { path: "baseline.png", width: 800, height: 600, provenance: "figma" },
    });

    expect(resolveEvidenceSize(item, emptySizes, "baseline")).toEqual({ width: 800, height: 600 });
  });

  it("falls back to the measured natural size when evidence has no dimensions", () => {
    const item = contract({
      id: "a",
      name: "A",
      status: "passed",
      baseline: { path: "baseline.png", provenance: "figma" },
    });
    const naturalSizes: NaturalSizes = {
      ...emptySizes,
      baseline: { width: 400, height: 300 },
    };

    expect(resolveEvidenceSize(item, naturalSizes, "baseline")).toEqual({
      width: 400,
      height: 300,
    });
  });

  it("returns zero size when evidence is missing entirely", () => {
    const item = contract({ id: "a", name: "A", status: "failed" });

    expect(resolveEvidenceSize(item, emptySizes, "diff")).toEqual({ width: 0, height: 0 });
  });
});
