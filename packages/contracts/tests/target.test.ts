import { describe, expect, it } from "vitest";

import { webTargetSchema } from "../src/target.ts";

describe("webTargetSchema", () => {
  it("round-trips a valid web target", () => {
    const value = { kind: "web" as const, url: "https://example.com" };
    const result = webTargetSchema.safeParse(value);
    expect(result.success).toBe(true);
    expect(result.success && result.data).toEqual(value);
  });

  it("rejects a non-web kind", () => {
    expect(webTargetSchema.safeParse({ kind: "figma", url: "https://example.com" }).success).toBe(
      false,
    );
  });

  it("rejects a non-http(s) url", () => {
    expect(webTargetSchema.safeParse({ kind: "web", url: "ftp://example.com" }).success).toBe(
      false,
    );
  });

  it("rejects an unknown field (strict)", () => {
    expect(
      webTargetSchema.safeParse({ kind: "web", url: "https://example.com", extra: 1 }).success,
    ).toBe(false);
  });
});
