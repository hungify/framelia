import { describe, expect, it } from "vitest";

import { captureDefaultsSchema } from "../src/capture-defaults.ts";
import { DEFAULT_MAX_MASKED_AREA_RATIO } from "../src/constants.ts";

describe("captureDefaultsSchema", () => {
  it("round-trips an empty object (every field optional)", () => {
    expect(captureDefaultsSchema.safeParse({}).success).toBe(true);
  });

  it("round-trips a fully populated defaults object", () => {
    const value = {
      stabilitySamples: 3,
      timeoutMs: 30_000,
      devtoolsSelector: true as const,
      deviceScaleFactor: 2,
      fontPolicy: "required" as const,
      animationPolicy: "freeze" as const,
      retry: { attempts: 3, delayMs: 1000 },
      maxMaskedAreaRatio: 0.1,
    };
    const result = captureDefaultsSchema.safeParse(value);
    expect(result.success).toBe(true);
    expect(result.success && result.data).toEqual(value);
  });

  it("accepts a custom string devtoolsSelector in place of the boolean", () => {
    expect(captureDefaultsSchema.safeParse({ devtoolsSelector: "#devtools" }).success).toBe(true);
  });

  it("rejects devtoolsSelector: false (only true or a non-empty string)", () => {
    expect(captureDefaultsSchema.safeParse({ devtoolsSelector: false }).success).toBe(false);
  });

  it("rejects an empty-string devtoolsSelector", () => {
    expect(captureDefaultsSchema.safeParse({ devtoolsSelector: "" }).success).toBe(false);
  });

  it("rejects stabilitySamples below MIN_STABILITY_SAMPLES", () => {
    expect(captureDefaultsSchema.safeParse({ stabilitySamples: 1 }).success).toBe(false);
  });

  it("rejects stabilitySamples above MAX_STABILITY_SAMPLES", () => {
    expect(captureDefaultsSchema.safeParse({ stabilitySamples: 6 }).success).toBe(false);
  });

  it("rejects timeoutMs below MIN_CONTRACT_TIMEOUT_MS", () => {
    expect(captureDefaultsSchema.safeParse({ timeoutMs: 999 }).success).toBe(false);
  });

  it("rejects timeoutMs above MAX_CONTRACT_TIMEOUT_MS", () => {
    expect(captureDefaultsSchema.safeParse({ timeoutMs: 120_001 }).success).toBe(false);
  });

  it("rejects deviceScaleFactor above 4", () => {
    expect(captureDefaultsSchema.safeParse({ deviceScaleFactor: 5 }).success).toBe(false);
  });

  it("rejects a non-positive deviceScaleFactor", () => {
    expect(captureDefaultsSchema.safeParse({ deviceScaleFactor: 0 }).success).toBe(false);
  });

  it("rejects an unknown fontPolicy value", () => {
    expect(captureDefaultsSchema.safeParse({ fontPolicy: "ignore" }).success).toBe(false);
  });

  it("rejects an unknown animationPolicy value", () => {
    expect(captureDefaultsSchema.safeParse({ animationPolicy: "ignore" }).success).toBe(false);
  });

  it("rejects retry.attempts outside 1-5", () => {
    expect(captureDefaultsSchema.safeParse({ retry: { attempts: 6, delayMs: 0 } }).success).toBe(
      false,
    );
  });

  it("rejects retry with an unknown field (strict)", () => {
    expect(
      captureDefaultsSchema.safeParse({ retry: { attempts: 1, delayMs: 0, extra: 1 } }).success,
    ).toBe(false);
  });

  it("accepts maxMaskedAreaRatio at the DEFAULT_MAX_MASKED_AREA_RATIO ceiling", () => {
    expect(
      captureDefaultsSchema.safeParse({ maxMaskedAreaRatio: DEFAULT_MAX_MASKED_AREA_RATIO })
        .success,
    ).toBe(true);
  });

  it("rejects maxMaskedAreaRatio above DEFAULT_MAX_MASKED_AREA_RATIO -- this field may only lower the cap, never raise it", () => {
    expect(
      captureDefaultsSchema.safeParse({
        maxMaskedAreaRatio: DEFAULT_MAX_MASKED_AREA_RATIO + 0.01,
      }).success,
    ).toBe(false);
  });

  it("rejects a negative maxMaskedAreaRatio", () => {
    expect(captureDefaultsSchema.safeParse({ maxMaskedAreaRatio: -0.1 }).success).toBe(false);
  });

  it("rejects an unknown top-level field (strict)", () => {
    expect(captureDefaultsSchema.safeParse({ unknownField: true }).success).toBe(false);
  });
});
