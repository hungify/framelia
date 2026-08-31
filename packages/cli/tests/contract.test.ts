import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createContractRequest,
  runCreateContract,
  writeContractRequest,
  type PromptAdapter,
} from "../src/contract.ts";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("contract scaffold", () => {
  it("creates a schema-valid Figma page contract", () => {
    const request = createContractRequest({
      targetUrl: "http://127.0.0.1:3000/login",
      contractId: "login.desktop",
      baseline: { kind: "figma", fileKey: "abc123", nodeId: "153:5181" },
      viewport: { name: "desktop", width: 1440, height: 1024 },
      scope: { kind: "page", pageReason: "Complete login page." },
    });

    expect(request).toMatchObject({
      schemaVersion: 4,
      target: { kind: "web", url: "http://127.0.0.1:3000/login" },
      contracts: [{ id: "login.desktop", outDir: ".framelia/visual-verifications/login/desktop" }],
    });
  });

  it("writes nested output and refuses accidental overwrite", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-init-"));
    temporaryDirectories.push(directory);
    const outputPath = path.join(directory, ".framelia", "visual-contract.json");
    const request = createContractRequest({
      targetUrl: "https://preview.example.com/card",
      contractId: "card.mobile",
      baseline: { kind: "figma", fileKey: "abc123", nodeId: "153:5181" },
      viewport: { name: "mobile", width: 390, height: 844 },
      scope: {
        kind: "region",
        selector: "[data-testid=card]",
        expectSize: { width: 320, height: 240 },
      },
    });

    expect(writeContractRequest(outputPath, request)).toBe("created");

    expect(JSON.parse(fs.readFileSync(outputPath, "utf8"))).toMatchObject({
      contracts: [{ profile: "component/strict" }],
    });
    expect(() => writeContractRequest(outputPath, request)).toThrow(
      'Refusing to replace existing contract "card.mobile"',
    );
    expect(writeContractRequest(outputPath, request, true)).toBe("replaced");
  });

  it("adds a second contract to an existing file without needing --force", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-init-"));
    temporaryDirectories.push(directory);
    const outputPath = path.join(directory, ".framelia", "visual-contract.json");
    const desktop = createContractRequest({
      targetUrl: "https://preview.example.com/card",
      contractId: "card.desktop",
      baseline: { kind: "figma", fileKey: "abc123", nodeId: "153:5181" },
      viewport: { name: "desktop", width: 1440, height: 1024 },
      scope: { kind: "page", pageReason: "Complete card page." },
    });
    const mobile = createContractRequest({
      targetUrl: "https://preview.example.com/card",
      contractId: "card.mobile",
      baseline: { kind: "figma", fileKey: "abc123", nodeId: "153:5182" },
      viewport: { name: "mobile", width: 390, height: 844 },
      scope: { kind: "page", pageReason: "Complete card page." },
    });

    expect(writeContractRequest(outputPath, desktop)).toBe("created");
    expect(writeContractRequest(outputPath, mobile)).toBe("added");

    expect(JSON.parse(fs.readFileSync(outputPath, "utf8"))).toMatchObject({
      contracts: [{ id: "card.desktop" }, { id: "card.mobile" }],
    });
  });

  it("replaces one contract by id with --force while leaving its siblings untouched", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-init-"));
    temporaryDirectories.push(directory);
    const outputPath = path.join(directory, ".framelia", "visual-contract.json");
    const desktop = createContractRequest({
      targetUrl: "https://preview.example.com/card",
      contractId: "card.desktop",
      baseline: { kind: "figma", fileKey: "abc123", nodeId: "153:5181" },
      viewport: { name: "desktop", width: 1440, height: 1024 },
      scope: { kind: "page", pageReason: "Complete card page." },
    });
    const mobile = createContractRequest({
      targetUrl: "https://preview.example.com/card",
      contractId: "card.mobile",
      baseline: { kind: "figma", fileKey: "abc123", nodeId: "153:5182" },
      viewport: { name: "mobile", width: 390, height: 844 },
      scope: { kind: "page", pageReason: "Complete card page." },
    });
    const updatedDesktop = createContractRequest({
      targetUrl: "https://preview.example.com/card",
      contractId: "card.desktop",
      baseline: { kind: "figma", fileKey: "abc123", nodeId: "999:9999" },
      viewport: { name: "desktop", width: 1920, height: 1080 },
      scope: { kind: "page", pageReason: "Complete card page, redesigned." },
    });

    writeContractRequest(outputPath, desktop);
    writeContractRequest(outputPath, mobile);
    expect(writeContractRequest(outputPath, updatedDesktop, true)).toBe("replaced");

    expect(JSON.parse(fs.readFileSync(outputPath, "utf8"))).toMatchObject({
      contracts: [
        { id: "card.desktop", viewport: { width: 1920, height: 1080 } },
        { id: "card.mobile", viewport: { width: 390, height: 844 } },
      ],
    });
  });

  it("refuses to merge a contract whose target.url differs from the file's existing one", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-init-"));
    temporaryDirectories.push(directory);
    const outputPath = path.join(directory, ".framelia", "visual-contract.json");
    const desktop = createContractRequest({
      targetUrl: "https://preview.example.com/card",
      contractId: "card.desktop",
      baseline: { kind: "figma", fileKey: "abc123", nodeId: "153:5181" },
      viewport: { name: "desktop", width: 1440, height: 1024 },
      scope: { kind: "page", pageReason: "Complete card page." },
    });
    const otherPage = createContractRequest({
      targetUrl: "https://preview.example.com/other",
      contractId: "card.mobile",
      baseline: { kind: "figma", fileKey: "abc123", nodeId: "153:5182" },
      viewport: { name: "mobile", width: 390, height: 844 },
      scope: { kind: "page", pageReason: "Complete card page." },
    });

    writeContractRequest(outputPath, desktop);
    expect(() => writeContractRequest(outputPath, otherPage)).toThrow("shares a single target.url");
    expect(() => writeContractRequest(outputPath, otherPage, true)).toThrow(
      "shares a single target.url",
    );
  });

  it("reports the target.url mismatch even when replacing an existing id without --force", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-init-"));
    temporaryDirectories.push(directory);
    const outputPath = path.join(directory, ".framelia", "visual-contract.json");
    const desktop = createContractRequest({
      targetUrl: "https://preview.example.com/card",
      contractId: "card.desktop",
      baseline: { kind: "figma", fileKey: "abc123", nodeId: "153:5181" },
      viewport: { name: "desktop", width: 1440, height: 1024 },
      scope: { kind: "page", pageReason: "Complete card page." },
    });
    const sameIdOtherUrl = createContractRequest({
      targetUrl: "https://preview.example.com/other",
      contractId: "card.desktop",
      baseline: { kind: "figma", fileKey: "abc123", nodeId: "999:9999" },
      viewport: { name: "desktop", width: 1920, height: 1080 },
      scope: { kind: "page", pageReason: "Complete card page, redesigned." },
    });

    writeContractRequest(outputPath, desktop);
    expect(() => writeContractRequest(outputPath, sameIdOtherUrl)).toThrow(
      "shares a single target.url",
    );
  });

  it("rejects a request carrying more than one contract instead of silently dropping the rest", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-init-"));
    temporaryDirectories.push(directory);
    const outputPath = path.join(directory, ".framelia", "visual-contract.json");
    const desktop = createContractRequest({
      targetUrl: "https://preview.example.com/card",
      contractId: "card.desktop",
      baseline: { kind: "figma", fileKey: "abc123", nodeId: "153:5181" },
      viewport: { name: "desktop", width: 1440, height: 1024 },
      scope: { kind: "page", pageReason: "Complete card page." },
    });
    const mobile = createContractRequest({
      targetUrl: "https://preview.example.com/card",
      contractId: "card.mobile",
      baseline: { kind: "figma", fileKey: "abc123", nodeId: "153:5182" },
      viewport: { name: "mobile", width: 390, height: 844 },
      scope: { kind: "page", pageReason: "Complete card page." },
    });
    const both = { ...desktop, contracts: [...desktop.contracts, ...mobile.contracts] };

    expect(() => writeContractRequest(outputPath, both)).toThrow(
      "expects exactly one contract per request",
    );
    expect(fs.existsSync(outputPath)).toBe(false);
  });

  it("accepts a page contract with one or more style check-points", () => {
    const request = createContractRequest({
      targetUrl: "http://127.0.0.1:3000/home",
      contractId: "home.desktop",
      baseline: { kind: "figma", fileKey: "abc123", nodeId: "153:5181" },
      viewport: { name: "desktop", width: 1440, height: 1024 },
      scope: {
        kind: "page",
        pageReason: "Baseline node represents complete home page.",
        styleChecks: [
          { selector: "[data-testid=hero-heading]", nodeId: "200:10" },
          { selector: "[data-testid=cta-button]", nodeId: "200:11" },
        ],
      },
    });

    expect(request.contracts[0]?.scope).toMatchObject({
      styleChecks: [
        { selector: "[data-testid=hero-heading]", nodeId: "200:10" },
        { selector: "[data-testid=cta-button]", nodeId: "200:11" },
      ],
    });
  });

  it("accepts a page contract with no style check-points, unchanged from before styleChecks existed", () => {
    const request = createContractRequest({
      targetUrl: "http://127.0.0.1:3000/home",
      contractId: "home.desktop",
      baseline: { kind: "figma", fileKey: "abc123", nodeId: "153:5181" },
      viewport: { name: "desktop", width: 1440, height: 1024 },
      scope: { kind: "page", pageReason: "Baseline node represents complete home page." },
    });

    expect(request.contracts[0]?.scope).not.toHaveProperty("styleChecks");
  });

  it("accepts a region contract with expectStyle baked in from Figma", () => {
    const request = createContractRequest({
      targetUrl: "http://127.0.0.1:3000/login",
      contractId: "login.form.desktop",
      baseline: { kind: "figma", fileKey: "abc123", nodeId: "153:5181" },
      viewport: { name: "desktop", width: 1440, height: 1024 },
      scope: {
        kind: "region",
        selector: "[data-testid=login-form]",
        expectSize: { width: 480, height: 560 },
        expectStyle: {
          fontWeight: 500,
          fontSizePx: 16,
          color: { r: 17, g: 17, b: 17, a: 1 },
          colorProperty: "color",
        },
      },
    });

    expect(request.contracts[0]?.scope).toMatchObject({
      expectStyle: { fontWeight: 500, fontSizePx: 16 },
    });
  });
});

