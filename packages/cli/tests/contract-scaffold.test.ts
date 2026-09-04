import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createContractRequest, writeContractRequest } from "../src/internal/contract-scaffold.ts";

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
      name: "Login · Desktop",
      baseline: { kind: "figma", fileKey: "abc123", nodeId: "153:5181" },
      viewport: { preset: "desktop", width: 1440, height: 1024 },
      scope: { kind: "page", pageReason: "Complete login page." },
    });

    expect(request).toMatchObject({
      schemaVersion: 5,
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
      name: "Card · Mobile",
      baseline: { kind: "figma", fileKey: "abc123", nodeId: "153:5181" },
      viewport: { preset: "mobile", width: 390, height: 844 },
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
      name: "Card · Desktop",
      baseline: { kind: "figma", fileKey: "abc123", nodeId: "153:5181" },
      viewport: { preset: "desktop", width: 1440, height: 1024 },
      scope: { kind: "page", pageReason: "Complete card page." },
    });
    const mobile = createContractRequest({
      targetUrl: "https://preview.example.com/card",
      contractId: "card.mobile",
      name: "Card · Mobile",
      baseline: { kind: "figma", fileKey: "abc123", nodeId: "153:5182" },
      viewport: { preset: "mobile", width: 390, height: 844 },
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
      name: "Card · Desktop",
      baseline: { kind: "figma", fileKey: "abc123", nodeId: "153:5181" },
      viewport: { preset: "desktop", width: 1440, height: 1024 },
      scope: { kind: "page", pageReason: "Complete card page." },
    });
    const mobile = createContractRequest({
      targetUrl: "https://preview.example.com/card",
      contractId: "card.mobile",
      name: "Card · Mobile",
      baseline: { kind: "figma", fileKey: "abc123", nodeId: "153:5182" },
      viewport: { preset: "mobile", width: 390, height: 844 },
      scope: { kind: "page", pageReason: "Complete card page." },
    });
    const updatedDesktop = createContractRequest({
      targetUrl: "https://preview.example.com/card",
      contractId: "card.desktop",
      name: "Card · Desktop",
      baseline: { kind: "figma", fileKey: "abc123", nodeId: "999:9999" },
      viewport: { preset: "desktop", width: 1920, height: 1080 },
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
      name: "Card · Desktop",
      baseline: { kind: "figma", fileKey: "abc123", nodeId: "153:5181" },
      viewport: { preset: "desktop", width: 1440, height: 1024 },
      scope: { kind: "page", pageReason: "Complete card page." },
    });
    const otherPage = createContractRequest({
      targetUrl: "https://preview.example.com/other",
      contractId: "card.mobile",
      name: "Card · Mobile",
      baseline: { kind: "figma", fileKey: "abc123", nodeId: "153:5182" },
      viewport: { preset: "mobile", width: 390, height: 844 },
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
      name: "Card · Desktop",
      baseline: { kind: "figma", fileKey: "abc123", nodeId: "153:5181" },
      viewport: { preset: "desktop", width: 1440, height: 1024 },
      scope: { kind: "page", pageReason: "Complete card page." },
    });
    const sameIdOtherUrl = createContractRequest({
      targetUrl: "https://preview.example.com/other",
      contractId: "card.desktop",
      name: "Card · Desktop",
      baseline: { kind: "figma", fileKey: "abc123", nodeId: "999:9999" },
      viewport: { preset: "desktop", width: 1920, height: 1080 },
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
      name: "Card · Desktop",
      baseline: { kind: "figma", fileKey: "abc123", nodeId: "153:5181" },
      viewport: { preset: "desktop", width: 1440, height: 1024 },
      scope: { kind: "page", pageReason: "Complete card page." },
    });
    const mobile = createContractRequest({
      targetUrl: "https://preview.example.com/card",
      contractId: "card.mobile",
      name: "Card · Mobile",
      baseline: { kind: "figma", fileKey: "abc123", nodeId: "153:5182" },
      viewport: { preset: "mobile", width: 390, height: 844 },
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
      name: "Home · Desktop",
      baseline: { kind: "figma", fileKey: "abc123", nodeId: "153:5181" },
      viewport: { preset: "desktop", width: 1440, height: 1024 },
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
      name: "Home · Desktop",
      baseline: { kind: "figma", fileKey: "abc123", nodeId: "153:5181" },
      viewport: { preset: "desktop", width: 1440, height: 1024 },
      scope: { kind: "page", pageReason: "Baseline node represents complete home page." },
    });

    expect(request.contracts[0]?.scope).not.toHaveProperty("styleChecks");
  });

  it("accepts a region contract with expectStyle baked in from Figma", () => {
    const request = createContractRequest({
      targetUrl: "http://127.0.0.1:3000/login",
      contractId: "login.form.desktop",
      name: "Login · Form · Desktop",
      baseline: { kind: "figma", fileKey: "abc123", nodeId: "153:5181" },
      viewport: { preset: "desktop", width: 1440, height: 1024 },
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
