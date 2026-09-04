import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { UsageError } from "../src/exit.ts";
import {
  contractCreateCommand,
  type ContractCreateOptions,
} from "../src/internal/contract-create.ts";
import {
  nonInteractivePrompts,
  PROMPT_CANCELLED,
  type PromptAdapter,
  type PromptResult,
} from "../src/internal/prompts.ts";
import type { CliRuntime } from "../src/runtime-types.ts";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function fakeRuntime(overrides: Partial<CliRuntime> = {}): CliRuntime {
  return {
    cwd: () => "/project",
    env: {},
    stdin: process.stdin,
    stdout: { write: vi.fn<(text: string) => void>() },
    stderr: { write: vi.fn<(text: string) => void>() },
    exitCode: undefined,
    ...overrides,
  };
}

function baseOptions(overrides: Partial<ContractCreateOptions> = {}): ContractCreateOptions {
  return {
    projectRoot: undefined,
    output: undefined,
    force: undefined,
    targetUrl: undefined,
    contractId: undefined,
    name: undefined,
    fileKey: undefined,
    nodeId: undefined,
    viewport: undefined,
    viewportName: undefined,
    viewportWidth: undefined,
    viewportHeight: undefined,
    scope: undefined,
    pageReason: undefined,
    styleCheckSelector: undefined,
    styleCheckNodeId: undefined,
    selector: undefined,
    regionWidth: undefined,
    regionHeight: undefined,
    ...overrides,
  };
}