describe("contract create --target-url and friends (non-interactive)", () => {
  it("skips prompts entirely and writes the contract when every flag is supplied", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-contract-create-"));
    temporaryDirectories.push(directory);

    const result = spawnSync(
      process.execPath,
      [
        path.join(packageRoot, "bin", "framelia.js"),
        "contract",
        "create",
        "--project-root",
        directory,
        "--output",
        ".framelia/visual-verifications/login/visual-contract.json",
        "--target-url",
        "http://localhost:8888/login",
        "--contract-id",
        "login.desktop",
        "--file-key",
        "abc123",
        "--node-id",
        "1037:71575",
        "--viewport",
        "desktop",
        "--scope",
        "page",
        "--page-reason",
        "Baseline node represents complete page.",
      ],
      { encoding: "utf8", env: { ...process.env, FIGMA_ACCESS_TOKEN: "" } },
    );

    expect(result.status).toBe(0);
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

  it("writes to --output even when it diverges from the derived default path", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-contract-create-"));
    temporaryDirectories.push(directory);

    const result = spawnSync(
      process.execPath,
      [
        path.join(packageRoot, "bin", "framelia.js"),
        "contract",
        "create",
        "--project-root",
        directory,
        "--output",
        "custom/path/mycontract.json",
        "--target-url",
        "http://localhost:8888/login",
        "--contract-id",
        "login.desktop",
        "--file-key",
        "abc123",
        "--node-id",
        "1037:71575",
        "--viewport",
        "desktop",
        "--scope",
        "page",
        "--page-reason",
        "Baseline node represents complete page.",
      ],
      { encoding: "utf8", env: { ...process.env, FIGMA_ACCESS_TOKEN: "" } },
    );

    expect(result.status).toBe(0);
    expect(fs.existsSync(path.join(directory, "custom/path/mycontract.json"))).toBe(true);
    expect(
      fs.existsSync(
        path.join(directory, ".framelia/visual-verifications/login/visual-contract.json"),
      ),
    ).toBe(false);
  });

  it("builds one style check-point from flags on a page-scope contract, no prompt needed", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-contract-create-"));
    temporaryDirectories.push(directory);

    const result = spawnSync(
      process.execPath,
      [
        path.join(packageRoot, "bin", "framelia.js"),
        "contract",
        "create",
        "--project-root",
        directory,
        "--output",
        ".framelia/visual-verifications/home/visual-contract.json",
        "--target-url",
        "http://localhost:8888/home",
        "--contract-id",
        "home.desktop",
        "--file-key",
        "abc123",
        "--node-id",
        "1037:71575",
        "--viewport",
        "desktop",
        "--scope",
        "page",
        "--page-reason",
        "Baseline node represents complete page.",
        "--style-check-selector",
        "[data-testid=hero-heading]",
        "--style-check-node-id",
        "200:10",
      ],
      { encoding: "utf8", env: { ...process.env, FIGMA_ACCESS_TOKEN: "" } },
    );

    expect(result.status).toBe(0);
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

  it("rejects a lone --style-check-selector without its paired --style-check-node-id", () => {
    const result = spawnSync(
      process.execPath,
      [
        path.join(packageRoot, "bin", "framelia.js"),
        "contract",
        "create",
        "--project-root",
        os.tmpdir(),
        "--target-url",
        "http://localhost:8888/home",
        "--contract-id",
        "home.desktop",
        "--file-key",
        "abc123",
        "--node-id",
        "1037:71575",
        "--viewport",
        "desktop",
        "--scope",
        "page",
        "--page-reason",
        "Baseline node represents complete page.",
        "--style-check-selector",
        "[data-testid=hero-heading]",
      ],
      { encoding: "utf8" },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr + result.stdout).toContain(
      "--style-check-selector and --style-check-node-id must be supplied together.",
    );
  });

  it("rejects style-check flags on a region-scope contract instead of silently dropping them", () => {
    const result = spawnSync(
      process.execPath,
      [
        path.join(packageRoot, "bin", "framelia.js"),
        "contract",
        "create",
        "--project-root",
        os.tmpdir(),
        "--target-url",
        "http://localhost:8888/login",
        "--contract-id",
        "login.desktop",
        "--file-key",
        "abc123",
        "--node-id",
        "1037:71575",
        "--viewport",
        "desktop",
        "--scope",
        "region",
        "--selector",
        "[data-testid=card]",
        "--region-width",
        "320",
        "--region-height",
        "240",
        "--style-check-selector",
        "[data-testid=hero-heading]",
        "--style-check-node-id",
        "200:10",
      ],
      { encoding: "utf8" },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr + result.stdout).toContain("--style-check-selector");
    expect(result.stderr + result.stdout).toContain("--scope page");
  });

  it("rejects an invalid --target-url without launching an interactive prompt", () => {
    const result = spawnSync(
      process.execPath,
      [
        path.join(packageRoot, "bin", "framelia.js"),
        "contract",
        "create",
        "--project-root",
        os.tmpdir(),
        "--target-url",
        "not-a-url",
        "--contract-id",
        "login.desktop",
        "--file-key",
        "abc123",
        "--node-id",
        "1037:71575",
        "--viewport",
        "desktop",
        "--scope",
        "page",
        "--page-reason",
        "Baseline node represents complete page.",
      ],
      { encoding: "utf8" },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr + result.stdout).toContain("--target-url");
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

describe("runCreateContract (scripted prompt adapter)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    process.exitCode = 0;
  });

  it("walks the custom-viewport and region-scope branches end to end", async () => {
    vi.stubEnv("FIGMA_ACCESS_TOKEN", undefined);
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-contract-prompt-"));
    temporaryDirectories.push(directory);

    const { adapter, warnings } = scriptedPrompts([
      "http://127.0.0.1:3000/login", // target URL
      "login.tablet", // contract ID
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

    await runCreateContract({ projectRoot: directory }, adapter);

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
          viewport: { name: "tablet", width: 834, height: 1194 },
          scope: { kind: "region", selector: "[data-testid=card]" },
        },
      ],
    });
    // No Figma token in this test env, so the expectStyle bake-in is skipped, not attempted.
    expect(warnings).toEqual([
      "Skipping expected-style bake-in: contract create skipped: no Figma token to fetch the expected component style.",
    ]);
  });

  it("stops and cancels on the first unanswered prompt", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-contract-prompt-"));
    temporaryDirectories.push(directory);
    const { adapter, cancelCalls } = scriptedPrompts([]); // cancel immediately

    await runCreateContract({ projectRoot: directory }, adapter);

    expect(cancelCalls).toEqual(["Setup cancelled."]);
    expect(process.exitCode).toBe(1);
    expect(fs.existsSync(path.join(directory, ".framelia/visual-verifications"))).toBe(false);
  });

  it("resolves prompt-driven fields around flag overrides", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-contract-prompt-"));
    temporaryDirectories.push(directory);
    const { adapter } = scriptedPrompts([
      "desktop", // viewport preset (only remaining prompt)
      "page", // capture scope
      "Baseline node represents complete page.", // page reason
      "done", // style check-point loop: skip, page reason came from a prompt so the loop still runs
    ]);

    await runCreateContract(
      {
        projectRoot: directory,
        targetUrl: "http://127.0.0.1:3000/login",
        contractId: "login.desktop",
        fileKey: "abc123",
        nodeId: "153:5181",
      },
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
      viewport: { name: "desktop", width: 1440, height: 1024 },
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
    const { adapter } = scriptedPrompts([
      "desktop", // viewport preset -- prompted, makes this an interactive session
      "page", // capture scope
      "done", // style check-point loop: still offered, user skips
    ]);

    await runCreateContract(
      {
        projectRoot: directory,
        targetUrl: "http://127.0.0.1:3000/login",
        contractId: "login.desktop",
        fileKey: "abc123",
        nodeId: "153:5181",
        pageReason: "Baseline node represents complete page.",
      },
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
    // Nothing left to prompt for -- an empty queue proves zero prompts fire.
    const { adapter } = scriptedPrompts([]);

    await runCreateContract(
      {
        projectRoot: directory,
        targetUrl: "http://127.0.0.1:3000/login",
        contractId: "login.desktop",
        fileKey: "abc123",
        nodeId: "153:5181",
        viewport: "desktop",
        scope: "page",
        pageReason: "Baseline node represents complete page.",
      },
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
    vi.stubEnv("FIGMA_ACCESS_TOKEN", undefined);
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-contract-prompt-"));
    temporaryDirectories.push(directory);

    const { adapter, warnings } = scriptedPrompts([
      "http://127.0.0.1:3000/home",
      "home.desktop",
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

    await runCreateContract({ projectRoot: directory }, adapter);

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
    // No Figma token in this test env, so the per-check-point expectStyle bake-in is
    // skipped, not attempted -- same never-blocks handling as the region-scope bake-in.
    expect(warnings).toEqual([
      "Skipping expected-style bake-in: contract create skipped: no Figma token to fetch the expected style for this check-point.",
    ]);
  });

  it("collects multiple page style check-points through the interactive loop", async () => {
    vi.stubEnv("FIGMA_ACCESS_TOKEN", undefined);
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-contract-prompt-"));
    temporaryDirectories.push(directory);

    const { adapter } = scriptedPrompts([
      "http://127.0.0.1:3000/home",
      "home.desktop",
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

    await runCreateContract({ projectRoot: directory }, adapter);

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
