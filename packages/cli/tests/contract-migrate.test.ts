import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PassThrough } from "node:stream";

import { authoredContractSchema } from "@framelia/contracts/workflow";
import { migrationTransactionPath, type FetchBaselineFn } from "@framelia/verify";
import { inspectAuthoredContracts } from "@framelia/verify/project-policy";
import { afterEach, describe, expect, it } from "vitest";

import { runCheck } from "../src/internal/check.ts";
import {
  contractCreateCommand,
  type ContractCreateOptions,
} from "../src/internal/contract-create.ts";
import { contractListCommand } from "../src/internal/contract-list.ts";
import {
  contractMigrateCommand,
  type ContractMigrateOptions,
} from "../src/internal/contract-migrate.ts";
import { openProject } from "../src/internal/project.ts";
import { nonInteractivePrompts } from "../src/internal/prompts.ts";
import type { CliRuntime } from "../src/runtime-types.ts";

const PNG_10_BY_10 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAIAAAACUFjqAAAAH0lEQVR4nOTJQQ0AAAwCMbLMv+VDARig3z6g7FSttgEAAP//iF8rAQAAAAZJREFUAwCphQMUUAhjNAAAAABJRU5ErkJggg==",
  "base64",
);
const roots: string[] = [];

function temporaryProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-contract-migrate-"));
  roots.push(root);
  fs.writeFileSync(
    path.join(root, "framelia.config.mjs"),
    'export default { playwright: { config: "playwright.config.ts", projects: ["chromium"] }, contracts: [".framelia/contracts/**/visual-contract.json"] };\n',
  );
  fs.writeFileSync(path.join(root, "playwright.config.ts"), "export default {};\n");
  return root;
}

function runtime(root: string): CliRuntime {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  stdout.resume();
  stderr.resume();
  return {
    cwd: () => root,
    env: {},
    stdin: new PassThrough(),
    stdout,
    stderr,
    exitCode: undefined,
  };
}

function fakeFetch(backgroundColor = "#ff0000ff", onFetch?: () => void): FetchBaselineFn {
  return async (options) => {
    onFetch?.();
    fs.writeFileSync(options.outPath, PNG_10_BY_10);
    const meta = {
      nodeId: options.nodeId,
      fileKey: options.fileKey,
      lastModified: null,
      fetchedAt: "2026-09-22T00:00:00.000Z",
      apiCallCount: 0,
      apiCallLog: [],
    };
    const metaPath = `${options.outPath}.meta.json`;
    fs.writeFileSync(metaPath, JSON.stringify(meta));
    return {
      ok: true,
      fetched: true,
      baselinePath: options.outPath,
      metaPath,
      meta,
      warnings: [],
      figmaStyle: { backgroundColor },
    };
  };
}

function legacyContractEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: "login.legacy",
    name: "Login (legacy)",
    baseline: { kind: "figma", fileKey: "legacy-file", nodeId: "1:2" },
    viewport: { preset: "custom", width: 10, height: 10 },
    scope: { kind: "page", pageReason: "The selected frame is the complete page." },
    masks: [{ selector: ".timestamp", reason: "dynamic timestamp" }],
    profileOverrides: { minSSIM: 0.9 },
    ...overrides,
  };
}

function legacyRequestFixture(
  contracts: Record<string, unknown>[] = [legacyContractEntry()],
  target: Record<string, unknown> = {
    kind: "web",
    url: "https://app.example.com/login?state=error",
  },
) {
  return { schemaVersion: 5, target, contracts };
}

function writeLegacyFixture(root: string, relativeDir: string, request: unknown): string {
  const filePath = path.join(root, ".framelia/contracts", relativeDir, "visual-contract.json");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(request, null, 2));
  return filePath;
}

function createOptions(
  root: string,
  overrides: Partial<ContractCreateOptions> = {},
): ContractCreateOptions {
  return {
    projectRoot: root,
    output: undefined,
    force: undefined,
    targetPath: "/account?tab=profile",
    targetUrl: undefined,
    contractId: "account.profile",
    name: "Account profile",
    figmaUrl: "https://www.figma.com/design/file-key/Profile?node-id=6006-1028",
    fileKey: undefined,
    nodeId: undefined,
    viewport: "custom",
    viewportName: "fixture",
    viewportWidth: 10,
    viewportHeight: 10,
    scope: "page",
    pageReason: "The selected frame is the complete page.",
    styleCheckSelector: undefined,
    styleCheckNodeId: undefined,
    selector: undefined,
    regionWidth: undefined,
    regionHeight: undefined,
    ...overrides,
  };
}

