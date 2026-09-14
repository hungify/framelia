import { describe, expect, it } from "vitest";

import { baselineSchema, figmaBaselineSchema } from "../src/baseline.ts";

const validFigmaBaseline = {
  kind: "figma" as const,
  fileKey: "abc123",
  nodeId: "123:45",
};

describe("figmaBaselineSchema", () => {
  it("round-trips a minimal valid baseline", () => {
    const result = figmaBaselineSchema.safeParse(validFigmaBaseline);
    expect(result.success).toBe(true);
    expect(result.success && result.data).toEqual(validFigmaBaseline);
  });

  it("round-trips a baseline with every optional field set", () => {
    const full = { ...validFigmaBaseline, scale: 1 as const, canvasFill: "#fff" };
    const result = figmaBaselineSchema.safeParse(full);
    expect(result.success).toBe(true);
    expect(result.success && result.data).toEqual(full);
  });

  it("rejects a non-figma kind", () => {
    expect(figmaBaselineSchema.safeParse({ ...validFigmaBaseline, kind: "web" }).success).toBe(
      false,
    );
  });

  it("rejects an empty fileKey", () => {
    expect(figmaBaselineSchema.safeParse({ ...validFigmaBaseline, fileKey: "" }).success).toBe(
      false,
    );
  });

  it("rejects a malformed nodeId", () => {
    expect(
      figmaBaselineSchema.safeParse({ ...validFigmaBaseline, nodeId: "not-a-node-id" }).success,
    ).toBe(false);
  });

  it("accepts a device pixel ratio up to 4 for a sharper Figma export", () => {
    for (const scale of [1, 2, 3, 4]) {
      const result = figmaBaselineSchema.safeParse({ ...validFigmaBaseline, scale });
      expect(result.success).toBe(true);
      expect(result.success && result.data.scale).toBe(scale);
    }
  });

  it("rejects a scale of 0, above 4, or non-integer", () => {
    expect(figmaBaselineSchema.safeParse({ ...validFigmaBaseline, scale: 0 }).success).toBe(false);
    expect(figmaBaselineSchema.safeParse({ ...validFigmaBaseline, scale: 5 }).success).toBe(false);
    expect(figmaBaselineSchema.safeParse({ ...validFigmaBaseline, scale: 1.5 }).success).toBe(
      false,
    );
  });

  it("accepts a 3-digit hex canvasFill", () => {
    expect(
      figmaBaselineSchema.safeParse({ ...validFigmaBaseline, canvasFill: "#abc" }).success,
    ).toBe(true);
  });

  it("accepts a 6-digit hex canvasFill", () => {
    expect(
      figmaBaselineSchema.safeParse({ ...validFigmaBaseline, canvasFill: "#aabbcc" }).success,
    ).toBe(true);
  });

  it("rejects a malformed canvasFill", () => {
    expect(
      figmaBaselineSchema.safeParse({ ...validFigmaBaseline, canvasFill: "blue" }).success,
    ).toBe(false);
  });

  it("rejects an unknown field (strict)", () => {
    expect(figmaBaselineSchema.safeParse({ ...validFigmaBaseline, extra: "nope" }).success).toBe(
      false,
    );
  });
});

describe("baselineSchema", () => {
  it("is currently an alias for figmaBaselineSchema (only baseline kind so far)", () => {
    expect(baselineSchema.safeParse(validFigmaBaseline).success).toBe(true);
  });
});