describe("contractCreateCommand: non-interactive (every flag supplied)", () => {
  it("skips prompts entirely and writes the contract when every flag is supplied", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-contract-create-"));
    temporaryDirectories.push(directory);

    await contractCreateCommand(
      baseOptions({
        projectRoot: directory,
        output: ".framelia/visual-verifications/login/visual-contract.json",
        targetUrl: "http://localhost:8888/login",
        contractId: "login.desktop",
        name: "Desktop",
        fileKey: "abc123",
        nodeId: "1037:71575",
        viewport: "desktop",
        scope: "page",
        pageReason: "Baseline node represents complete page.",
      }),
      nonInteractivePrompts,
      fakeRuntime(),
    );

    const written = JSON.parse(
      fs.readFileSync(
        path.join(directory, ".framelia/visual-verifications/login/visual-contract.json"),
        "utf8",
      ),
    );
    expect(written).toMatchObject({
      target: { url: "http://localhost:8888/login" },
      contracts: [{ id: "login.desktop", baseline: { fileKey: "abc123", nodeId: "1037:71575" } }],
    });
  });

  it("writes to --output even when it diverges from the derived default path", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-contract-create-"));
    temporaryDirectories.push(directory);

    await contractCreateCommand(
      baseOptions({
        projectRoot: directory,
        output: "custom/path/mycontract.json",
        targetUrl: "http://localhost:8888/login",
        contractId: "login.desktop",
        name: "Desktop",
        fileKey: "abc123",
        nodeId: "1037:71575",
        viewport: "desktop",
        scope: "page",
        pageReason: "Baseline node represents complete page.",
      }),
      nonInteractivePrompts,
      fakeRuntime(),
    );

    expect(fs.existsSync(path.join(directory, "custom/path/mycontract.json"))).toBe(true);
    expect(
      fs.existsSync(
        path.join(directory, ".framelia/visual-verifications/login/visual-contract.json"),
      ),
    ).toBe(false);
  });

  it("builds one style check-point from flags on a page-scope contract, no prompt needed", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-contract-create-"));
    temporaryDirectories.push(directory);

    await contractCreateCommand(
      baseOptions({
        projectRoot: directory,
        output: ".framelia/visual-verifications/home/visual-contract.json",
        targetUrl: "http://localhost:8888/home",
        contractId: "home.desktop",
        name: "Desktop",
        fileKey: "abc123",
        nodeId: "1037:71575",
        viewport: "desktop",
        scope: "page",
        pageReason: "Baseline node represents complete page.",
        styleCheckSelector: "[data-testid=hero-heading]",
        styleCheckNodeId: "200:10",
      }),
      nonInteractivePrompts,
      fakeRuntime(),
    );

    const written = JSON.parse(
      fs.readFileSync(
        path.join(directory, ".framelia/visual-verifications/home/visual-contract.json"),
        "utf8",
      ),
    );
    expect(written.contracts[0].scope).toMatchObject({
      kind: "page",
      styleChecks: [{ selector: "[data-testid=hero-heading]", nodeId: "200:10" }],
    });
  });

  it("rejects a lone --style-check-selector without its paired --style-check-node-id", async () => {
    await expect(
      contractCreateCommand(
        baseOptions({
          projectRoot: os.tmpdir(),
          targetUrl: "http://localhost:8888/home",
          contractId: "home.desktop",
          name: "Desktop",
          fileKey: "abc123",
          nodeId: "1037:71575",
          viewport: "desktop",
          scope: "page",
          pageReason: "Baseline node represents complete page.",
          styleCheckSelector: "[data-testid=hero-heading]",
        }),
        nonInteractivePrompts,
        fakeRuntime(),
      ),
    ).rejects.toThrow(
      /--style-check-selector and --style-check-node-id must be supplied together\./,
    );
  });

  it("rejects an empty --style-check-selector as a usage error, not a raw schema failure", async () => {
    await expect(
      contractCreateCommand(
        baseOptions({
          projectRoot: os.tmpdir(),
          targetUrl: "http://localhost:8888/home",
          contractId: "home.desktop",
          name: "Desktop",
          fileKey: "abc123",
          nodeId: "1037:71575",
          viewport: "desktop",
          scope: "page",
          pageReason: "Baseline node represents complete page.",
          styleCheckSelector: "",
          styleCheckNodeId: "200:10",
        }),
        nonInteractivePrompts,
        fakeRuntime(),
      ),
    ).rejects.toThrow(/--style-check-selector: Enter a CSS selector\./);
  });

  it("rejects style-check flags on a region-scope contract instead of silently dropping them", async () => {
    await expect(
      contractCreateCommand(
        baseOptions({
          projectRoot: os.tmpdir(),
          targetUrl: "http://localhost:8888/login",
          contractId: "login.desktop",
          name: "Desktop",
          fileKey: "abc123",
          nodeId: "1037:71575",
          viewport: "desktop",
          scope: "region",
          selector: "[data-testid=card]",
          regionWidth: 320,
          regionHeight: 240,
          styleCheckSelector: "[data-testid=hero-heading]",
          styleCheckNodeId: "200:10",
        }),
        nonInteractivePrompts,
        fakeRuntime(),
      ),
    ).rejects.toThrow(/--style-check-selector.*--scope page/);
  });

  it("rejects an invalid --target-url without launching an interactive prompt", async () => {
    await expect(
      contractCreateCommand(
        baseOptions({
          projectRoot: os.tmpdir(),
          targetUrl: "not-a-url",
          contractId: "login.desktop",
          fileKey: "abc123",
          nodeId: "1037:71575",
          viewport: "desktop",
          scope: "page",
          pageReason: "Baseline node represents complete page.",
        }),
        nonInteractivePrompts,
        fakeRuntime(),
      ),
    ).rejects.toThrow(UsageError);
  });

  it("rejects --viewport-width without its paired --viewport-height before any prompt (deliberate new pairing rule -- see internal/contract-create.ts)", async () => {
    await expect(
      contractCreateCommand(
        baseOptions({
          projectRoot: os.tmpdir(),
          targetUrl: "http://localhost:8888/login",
          contractId: "login.desktop",
          name: "Desktop",
          fileKey: "abc123",
          nodeId: "1037:71575",
          viewport: "custom",
          viewportName: "tablet",
          viewportWidth: 834,
          scope: "page",
          pageReason: "Baseline node represents complete page.",
        }),
        nonInteractivePrompts,
        fakeRuntime(),
      ),
    ).rejects.toThrow(/--viewport-width and --viewport-height must be supplied together\./);
  });

  it("rejects custom viewport flags for a named viewport preset", async () => {
    await expect(
      contractCreateCommand(
        baseOptions({
          projectRoot: os.tmpdir(),
          targetUrl: "http://localhost:8888/login",
          contractId: "login.desktop",
          name: "Desktop",
          fileKey: "abc123",
          nodeId: "1037:71575",
          viewport: "desktop",
          viewportName: "wide",
          viewportWidth: 1920,
          viewportHeight: 1080,
          scope: "page",
          pageReason: "Baseline node represents complete page.",
        }),
        nonInteractivePrompts,
        fakeRuntime(),
      ),
    ).rejects.toThrow(/require --viewport custom/);
  });

  it("rejects region flags for a page scope", async () => {
    await expect(
      contractCreateCommand(
        baseOptions({
          projectRoot: os.tmpdir(),
          targetUrl: "http://localhost:8888/login",
          contractId: "login.desktop",
          name: "Desktop",
          fileKey: "abc123",
          nodeId: "1037:71575",
          viewport: "desktop",
          scope: "page",
          pageReason: "Baseline node represents complete page.",
          selector: "[data-testid=card]",
          regionWidth: 320,
          regionHeight: 240,
        }),
        nonInteractivePrompts,
        fakeRuntime(),
      ),
    ).rejects.toThrow(/require --scope region/);
  });
});

