import { describe, expect, it } from "vitest";

import * as publicApi from "../src/index.ts";

describe("public API surface (src/index.ts)", () => {
  it("keeps the config facade exports", () => {
    expect(typeof publicApi.defineConfig).toBe("function");
    expect(typeof publicApi.loadFrameliaConfig).toBe("function");
  });

  it("keeps the dashboard report facade exports", () => {
    expect(typeof publicApi.archivedDashboardSource).toBe("function");
    expect(typeof publicApi.exportDashboardReport).toBe("function");
    expect(typeof publicApi.readVerificationArtifact).toBe("function");
  });

  it("keeps the re-exported @framelia/dashboard-server facade", () => {
    expect(typeof publicApi.projectArtifact).toBe("function");
    expect(typeof publicApi.startDashboardServer).toBe("function");
    expect(typeof publicApi.waitForDashboardShutdown).toBe("function");
  });

  it("keeps re-exported @framelia/contracts schemas that CLI commands depend on", () => {
    expect(publicApi.httpUrlSchema).toBeDefined();
    expect(typeof publicApi.httpUrlSchema.safeParse).toBe("function");
    expect(publicApi.profileSchema).toBeDefined();
    expect(publicApi.profileSchema.options).toEqual(["page", "component/strict", "component/dev"]);
    expect(publicApi.CONTRACT_ID_PATTERN).toBeInstanceOf(RegExp);
    expect(publicApi.FIGMA_NODE_ID).toBeInstanceOf(RegExp);
    expect(publicApi.verificationArtifactSchema).toBeDefined();
    expect(typeof publicApi.verificationArtifactSchema.safeParse).toBe("function");
    expect(publicApi.SCHEMA_VERSION).toBeDefined();
  });

  it("keeps re-exported @framelia/verify exit codes and env loading", () => {
    expect(typeof publicApi.EXIT_OK).toBe("number");
    expect(typeof publicApi.EXIT_USAGE_ERROR).toBe("number");
    expect(typeof publicApi.loadEnvFiles).toBe("function");
    expect(typeof publicApi.loadProjectEnv).toBe("function");
  });
});
