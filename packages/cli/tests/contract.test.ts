import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PassThrough } from "node:stream";

import type { RunContext } from "@framelia/contracts/workflow";
import {
  canonicalJsonDigest,
  readPinnedBaseline,
  type CanonicalJsonValue,
  type FetchBaselineFn,
} from "@framelia/verify";
import { inspectAuthoredContracts } from "@framelia/verify/project-policy";
import { afterEach, describe, expect, it } from "vitest";

import {
  contractCreateCommand,
  type ContractCreateOptions,
  type ContractCreateDependencies,
} from "../src/internal/contract-create.ts";
import { parseFigmaDesignUrl } from "../src/internal/contract-interview.ts";
import { contractListCommand } from "../src/internal/contract-list.ts";
import { contractRefreshBaselineCommand } from "../src/internal/contract-refresh-baseline.ts";
import { openProject } from "../src/internal/project.ts";
import { nonInteractivePrompts } from "../src/internal/prompts.ts";
import type { CliRuntime } from "../src/runtime-types.ts";

const PNG_10_BY_10 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAIAAAACUFjqAAAAH0lEQVR4nOTJQQ0AAAwCMbLMv+VDARig3z6g7FSttgEAAP//iF8rAQAAAAZJREFUAwCphQMUUAhjNAAAAABJRU5ErkJggg==",
  "base64",
);
const roots: string[] = [];

function temporaryProject(playwright = false): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-contract-workflow-"));
  roots.push(root);
  fs.writeFileSync(
    path.join(root, "framelia.config.mjs"),
    playwright
      ? 'export default { playwright: { config: "playwright.config.ts", projects: ["chromium"] }, contracts: [".framelia/contracts/**/visual-contract.json"] };\n'
      : 'export default { contracts: [".framelia/contracts/**/visual-contract.json"] };\n',
  );
  if (playwright) fs.writeFileSync(path.join(root, "playwright.config.ts"), "export default {};\n");
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

function immediateChild(): ChildProcessWithoutNullStreams {
  return spawn(process.execPath, ["-e", ""], { stdio: ["pipe", "pipe", "pipe"] });
}

