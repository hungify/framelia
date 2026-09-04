import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { UsageError } from "../src/errors.ts";
import {
  contractCreateCommand,
  type ContractCreateOptions,
  type PromptAdapter,
} from "../src/internal/contract-create.ts";
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
    outputPath: undefined,
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

/** Proves a test path never launches an interactive prompt -- every method throws. */
const noPrompts: PromptAdapter = {
  text: () => {
    throw new Error("unexpected prompt: text");
  },
  select: () => {
    throw new Error("unexpected prompt: select");
  },
  cancel: () => {
    throw new Error("unexpected prompt: cancel");
  },
  isCancel: () => false,
  intro: () => undefined,
  outro: () => undefined,
  warn: () => undefined,
};

describe("contractCreateCommand: non-interactive (every flag supplied)", () => {
  it("skips prompts entirely and writes the contract when every flag is supplied", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-contract-create-"));
    temporaryDirectories.push(directory);

    await contractCreateCommand(
      baseOptions({
        projectRoot: directory,
        outputPath: ".framelia/visual-verifications/login/visual-contract.json",
        targetUrl: "http://localhost:8888/login",
        contractId: "login.desktop",
        name: "Desktop",
        fileKey: "abc123",
        nodeId: "1037:71575",
        viewport: "desktop",
        scope: "page",
        pageReason: "Baseline node represents complete page.",
      }),
      fakeRuntime(),
      noPrompts,
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
        outputPath: "custom/path/mycontract.json",
        targetUrl: "http://localhost:8888/login",
        contractId: "login.desktop",
        name: "Desktop",
        fileKey: "abc123",
        nodeId: "1037:71575",
        viewport: "desktop",
        scope: "page",
        pageReason: "Baseline node represents complete page.",
      }),
      fakeRuntime(),
      noPrompts,
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
        outputPath: ".framelia/visual-verifications/home/visual-contract.json",
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
      fakeRuntime(),
      noPrompts,
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
        fakeRuntime(),
        noPrompts,
      ),
    ).rejects.toThrow(
      /--style-check-selector and --style-check-node-id must be supplied together\./,
    );
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
        fakeRuntime(),
        noPrompts,
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
        fakeRuntime(),
        noPrompts,
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
        fakeRuntime(),
        noPrompts,
      ),
    ).rejects.toThrow(/--viewport-width and --viewport-height must be supplied together\./);
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

/** Scripts a PromptAdapter from a queue of answers; running past the end of the queue cancels. */
const PROMPT_CANCEL = Symbol("prompt-cancelled");
function scriptedPrompts(answers: unknown[]): {
  adapter: PromptAdapter;
  warnings: string[];
  cancelCalls: string[];
} {
  let index = 0;
  const warnings: string[] = [];
  const cancelCalls: string[] = [];
  const next = () => (index < answers.length ? answers[index++] : PROMPT_CANCEL);
  const adapter: PromptAdapter = {
    text: async () => next() as never,
    select: async () => next() as never,
    isCancel: (value) => value === PROMPT_CANCEL,
    cancel: (message) => cancelCalls.push(message),
    intro: () => undefined,
    outro: () => undefined,
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
      "http://127.0.0.1:3000/login", // target URL
      "login.tablet", // contract ID
      "Login · Tablet", // display name
      "abc123", // Figma file key
      "153:5181", // Figma node ID
      "custom", // viewport preset
      "tablet", // custom viewport name
      "834", // custom viewport width
      "1194", // custom viewport height
      "region", // capture scope
      "[data-testid=card]", // selector
      "320", // region width
      "240", // region height
    ]);

    await contractCreateCommand(baseOptions({ projectRoot: directory }), runtime, adapter);

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
    // No Figma token in the fake runtime's env, so the expectStyle bake-in is skipped, not attempted.
    expect(warnings).toEqual([
      "Skipping expected-style bake-in: contract create skipped: no Figma token to fetch the expected component style.",
    ]);
  });

  it("stops and cancels on the first unanswered prompt, setting runtime.exitCode (not global process.exitCode)", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-contract-prompt-"));
    temporaryDirectories.push(directory);
    const runtime = fakeRuntime({ cwd: () => directory });
    const { adapter, cancelCalls } = scriptedPrompts([]); // cancel immediately

    await contractCreateCommand(baseOptions({ projectRoot: directory }), runtime, adapter);

    expect(cancelCalls).toEqual(["Setup cancelled."]);
    expect(runtime.exitCode).toBe(1);
    expect(fs.existsSync(path.join(directory, ".framelia/visual-verifications"))).toBe(false);
  });

  it("resolves prompt-driven fields around flag overrides", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-contract-prompt-"));
    temporaryDirectories.push(directory);
    const runtime = fakeRuntime({ cwd: () => directory });
    const { adapter } = scriptedPrompts([
      "desktop", // viewport preset (only remaining prompt)
      "page", // capture scope
      "Baseline node represents complete page.", // page reason
      "done", // style check-point loop: skip, page reason came from a prompt so the loop still runs
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
      runtime,
      adapter,
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
    // Regression guard: gating the loop on --page-reason's own presence broke as soon as
    // a *different* field (viewport here) was left interactive in the same run -- the loop
    // must key off whether this session prompted for anything at all, not one flag.
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-contract-prompt-"));
    temporaryDirectories.push(directory);
    const runtime = fakeRuntime({ cwd: () => directory });
    const { adapter } = scriptedPrompts([
      "desktop", // viewport preset -- prompted, makes this an interactive session
      "page", // capture scope
      "done", // style check-point loop: still offered, user skips
    ]);

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
      runtime,
      adapter,
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
    // Nothing left to prompt for -- an empty queue proves zero prompts fire.
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
      runtime,
      adapter,
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
      "Desktop", // display name
      "abc123",
      "153:5181",
      "desktop", // viewport preset
      "page", // capture scope
      "Baseline node represents complete home page.", // page reason
      "add", // style check-point loop: add one
      "[data-testid=hero-heading]", // check-point selector
      "200:10", // check-point Figma node ID
      "done", // style check-point loop: stop
    ]);

    await contractCreateCommand(baseOptions({ projectRoot: directory }), runtime, adapter);

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
    // No Figma token in the fake runtime's env, so the per-check-point expectStyle bake-in is
    // skipped, not attempted -- same never-blocks handling as the region-scope bake-in.
    expect(warnings).toEqual([
      "Skipping expected-style bake-in: contract create skipped: no Figma token to fetch the expected style for this check-point.",
    ]);
  });

  it("collects multiple page style check-points through the interactive loop", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-contract-prompt-"));
    temporaryDirectories.push(directory);
    const runtime = fakeRuntime({ cwd: () => directory });

    const { adapter } = scriptedPrompts([
      "http://127.0.0.1:3000/home",
      "home.desktop",
      "Desktop", // display name
      "abc123",
      "153:5181",
      "desktop",
      "page",
      "Baseline node represents complete home page.",
      "add",
      "[data-testid=hero-heading]",
      "200:10",
      "add", // loop back around for a second check-point
      "[data-testid=cta-button]",
      "200:11",
      "done",
    ]);

    await contractCreateCommand(baseOptions({ projectRoot: directory }), runtime, adapter);

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
