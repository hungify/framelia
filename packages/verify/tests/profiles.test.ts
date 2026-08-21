import { describe, expect, it } from "vitest";

import { getProfile, resolveDisplayThreshold } from "../src/profiles.ts";

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

describe("resolveDisplayThreshold", () => {
  it("returns the named profile's own numbers unchanged when no clusterCheck override is present", () => {
    expect(resolveDisplayThreshold({ profile: "component/dev" })).toStrictEqual(
      getProfile("component/dev"),
    );
  });

  it("overlays a clusterCheck override onto the resolved profile's cluster field", () => {
    // component/strict defaults to cluster: false; a resolved clusterCheck: true override
    // (e.g. Figma's default-component forcing, see figma-profile.ts) must win.
    expect(resolveDisplayThreshold({ profile: "component/strict", clusterCheck: true })).toEqual({
      ...getProfile("component/strict"),
      cluster: true,
    });
  });

  it("defaults to the page profile when no profile is given", () => {
    expect(resolveDisplayThreshold({})).toStrictEqual(getProfile("page"));
  });

  it("ignores an explicit clusterCheck: undefined rather than overwriting cluster with undefined", () => {
    expect(resolveDisplayThreshold({ profile: "page", clusterCheck: undefined })).toStrictEqual(
      getProfile("page"),
    );
  });
});
