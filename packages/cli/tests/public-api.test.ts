import { describe, expect, it } from "vitest";

import * as publicApi from "../src/index.ts";

/**
 * The library surface is narrow on purpose. This snapshot is the guard against
 * it silently widening back into a re-export of `@framelia/contracts` and
 * `@framelia/verify`.
 */
const EXPECTED_EXPORTS = [
  "archivedDashboardSource",
  "defineConfig",
  "exportDashboardReport",
  "loadFrameliaConfig",
  "projectArtifact",
  "readVerificationArtifact",
  "startDashboardServer",
  "waitForDashboardShutdown",
];

describe("public API surface (src/index.ts)", () => {
  it("exports exactly the config and dashboard facades", () => {
    expect(Object.keys(publicApi).toSorted()).toEqual(EXPECTED_EXPORTS);
  });

  it("round-trips a config through defineConfig", () => {
    const config = publicApi.defineConfig({ storageStatePath: ".framelia/auth.json" });
    expect(config.storageStatePath).toBe(".framelia/auth.json");
  });
});
