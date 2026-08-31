import { describe, expect, it } from "vitest";

import { artifactModeMeta, resolveArtifactMode } from "../lib/artifact-mode";

describe("resolveArtifactMode", () => {
  it("prefers mock over other flags", () => {
    expect(resolveArtifactMode({ mockMode: true, staticMode: true, liveMode: true })).toBe("mock");
  });

  it("resolves report, live, archived", () => {
    expect(resolveArtifactMode({ mockMode: false, staticMode: true, liveMode: false })).toBe(
      "report",
    );
    expect(resolveArtifactMode({ mockMode: false, staticMode: false, liveMode: true })).toBe(
      "live",
    );
    expect(resolveArtifactMode({ mockMode: false, staticMode: false, liveMode: false })).toBe(
      "archived",
    );
  });
});

describe("artifactModeMeta", () => {
  it("returns label and dot class", () => {
    expect(artifactModeMeta("live")).toEqual({ label: "Live", dotClass: "bg-green" });
    expect(artifactModeMeta("report").dotClass).toBe("bg-blue");
  });
});
