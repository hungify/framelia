import { describe, expect, it } from "vitest";

import { httpUrlSchema, nonEmptyTrimmed } from "../src/primitives.ts";

describe("nonEmptyTrimmed", () => {
  it("accepts a non-empty string", () => {
    expect(nonEmptyTrimmed.safeParse("hello").success).toBe(true);
  });

  it("rejects an empty string", () => {
    expect(nonEmptyTrimmed.safeParse("").success).toBe(false);
  });

  it("rejects a whitespace-only string (trimmed to empty)", () => {
    expect(nonEmptyTrimmed.safeParse("   ").success).toBe(false);
  });

  it("trims surrounding whitespace on parse", () => {
    const result = nonEmptyTrimmed.safeParse("  hello  ");
    expect(result.success).toBe(true);
    expect(result.success && result.data).toBe("hello");
  });
});

describe("httpUrlSchema", () => {
  it("accepts an http:// URL", () => {
    expect(httpUrlSchema.safeParse("http://example.com").success).toBe(true);
  });

  it("accepts an https:// URL", () => {
    expect(httpUrlSchema.safeParse("https://example.com/path?query=1").success).toBe(true);
  });

  it("accepts an uppercase-scheme URL (case-insensitive match)", () => {
    expect(httpUrlSchema.safeParse("HTTPS://example.com").success).toBe(true);
  });

  it("rejects a non-http(s) scheme", () => {
    expect(httpUrlSchema.safeParse("ftp://example.com").success).toBe(false);
  });

  it("rejects a value that is not a URL at all", () => {
    expect(httpUrlSchema.safeParse("not a url").success).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(httpUrlSchema.safeParse("").success).toBe(false);
  });
});