function migrateOptions(
  root: string,
  overrides: Partial<ContractMigrateOptions> = {},
): ContractMigrateOptions {
  return {
    projectRoot: root,
    dryRun: undefined,
    contract: undefined,
    map: undefined,
    recover: undefined,
    ...overrides,
  };
}

function writeMap(root: string, map: Record<string, unknown>): string {
  const mapPath = path.join(root, "migration-map.json");
  fs.writeFileSync(mapPath, JSON.stringify(map, null, 2));
  return "migration-map.json";
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("contract migrate", () => {
  it("dry-run reports the derived route and requires an explicit baseline resolution without writing", async () => {
    const root = temporaryProject();
    const legacyPath = writeLegacyFixture(root, "login-legacy", legacyRequestFixture());
    const mapFile = writeMap(root, { "login.legacy": { projects: ["chromium"] } });
    const result = await contractMigrateCommand(
      migrateOptions(root, { dryRun: true, map: mapFile }),
      nonInteractivePrompts,
      runtime(root),
    );
    expect(result.exitCode).toBe(2);
    expect(result.body.dryRun).toBe(true);
    expect(result.body.migrated).toEqual([]);
    expect(result.body.unresolved).toHaveLength(1);
    expect(result.body.unresolved[0]).toMatchObject({
      contractId: "login.legacy",
      diagnostics: [{ code: "MIGRATION_BASELINE_UNRESOLVED" }],
    });
    expect(fs.readFileSync(legacyPath, "utf8")).toContain("login.legacy");
    expect(fs.existsSync(path.join(root, ".framelia/contracts/login.legacy"))).toBe(false);
  });

  it("reports a missing route and an absent baseline together for one contract, and multiple contracts together in one dry-run", async () => {
    const root = temporaryProject();
    // Contract A: unparseable request-level target (broken URL) but otherwise valid entry
    // -- recovered leniently with route unresolved, and no baseline resolution supplied.
    writeLegacyFixture(
      root,
      "a-legacy",
      legacyRequestFixture([legacyContractEntry({ id: "a.legacy" })], {
        kind: "web",
        url: "not-a-valid-url",
      }),
    );
    // Contract B: valid route, but its map-supplied snapshotDigest does not exist.
    writeLegacyFixture(
      root,
      "b-legacy",
      legacyRequestFixture([legacyContractEntry({ id: "b.legacy" })]),
    );
    const mapFile = writeMap(root, {
      "b.legacy": { snapshotDigest: `sha256:${"f".repeat(64)}`, projects: ["chromium"] },
    });

    const result = await contractMigrateCommand(
      migrateOptions(root, { dryRun: true, map: mapFile }),
      nonInteractivePrompts,
      runtime(root),
    );
    expect(result.exitCode).toBe(2);
    expect(result.body.unresolved).toHaveLength(2);
    const byId = Object.fromEntries(
      result.body.unresolved.map((entry) => [entry.contractId, entry]),
    );
    expect(byId["a.legacy"]!.diagnostics.map((d) => d.code).toSorted()).toEqual(
      [
        "MIGRATION_BASELINE_UNRESOLVED",
        "MIGRATION_PROJECTS_UNRESOLVED",
        "MIGRATION_ROUTE_UNRESOLVED",
      ].toSorted(),
    );
    expect(byId["b.legacy"]!.diagnostics[0]?.code).toBe("PINNED_BASELINE_MISSING");
    expect(fs.existsSync(path.join(root, ".framelia/contracts/a.legacy"))).toBe(false);
    expect(fs.existsSync(path.join(root, ".framelia/contracts/b.legacy"))).toBe(false);
  });

  it("write mode changes nothing when any selected contract is blocked", async () => {
    const root = temporaryProject();
    const legacyPath = writeLegacyFixture(root, "login-legacy", legacyRequestFixture());
    const result = await contractMigrateCommand(
      migrateOptions(root),
      nonInteractivePrompts,
      runtime(root),
    );
    expect(result.exitCode).toBe(2);
    expect(result.body.dryRun).toBe(false);
    expect(result.body.migrated).toEqual([]);
    expect(fs.existsSync(legacyPath)).toBe(true);
    expect(fs.existsSync(path.join(root, ".framelia/contracts/login.legacy"))).toBe(false);
  });

  it("migrates a legacy contract end-to-end, preserving masks/thresholds and deriving the route", async () => {
    const root = temporaryProject();
    const legacyPath = writeLegacyFixture(root, "login-legacy", legacyRequestFixture());
    const mapFile = writeMap(root, {
      "login.legacy": { projects: ["chromium"], refreshBaseline: true },
    });

    const result = await contractMigrateCommand(
      migrateOptions(root, { map: mapFile }),
      nonInteractivePrompts,
      runtime(root),
      { fetchBaseline: fakeFetch() },
    );
    expect(result.exitCode).toBe(0);
    expect(result.body.migrated).toHaveLength(1);
    const entry = result.body.migrated[0]!;
    expect(entry.contractId).toBe("login.legacy");
    expect(entry.removedOrigin).toBe("https://app.example.com");
    expect(entry.path).toBe(".framelia/contracts/login.legacy/visual-contract.json");

    expect(fs.existsSync(legacyPath)).toBe(false);
    const written = authoredContractSchema.parse(
      JSON.parse(fs.readFileSync(path.join(root, entry.path), "utf8")),
    );
    expect(written.target.path).toBe("/login?state=error");
    expect(written.masks).toEqual([{ selector: ".timestamp", reason: "dynamic timestamp" }]);
    expect(written.profileOverrides).toEqual({ minSSIM: 0.9 });
    expect(written.projects).toEqual(["chromium"]);
    expect(written.revision).toBe(1);
    expect(fs.existsSync(migrationTransactionPath(root))).toBe(false);

    const listed = await contractListCommand({ projectRoot: root }, runtime(root));
    expect(listed.body.contracts.some((c) => c.contractId === "login.legacy")).toBe(true);
  });

  it("rewrites (not deletes) a legacy file when only some of its sibling contracts migrate", async () => {
    const root = temporaryProject();
    const legacyPath = writeLegacyFixture(
      root,
      "shared-legacy",
      legacyRequestFixture([
        legacyContractEntry({ id: "a.legacy" }),
        legacyContractEntry({ id: "b.legacy", name: "B legacy" }),
      ]),
    );
    const mapFile = writeMap(root, {
      "a.legacy": { projects: ["chromium"], refreshBaseline: true },
    });
    const result = await contractMigrateCommand(
      migrateOptions(root, { contract: ["a.legacy"], map: mapFile }),
      nonInteractivePrompts,
      runtime(root),
      { fetchBaseline: fakeFetch() },
    );
    expect(result.exitCode).toBe(0);
    expect(result.body.migrated).toHaveLength(1);
    expect(fs.existsSync(legacyPath)).toBe(true);
    const remaining = JSON.parse(fs.readFileSync(legacyPath, "utf8"));
    expect(remaining.contracts.map((c: { id: string }) => c.id)).toEqual(["b.legacy"]);
    expect(fs.existsSync(path.join(root, ".framelia/contracts/a.legacy"))).toBe(true);
  });

  it("adopts an already-published pinned snapshot digest supplied through --map", async () => {
    const root = temporaryProject();
    const created = await contractCreateCommand(
      createOptions(root, { contractId: "seed.page", scope: "page" }),
      nonInteractivePrompts,
      runtime(root),
      { fetchBaseline: fakeFetch() },
    );
    expect(created.exitCode).toBe(0);
    const seededDigest = created.body.contract!.snapshotDigest;

    writeLegacyFixture(root, "adopt-legacy", legacyRequestFixture());
    const mapFile = writeMap(root, {
      "login.legacy": { projects: ["chromium"], snapshotDigest: seededDigest },
    });
    const result = await contractMigrateCommand(
      migrateOptions(root, { map: mapFile }),
      nonInteractivePrompts,
      runtime(root),
    );
    expect(result.exitCode).toBe(0);
    expect(result.body.migrated[0]?.snapshotDigest).toBe(seededDigest);
  });

  it("rejects a concurrent edit to the legacy file made during baseline acquisition", async () => {
    const root = temporaryProject();
    const legacyPath = writeLegacyFixture(root, "login-legacy", legacyRequestFixture());
    const mapFile = writeMap(root, {
      "login.legacy": { projects: ["chromium"], refreshBaseline: true },
    });
    let concurrentBytes = "";
    const result = await contractMigrateCommand(
      migrateOptions(root, { map: mapFile }),
      nonInteractivePrompts,
      runtime(root),
      {
        fetchBaseline: fakeFetch("#00ff00ff", () => {
          const request = JSON.parse(fs.readFileSync(legacyPath, "utf8"));
          request.contracts[0].name = "Concurrently edited";
          concurrentBytes = `${JSON.stringify(request, null, 2)}\n`;
          fs.writeFileSync(legacyPath, concurrentBytes);
        }),
      },
    );
    expect(result.exitCode).toBe(2);
    expect(result.body.diagnostics[0]?.code).toBe("AUTHORING_CONFLICT");
    expect(fs.readFileSync(legacyPath, "utf8")).toBe(concurrentBytes);
    expect(fs.existsSync(path.join(root, ".framelia/contracts/login.legacy"))).toBe(false);
    expect(fs.existsSync(migrationTransactionPath(root))).toBe(false);
  });

  it("leaves a marker check/list refuse when interrupted after staging, and --recover finishes cleanly", async () => {
    const root = temporaryProject();
    const legacyPath = writeLegacyFixture(root, "login-legacy", legacyRequestFixture());
    const mapFile = writeMap(root, {
      "login.legacy": { projects: ["chromium"], refreshBaseline: true },
    });

    const crashed = await contractMigrateCommand(
      migrateOptions(root, { map: mapFile }),
      nonInteractivePrompts,
      runtime(root),
      {
        fetchBaseline: fakeFetch(),
        afterTransactionMarkerWritten: () => {
          throw new Error("simulated crash after the marker was durably written");
        },
      },
    );
    expect(crashed.exitCode).toBe(2);
    expect(fs.existsSync(migrationTransactionPath(root))).toBe(true);
    // Interruption never left a partially migrated set looking valid: the new contract
    // file was never written, and the legacy file is untouched.
    expect(fs.existsSync(path.join(root, ".framelia/contracts/login.legacy"))).toBe(false);
    expect(fs.existsSync(legacyPath)).toBe(true);

    const policy = await openProject(root, runtime(root)).loadConfig();
    await expect(inspectAuthoredContracts(policy)).rejects.toMatchObject({
      code: "MIGRATION_INCOMPLETE",
    });
    const blockedList = await contractListCommand({ projectRoot: root }, runtime(root));
    expect(blockedList.exitCode).toBe(2);

    const dryRecover = await contractMigrateCommand(
      migrateOptions(root, { dryRun: true, recover: true }),
      nonInteractivePrompts,
      runtime(root),
    );
    expect(dryRecover.exitCode).toBe(2);
    expect(fs.existsSync(migrationTransactionPath(root))).toBe(true);

    const recovered = await contractMigrateCommand(
      migrateOptions(root, { recover: true }),
      nonInteractivePrompts,
      runtime(root),
    );
    expect(recovered.exitCode).toBe(0);
    expect(recovered.body.migrated).toHaveLength(1);
    expect(fs.existsSync(migrationTransactionPath(root))).toBe(false);
    expect(fs.existsSync(legacyPath)).toBe(false);
    expect(
      fs.existsSync(path.join(root, ".framelia/contracts/login.legacy/visual-contract.json")),
    ).toBe(true);

    const finalList = await contractListCommand({ projectRoot: root }, runtime(root));
    expect(finalList.body.diagnostics.some((d) => d.code === "MIGRATION_INCOMPLETE")).toBe(false);
  });

  it("check refuses to run while a migration transaction is pending", async () => {
    const root = temporaryProject();
    const legacyPath = writeLegacyFixture(root, "login-legacy", legacyRequestFixture());
    const mapFile = writeMap(root, {
      "login.legacy": { projects: ["chromium"], refreshBaseline: true },
    });
    const crashed = await contractMigrateCommand(
      migrateOptions(root, { map: mapFile }),
      nonInteractivePrompts,
      runtime(root),
      {
        fetchBaseline: fakeFetch(),
        afterTransactionMarkerWritten: () => {
          throw new Error("simulated crash after the marker was durably written");
        },
      },
    );
    expect(crashed.exitCode).toBe(2);
    expect(fs.existsSync(migrationTransactionPath(root))).toBe(true);

    const outcome = await runCheck({
      contract: [],
      all: true,
      project: [],
      projectRoot: root,
      runtime: runtime(root),
    });
    expect(outcome.exitCode).toBe(2);
    expect(outcome.executionState).toBe("error");
    expect(outcome.diagnostics[0]?.message).toContain("interrupted contract migration is pending");
    expect(fs.existsSync(legacyPath)).toBe(true);
  });

  it("never overwrites an id that already has an authored contract", async () => {
    const root = temporaryProject();
    const created = await contractCreateCommand(
      createOptions(root, { contractId: "login.legacy", scope: "page" }),
      nonInteractivePrompts,
      runtime(root),
      { fetchBaseline: fakeFetch() },
    );
    expect(created.exitCode).toBe(0);
    writeLegacyFixture(root, "login-legacy", legacyRequestFixture());

    const result = await contractMigrateCommand(
      migrateOptions(root, { dryRun: true }),
      nonInteractivePrompts,
      runtime(root),
    );
    expect(result.exitCode).toBe(2);
    expect(result.body.unresolved[0]).toMatchObject({
      contractId: "login.legacy",
      diagnostics: [{ code: "MIGRATION_ID_CONFLICT" }],
    });
  });
});
