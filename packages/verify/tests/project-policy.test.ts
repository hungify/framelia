import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  discoverAuthoredContracts,
  discoverProjectConfig,
  resolveContractProjectMatrix,
  resolveProjectPolicy,
  type DiscoveredAuthoredContract,
} from "../src/project-policy.ts";

const temporaryDirectories: string[] = [];
const DIGEST = `sha256:${"a".repeat(64)}` as const;

function temporaryProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-policy-"));
  temporaryDirectories.push(root);
  fs.mkdirSync(path.join(root, ".git"));
  return root;
}

function writeConfig(root: string, contents: string): void {
  fs.writeFileSync(path.join(root, "framelia.config.mjs"), contents);
}

function authoredContract(id: string, overrides: Record<string, unknown> = {}) {
  return {
    formatVersion: 1,
    kind: "framelia.contract",
    id,
    name: id,
    required: true,
    revision: 1,
    target: { path: `/${id}` },
    viewport: { preset: "desktop", width: 800, height: 600 },
    scope: { kind: "page", pageReason: "The whole state is reviewed." },
    baseline: { snapshotDigest: DIGEST },
    ...overrides,
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("project discovery", () => {
  it("selects the nearest config ancestor and never a sibling application", () => {
    const root = temporaryProject();
    const app = path.join(root, "apps", "storefront");
    const sibling = path.join(root, "apps", "admin");
    const nested = path.join(app, "src", "routes");
    fs.mkdirSync(nested, { recursive: true });
    fs.mkdirSync(sibling, { recursive: true });
    writeConfig(app, "export default {};\n");
    writeConfig(sibling, "export default {};\n");

    expect(discoverProjectConfig(nested)).toEqual({
      root: app,
      configPath: path.join(app, "framelia.config.mjs"),
    });
  });

  it("checks only an explicit root and reports uninitialized workflow operations", async () => {
    const root = temporaryProject();
    const child = path.join(root, "app");
    fs.mkdirSync(child);
    writeConfig(child, "export default {};\n");

    await expect(resolveProjectPolicy({ cwd: root, projectRoot: root })).rejects.toMatchObject({
      code: "PROJECT_NOT_INITIALIZED",
    });
    await expect(
      resolveProjectPolicy({ cwd: root, projectRoot: root, allowUninitialized: true }),
    ).resolves.toMatchObject({ root, initialized: false });
  });

  it("rejects multiple supported config files in one root", () => {
    const root = temporaryProject();
    writeConfig(root, "export default {};\n");
    fs.writeFileSync(path.join(root, "framelia.config.js"), "export default {};\n");

    expect(() => discoverProjectConfig(root)).toThrow("Multiple Framelia config files found");
  });
});

describe("effective project policy", () => {
  it("resolves path identities and environment precedence without returning values", async () => {
    const root = temporaryProject();
    fs.writeFileSync(path.join(root, ".env"), "SHARED=base\nBASE_ONLY=base\nLOCKED=base\n");
    fs.writeFileSync(path.join(root, ".env.local"), "SHARED=local\nLOCAL_ONLY=local\n");
    fs.writeFileSync(
      path.join(root, ".env.e2e"),
      "SHARED=custom\nCUSTOM_ONLY=custom\nLOCKED=custom\n",
    );
    writeConfig(
      root,
      `export default {
        playwright: { config: "e2e/playwright.config.ts", projects: ["", "chromium"] },
        contracts: [".framelia/contracts/**/visual-contract.json"],
        envFile: ".env.e2e",
        stabilitySamples: 3,
        retryAcceptance: "allow-passed-after-retry"
      };\n`,
    );
    const env: NodeJS.ProcessEnv = { LOCKED: "process" };

    const policy = await resolveProjectPolicy({ cwd: root, env });

    expect(policy).toMatchObject({
      root,
      configFile: "framelia.config.mjs",
      initialized: true,
      playwright: {
        config: "e2e/playwright.config.ts",
        configPath: path.join(root, "e2e/playwright.config.ts"),
        projects: ["", "chromium"],
      },
      contracts: {
        patterns: [".framelia/contracts/**/visual-contract.json"],
        roots: [".framelia/contracts"],
      },
      envFiles: [".env", ".env.local", ".env.e2e"],
      loadedEnvFiles: [".env", ".env.local", ".env.e2e"],
      capture: { stabilitySamples: 3 },
      retryAcceptance: "allow-passed-after-retry",
    });
    expect(policy.policyDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(env).toMatchObject({
      LOCKED: "process",
      SHARED: "custom",
      BASE_ONLY: "base",
      LOCAL_ONLY: "local",
      CUSTOM_ONLY: "custom",
    });
    expect(JSON.stringify(policy)).not.toContain("CUSTOM_ONLY");
  });
});

describe("authored contract matrix", () => {
  it("fails discovery when contract ids are duplicated across files", async () => {
    const root = temporaryProject();
    const contractsRoot = path.join(root, ".framelia", "contracts");
    fs.mkdirSync(contractsRoot, { recursive: true });
    writeConfig(
      root,
      'export default { playwright: { config: "playwright.config.ts", projects: ["chromium"] }, contracts: [".framelia/contracts/*.json"] };\n',
    );
    fs.writeFileSync(
      path.join(contractsRoot, "desktop.json"),
      JSON.stringify(authoredContract("login")),
    );
    fs.writeFileSync(
      path.join(contractsRoot, "mobile.json"),
      JSON.stringify(authoredContract("login")),
    );
    const policy = await resolveProjectPolicy({ cwd: root });

    await expect(discoverAuthoredContracts(policy)).rejects.toMatchObject({
      code: "DUPLICATE_CONTRACT_ID",
    });
  });

  it("validates removed projects even for optional contracts and excludes optional pairs from all", () => {
    const policy = {
      root: "/project",
      initialized: true,
      playwright: {
        config: "playwright.config.ts",
        configPath: "/project/playwright.config.ts",
        projects: ["chromium"],
      },
      envFiles: [],
      loadedEnvFiles: [],
      capture: {},
      retryAcceptance: "require-first-attempt" as const,
    };
    const required: DiscoveredAuthoredContract = {
      file: "required.json",
      digest: DIGEST,
      contract: authoredContract("required") as DiscoveredAuthoredContract["contract"],
    };
    const optional: DiscoveredAuthoredContract = {
      file: "optional.json",
      digest: DIGEST,
      contract: authoredContract("optional", {
        required: false,
        projects: ["chromium"],
      }) as DiscoveredAuthoredContract["contract"],
    };

    const matrix = resolveContractProjectMatrix(policy, [required, optional]);
    expect(matrix.allCases.map((entry) => entry.contractId)).toEqual(["required", "optional"]);
    expect(matrix.requiredCases.map((entry) => entry.contractId)).toEqual(["required"]);

    const removedProject = {
      ...optional,
      contract: { ...optional.contract, projects: ["webkit"] },
    };
    expect(() => resolveContractProjectMatrix(policy, [removedProject])).toThrow(
      'requires unknown Playwright project "webkit"',
    );
  });
});