function executableCollection(root: string, repeatEach = 1): ContractCreateDependencies {
  return {
    fetchBaseline: fakeFetch(),
    playwrightCli: "/unused/local/playwright-cli.js",
    spawnPlaywright: (_executable, _argv, options) => {
      const context = JSON.parse(
        fs.readFileSync(options.env.FRAMELIA_RUN_CONTEXT!, "utf8"),
      ) as RunContext;
      const contractPath = path.join(
        root,
        ".framelia/contracts/account.profile/visual-contract.json",
      );
      const contract = JSON.parse(fs.readFileSync(contractPath, "utf8")) as Record<string, unknown>;
      const contractDigest = canonicalJsonDigest(contract as CanonicalJsonValue);
      const runtimeDigest = `sha256:${"b".repeat(64)}` as const;
      const specDigest = `sha256:${"c".repeat(64)}` as const;
      fs.writeFileSync(
        context.manifestPath,
        JSON.stringify({
          formatVersion: 2,
          kind: "framelia.collection",
          runId: context.runId,
          projectRoot: context.projectRoot,
          policyDigest: context.policyDigest,
          projects: [
            {
              name: "chromium",
              runtimeDigest,
              dependencies: [],
              repeatEach,
              retries: 0,
              testDir: "tests",
            },
          ],
          visualCases: Array.from({ length: repeatEach }, (_, repeatIndex) => ({
            formatVersion: 1,
            kind: "framelia.collected-case",
            binding: {
              formatVersion: 1,
              kind: "framelia.contract-binding",
              contractId: "account.profile",
              contractFile: ".framelia/contracts/account.profile/visual-contract.json",
              contractDigest,
            },
            project: "chromium",
            projectRuntimeDigest: runtimeDigest,
            specFile: "tests/visual.spec.ts",
            testListFile: "visual.spec.ts",
            specFileDigest: specDigest,
            location: { line: 1, column: 0 },
            testTitlePath: ["account profile"],
            repeatIndex,
          })),
          setupCases: [],
        }),
      );
      fs.writeFileSync(
        context.statusPath,
        JSON.stringify({
          formatVersion: 1,
          kind: "framelia.transport-status",
          writerVersion: "test",
          phase: "collection",
          mode: "collect",
          projectRoot: context.projectRoot,
          runId: context.runId,
          state: "completed",
          diagnostics: [],
        }),
      );
      return immediateChild();
    },
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("contract authoring workflow", () => {
  it("accepts only proven Figma design URLs and normalizes node-id", () => {
    expect(
      parseFigmaDesignUrl(
        "https://www.figma.com/design/AbCdEf/Login?node-id=6006-1028&t=irrelevant",
      ),
    ).toEqual({ fileKey: "AbCdEf", nodeId: "6006:1028" });
    expect(() => parseFigmaDesignUrl("https://www.figma.com/design/AbCdEf/Login")).toThrow(
      /with node-id/,
    );
    expect(() => parseFigmaDesignUrl("https://figma.com/file/AbCdEf/Login?node-id=1-2")).toThrow(
      /www\.figma\.com\/design/,
    );
  });

  it("returns one structured missing-input error without prompting or writing", async () => {
    const root = temporaryProject();
    const result = await contractCreateCommand(
      createOptions(root, {
        targetPath: undefined,
        contractId: undefined,
        name: undefined,
        figmaUrl: undefined,
        viewport: undefined,
        viewportName: undefined,
        viewportWidth: undefined,
        viewportHeight: undefined,
        scope: undefined,
        pageReason: undefined,
      }),
      nonInteractivePrompts,
      runtime(root),
      { fetchBaseline: fakeFetch() },
    );

    expect(result).toMatchObject({
      ok: false,
      exitCode: 2,
      body: {
        kind: "framelia.contract-create-outcome",
        authored: false,
        diagnostics: [
          { code: "CONTRACT_AUTHORING_FAILED", message: expect.stringContaining("MISSING_INPUT") },
        ],
      },
    });
    expect(fs.existsSync(path.join(root, ".framelia/contracts"))).toBe(false);
    expect(fs.existsSync(path.join(root, ".framelia/baselines"))).toBe(false);
  });

  it("publishes a validated immutable snapshot before the deterministic contract pointer", async () => {
    const root = temporaryProject();
    const result = await contractCreateCommand(
      createOptions(root),
      nonInteractivePrompts,
      runtime(root),
      { fetchBaseline: fakeFetch() },
    );

    expect(result).toMatchObject({
      ok: true,
      exitCode: 0,
      body: {
        authored: true,
        runnable: false,
        outcome: "created",
        contract: {
          id: "account.profile",
          path: ".framelia/contracts/account.profile/visual-contract.json",
          revision: 1,
        },
        registration: {
          status: "collection-blocked",
          recipe: expect.stringContaining("defineFigmaTests"),
        },
      },
    });
    const policy = await openProject(root, runtime(root)).loadConfig();
    const inspection = await inspectAuthoredContracts(policy);
    expect(inspection.invalid).toEqual([]);
    expect(inspection.contracts).toHaveLength(1);
    const pinned = await readPinnedBaseline(root, inspection.contracts[0]!.contract);
    expect(pinned.imageBytes).toEqual(PNG_10_BY_10);
    expect(pinned.snapshot.source).toEqual({
      kind: "figma",
      fileKey: "file-key",
      nodeId: "6006:1028",
    });
    expect(pinned.snapshot.metadata).toMatchObject({
      fileKey: "file-key",
      nodeId: "6006:1028",
      fetchedAt: "2026-09-22T00:00:00.000Z",
      apiCallCount: 0,
    });
    expect(pinned.snapshot.expected.style?.path).toBe("expected-style.json");
  });

  it("reports executable only when shared Playwright collection proves the exact binding", async () => {
    const root = temporaryProject(true);
    fs.mkdirSync(path.join(root, "tests"));
    fs.writeFileSync(path.join(root, "tests/visual.spec.ts"), "// fixture\n");
    const dependencies = executableCollection(root, 2);
    const created = await contractCreateCommand(
      createOptions(root),
      nonInteractivePrompts,
      runtime(root),
      dependencies,
    );
    expect(created.body.runnable).toBe(true);
    expect(created.body.registration).toBeUndefined();

    const listed = await contractListCommand({ projectRoot: root }, runtime(root), dependencies);
    expect(listed).toMatchObject({
      exitCode: 0,
      body: {
        executionState: "completed",
        contracts: [
          {
            contractId: "account.profile",
            project: "chromium",
            status: "executable",
            required: true,
            diagnostics: [],
          },
        ],
      },
    });
  });

  it("never clobbers a foreign file and force replaces only the exact global ID", async () => {
    const root = temporaryProject();
    fs.mkdirSync(path.join(root, "custom"));
    const foreignPath = path.join(root, "custom/contract.json");
    fs.writeFileSync(foreignPath, "foreign bytes\n");
    const refused = await contractCreateCommand(
      createOptions(root, { output: "custom/contract.json", force: true }),
      nonInteractivePrompts,
      runtime(root),
      { fetchBaseline: fakeFetch() },
    );
    expect(refused.exitCode).toBe(2);
    expect(fs.readFileSync(foreignPath, "utf8")).toBe("foreign bytes\n");

    const first = await contractCreateCommand(
      createOptions(root),
      nonInteractivePrompts,
      runtime(root),
      { fetchBaseline: fakeFetch() },
    );
    expect(first.exitCode).toBe(0);
    const sibling = await contractCreateCommand(
      createOptions(root, { contractId: "account.mobile", name: "Account mobile" }),
      nonInteractivePrompts,
      runtime(root),
      { fetchBaseline: fakeFetch() },
    );
    expect(sibling.exitCode).toBe(0);
    const replaced = await contractCreateCommand(
      createOptions(root, { name: "Profile reviewed", force: true }),
      nonInteractivePrompts,
      runtime(root),
      { fetchBaseline: fakeFetch("#00ff00ff") },
    );
    expect(replaced).toMatchObject({ body: { outcome: "replaced", contract: { revision: 2 } } });
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(root, ".framelia/contracts/account.mobile/visual-contract.json"),
          "utf8",
        ),
      ).revision,
    ).toBe(1);
  });

  it("preserves a concurrent contract edit instead of replacing it after acquisition", async () => {
    const root = temporaryProject();
    const created = await contractCreateCommand(
      createOptions(root),
      nonInteractivePrompts,
      runtime(root),
      { fetchBaseline: fakeFetch() },
    );
    expect(created.exitCode).toBe(0);
    const contractPath = path.join(
      root,
      ".framelia/contracts/account.profile/visual-contract.json",
    );
    let concurrentBytes = "";
    const refresh = await contractRefreshBaselineCommand(
      { projectRoot: root, contract: "account.profile" },
      runtime(root),
      {
        fetchBaseline: fakeFetch("#00ff00ff", () => {
          const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
          contract.name = "Concurrent edit";
          concurrentBytes = `${JSON.stringify(contract, null, 2)}\n`;
          fs.writeFileSync(contractPath, concurrentBytes);
        }),
      },
    );
    expect(refresh).toMatchObject({
      exitCode: 2,
      body: { diagnostics: [{ code: "AUTHORING_CONFLICT" }] },
    });
    expect(fs.readFileSync(contractPath, "utf8")).toBe(concurrentBytes);
  });

  it("keeps the old pointer usable when publication fails after creating an orphan snapshot", async () => {
    const root = temporaryProject();
    const created = await contractCreateCommand(
      createOptions(root),
      nonInteractivePrompts,
      runtime(root),
      { fetchBaseline: fakeFetch() },
    );
    expect(created.exitCode).toBe(0);
    const contractPath = path.join(
      root,
      ".framelia/contracts/account.profile/visual-contract.json",
    );
    const previousBytes = fs.readFileSync(contractPath);
    const previousContract = JSON.parse(previousBytes.toString("utf8"));
    const previousSnapshot = previousContract.baseline.snapshotDigest;

    const failed = await contractRefreshBaselineCommand(
      { projectRoot: root, contract: "account.profile" },
      runtime(root),
      {
        fetchBaseline: fakeFetch("#00ff00ff"),
        afterSnapshotPublished: () => {
          throw new Error("simulated pointer failure");
        },
      },
    );
    expect(failed.exitCode).toBe(2);
    expect(fs.readFileSync(contractPath)).toEqual(previousBytes);
    const baselines = fs.readdirSync(path.join(root, ".framelia/baselines"));
    expect(baselines).toHaveLength(2);
    expect(baselines).toContain(previousSnapshot.slice("sha256:".length));
    await expect(readPinnedBaseline(root, previousContract)).resolves.toMatchObject({
      snapshot: {
        source: { kind: "figma", fileKey: "file-key", nodeId: "6006:1028" },
      },
    });
  });

  it("lists duplicate IDs and malformed files as invalid without hiding either file", async () => {
    const root = temporaryProject();
    const created = await contractCreateCommand(
      createOptions(root),
      nonInteractivePrompts,
      runtime(root),
      { fetchBaseline: fakeFetch() },
    );
    expect(created.exitCode).toBe(0);
    const original = path.join(root, ".framelia/contracts/account.profile/visual-contract.json");
    const duplicate = path.join(root, ".framelia/contracts/duplicate/visual-contract.json");
    const malformed = path.join(root, ".framelia/contracts/malformed/visual-contract.json");
    fs.mkdirSync(path.dirname(duplicate), { recursive: true });
    fs.mkdirSync(path.dirname(malformed), { recursive: true });
    fs.copyFileSync(original, duplicate);
    fs.writeFileSync(malformed, "{\n");

    const listed = await contractListCommand({ projectRoot: root }, runtime(root));
    expect(listed.exitCode).toBe(2);
    expect(
      listed.body.contracts.filter((entry) => entry.contractId === "account.profile"),
    ).toHaveLength(2);
    expect(listed.body.contracts.filter((entry) => entry.status === "invalid")).toHaveLength(3);
    expect(listed.body.contracts.map((entry) => entry.contractPath)).toEqual(
      expect.arrayContaining([
        ".framelia/contracts/account.profile/visual-contract.json",
        ".framelia/contracts/duplicate/visual-contract.json",
        ".framelia/contracts/malformed/visual-contract.json",
      ]),
    );
  });

  it("returns a structured project-root error instead of throwing before list output", async () => {
    const root = temporaryProject();
    fs.writeFileSync(path.join(root, "framelia.config.ts"), "export default {};\n");

    await expect(contractListCommand({ projectRoot: root }, runtime(root))).resolves.toMatchObject({
      exitCode: 2,
      body: {
        kind: "framelia.contract-list-outcome",
        executionState: "error",
        diagnostics: [{ code: "MULTIPLE_PROJECT_CONFIGS" }],
      },
    });
  });
});
