import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { createContractRequest, writeContractRequest } from "../src/contract.ts";

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

    writeContractRequest(outputPath, request);

    expect(JSON.parse(fs.readFileSync(outputPath, "utf8"))).toMatchObject({
      contracts: [{ profile: "component/strict" }],
    });
    expect(() => writeContractRequest(outputPath, request)).toThrow(
      "Refusing to overwrite existing file",
    );
    expect(() => writeContractRequest(outputPath, request, true)).not.toThrow();
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
