import { describe, expect, it } from "vitest";

import { getProfile } from "../src/profiles.ts";

describe("getProfile", () => {
  it("keeps component/strict's own numbers unchanged when explicitly requested by name", () => {
    // Regression guard: resolveFigmaCompareOptions forces cluster on for the *default*
    // component comparison (see figma-profile.ts), but an explicitly-named profile must
    // still mean exactly what it always meant -- no default-only behavior leaking in.
    expect(getProfile("component/strict")).toMatchObject({
      minMatch: 0.995,
      maxDiffPixels: 500,
      minSSIM: 0.985,
      maxAvgDeltaE: 3.0,
      cluster: false,
    });
  });
});
