import { describe, expect, it } from "vitest";

import { resolveFigmaCompareOptions } from "../src/figma-profile.ts";

describe("resolveFigmaCompareOptions", () => {
  it("defaults full-page scope to the page profile, no cluster override", () => {
    expect(resolveFigmaCompareOptions(undefined, false)).toEqual({ profile: "page" });
  });

  it("defaults component scope to component/strict with cluster forced on", () => {
    expect(resolveFigmaCompareOptions(undefined, true)).toEqual({
      profile: "component/strict",
      clusterCheck: true,
    });
  });

  it("respects an explicit profile as-is, without forcing cluster", () => {
    expect(resolveFigmaCompareOptions("component/dev", true)).toEqual({
      profile: "component/dev",
    });
  });
});