describe("schema --target contract", () => {
  it("reflects the page scope's styleChecks shape", () => {
    const result = spawnSync(
      process.execPath,
      [path.join(packageRoot, "bin", "framelia.js"), "schema", "--target", "contract"],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(0);
    const schema = JSON.parse(result.stdout);
    expect(JSON.stringify(schema)).toContain("styleChecks");
  });
});

function scriptedPrompts(answers: string[]): {
  adapter: PromptAdapter;
  warnings: string[];
  cancelCalls: string[];
} {
  let index = 0;
  const warnings: string[] = [];
  const cancelCalls: string[] = [];
  const next = (): PromptResult<string> =>
    index < answers.length ? answers[index++]! : PROMPT_CANCELLED;
  const adapter: PromptAdapter = {
    interactive: true,
    text: async () => next(),
    select: async <T extends string>() => {
      const answer = next();
      return answer === PROMPT_CANCELLED ? answer : (answer as T);
    },
    confirm: async () => PROMPT_CANCELLED,
    cancel: (message) => cancelCalls.push(message),
    intro: () => undefined,
    outro: () => undefined,
    note: () => undefined,
    warn: (message) => warnings.push(message),
  };
  return { adapter, warnings, cancelCalls };
}

describe("contractCreateCommand (scripted prompt adapter)", () => {
  it("walks the custom-viewport and region-scope branches end to end", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-contract-prompt-"));
    temporaryDirectories.push(directory);
    const runtime = fakeRuntime({ cwd: () => directory, env: {} });

    const { adapter, warnings } = scriptedPrompts([
      "http://127.0.0.1:3000/login",
      "login.tablet",
      "Login · Tablet",
      "abc123",
      "153:5181",
      "custom",
      "tablet",
      "834",
      "1194",
      "region",
      "[data-testid=card]",
      "320",
      "240",
    ]);

    await contractCreateCommand(baseOptions({ projectRoot: directory }), adapter, runtime);

    const written = JSON.parse(
      fs.readFileSync(
        path.join(directory, ".framelia/visual-verifications/login/visual-contract.json"),
        "utf8",
      ),
    );
    expect(written).toMatchObject({
      target: { url: "http://127.0.0.1:3000/login" },
      contracts: [
        {
          id: "login.tablet",
          viewport: { preset: "tablet", width: 834, height: 1194 },
          scope: { kind: "region", selector: "[data-testid=card]" },
        },
      ],
    });
    expect(warnings).toEqual(["Skipping expected-style bake-in: FIGMA_ACCESS_TOKEN is not set."]);
  });

  it("returns one cancellation result without mutating the runtime", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-contract-prompt-"));
    temporaryDirectories.push(directory);
    const runtime = fakeRuntime({ cwd: () => directory });
    const { adapter, cancelCalls } = scriptedPrompts([]);

    const result = await contractCreateCommand(
      baseOptions({ projectRoot: directory }),
      adapter,
      runtime,
    );

    expect(result).toEqual({ ok: false, body: { cancelled: true } });
    expect(cancelCalls).toEqual(["Setup cancelled."]);
    expect(runtime.exitCode).toBeUndefined();
    expect(fs.existsSync(path.join(directory, ".framelia/visual-verifications"))).toBe(false);
  });

  it("resolves prompt-driven fields around flag overrides", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-contract-prompt-"));
    temporaryDirectories.push(directory);
    const runtime = fakeRuntime({ cwd: () => directory });
    const { adapter } = scriptedPrompts([
      "desktop",
      "page",
      "Baseline node represents complete page.",
      "done",
    ]);

    await contractCreateCommand(
      baseOptions({
        projectRoot: directory,
        targetUrl: "http://127.0.0.1:3000/login",
        contractId: "login.desktop",
        name: "Desktop",
        fileKey: "abc123",
        nodeId: "153:5181",
      }),
      adapter,
      runtime,
    );

    const written = JSON.parse(
      fs.readFileSync(
        path.join(directory, ".framelia/visual-verifications/login/visual-contract.json"),
        "utf8",
      ),
    );
    expect(written.contracts[0]).toMatchObject({
      id: "login.desktop",
      viewport: { preset: "desktop", width: 1440, height: 1024 },
      scope: { kind: "page" },
    });
    expect(written.contracts[0].scope).not.toHaveProperty("styleChecks");
  });

  it("still offers the style check-point loop when --page-reason is a flag but other fields are still prompted", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-contract-prompt-"));
    temporaryDirectories.push(directory);
    const runtime = fakeRuntime({ cwd: () => directory });
    const { adapter } = scriptedPrompts(["desktop", "page", "done"]);

    await contractCreateCommand(
      baseOptions({
        projectRoot: directory,
        targetUrl: "http://127.0.0.1:3000/login",
        contractId: "login.desktop",
        name: "Desktop",
        fileKey: "abc123",
        nodeId: "153:5181",
        pageReason: "Baseline node represents complete page.",
      }),
      adapter,
      runtime,
    );

    const written = JSON.parse(
      fs.readFileSync(
        path.join(directory, ".framelia/visual-verifications/login/visual-contract.json"),
        "utf8",
      ),
    );
    expect(written.contracts[0].scope).toMatchObject({ kind: "page" });
    expect(written.contracts[0].scope).not.toHaveProperty("styleChecks");
  });

  it("skips the style check-point loop only when the entire invocation is flag-driven", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-contract-prompt-"));
    temporaryDirectories.push(directory);
    const runtime = fakeRuntime({ cwd: () => directory });
    const { adapter } = scriptedPrompts([]);

    await contractCreateCommand(
      baseOptions({
        projectRoot: directory,
        targetUrl: "http://127.0.0.1:3000/login",
        contractId: "login.desktop",
        name: "Desktop",
        fileKey: "abc123",
        nodeId: "153:5181",
        viewport: "desktop",
        scope: "page",
        pageReason: "Baseline node represents complete page.",
      }),
      adapter,
      runtime,
    );

    const written = JSON.parse(
      fs.readFileSync(
        path.join(directory, ".framelia/visual-verifications/login/visual-contract.json"),
        "utf8",
      ),
    );
    expect(written.contracts[0].scope).toMatchObject({ kind: "page" });
    expect(written.contracts[0].scope).not.toHaveProperty("styleChecks");
  });

  it("collects a single page style check-point through the interactive loop", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-contract-prompt-"));
    temporaryDirectories.push(directory);
    const runtime = fakeRuntime({ cwd: () => directory, env: {} });

    const { adapter, warnings } = scriptedPrompts([
      "http://127.0.0.1:3000/home",
      "home.desktop",
      "Desktop",
      "abc123",
      "153:5181",
      "desktop",
      "page",
      "Baseline node represents complete home page.",
      "add",
      "[data-testid=hero-heading]",
      "200:10",
      "done",
    ]);

    await contractCreateCommand(baseOptions({ projectRoot: directory }), adapter, runtime);

    const written = JSON.parse(
      fs.readFileSync(
        path.join(directory, ".framelia/visual-verifications/home/visual-contract.json"),
        "utf8",
      ),
    );
    expect(written.contracts[0].scope).toMatchObject({
      kind: "page",
      styleChecks: [{ selector: "[data-testid=hero-heading]", nodeId: "200:10" }],
    });
    expect(warnings).toEqual(["Skipping expected-style bake-in: FIGMA_ACCESS_TOKEN is not set."]);
  });

  it("collects multiple page style check-points through the interactive loop", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-contract-prompt-"));
    temporaryDirectories.push(directory);
    const runtime = fakeRuntime({ cwd: () => directory });

    const { adapter } = scriptedPrompts([
      "http://127.0.0.1:3000/home",
      "home.desktop",
      "Desktop",
      "abc123",
      "153:5181",
      "desktop",
      "page",
      "Baseline node represents complete home page.",
      "add",
      "[data-testid=hero-heading]",
      "200:10",
      "add",
      "[data-testid=cta-button]",
      "200:11",
      "done",
    ]);

    await contractCreateCommand(baseOptions({ projectRoot: directory }), adapter, runtime);

    const written = JSON.parse(
      fs.readFileSync(
        path.join(directory, ".framelia/visual-verifications/home/visual-contract.json"),
        "utf8",
      ),
    );
    expect(written.contracts[0].scope.styleChecks).toEqual([
      { selector: "[data-testid=hero-heading]", nodeId: "200:10" },
      { selector: "[data-testid=cta-button]", nodeId: "200:11" },
    ]);
  });
});
