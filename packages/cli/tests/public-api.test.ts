import { describe, expect, it } from "vitest";

import * as publicApi from "../src/index.ts";

describe("public API surface (src/index.ts)", () => {
  it("exports the selected-run dashboard facade", () => {
    expect(publicApi.selectedDashboardSource).toBeTypeOf("function");
    expect(publicApi.projectSelectedRun).toBeTypeOf("function");
    expect(publicApi.exportDashboardReport).toBeTypeOf("function");
  });

  it("round-trips a config through defineConfig", () => {
    const config = publicApi.defineConfig({ storageStatePath: ".framelia/auth.json" });
    expect(config.storageStatePath).toBe(".framelia/auth.json");
  });
});
