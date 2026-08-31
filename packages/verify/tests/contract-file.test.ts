import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readContractEntry } from "../src/contract-file.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-contract-file-"));
  temporaryDirectories.push(dir);
  return dir;
}

const target = { kind: "web" as const, url: "http://localhost:3000" };
const contractRequest = {
  schemaVersion: 4,
  target,
  contracts: [
    {
      id: "login.desktop",
      baseline: { kind: "figma" as const, fileKey: "file-key", nodeId: "1:2" },
      viewport: { name: "desktop", width: 1440, height: 1024 },
      outDir: ".framelia/visual-verifications/login",
      scope: { kind: "page" as const, pageReason: "full page" },
    },
    {
      id: "login.mobile",
      baseline: { kind: "figma" as const, fileKey: "file-key", nodeId: "1:3" },
      viewport: { name: "mobile", width: 390, height: 844 },
      outDir: ".framelia/visual-verifications/login",
      scope: { kind: "page" as const, pageReason: "full page" },
    },
  ],
};

function writeContractFile(dir: string, contents: unknown): string {
  const filePath = path.join(dir, "visual-contract.json");
  fs.writeFileSync(filePath, JSON.stringify(contents, null, 2));
  return filePath;
}

describe("readContractEntry", () => {
  it("reports FILE_NOT_FOUND when the contract file does not exist", () => {
    const result = readContractEntry(path.join(tempDir(), "missing.json"), "login.desktop");
    expect(result).toMatchObject({ ok: false, error: "FILE_NOT_FOUND" });
  });

  it("reports INVALID_CONTRACT_FILE for malformed JSON", () => {
    const dir = tempDir();
    const filePath = path.join(dir, "visual-contract.json");
    fs.writeFileSync(filePath, "{ not json");
    const result = readContractEntry(filePath, "login.desktop");
    expect(result).toMatchObject({ ok: false, error: "INVALID_CONTRACT_FILE" });
  });

  it("reports a read-error message (not a JSON-parse message) when the path can't be read", () => {
    const dir = tempDir();
    const dirAsFilePath = path.join(dir, "visual-contract.json");
    fs.mkdirSync(dirAsFilePath);
    const result = readContractEntry(dirAsFilePath, "login.desktop");
    expect(result).toMatchObject({ ok: false, error: "INVALID_CONTRACT_FILE" });
    expect((result as { message: string }).message).toContain("could not be read");
  });

  it("reports INVALID_CONTRACT_FILE for JSON that fails schema validation", () => {
    const dir = tempDir();
    const filePath = writeContractFile(dir, { schemaVersion: 4, target, contracts: [] });
    const result = readContractEntry(filePath, "login.desktop");
    expect(result).toMatchObject({ ok: false, error: "INVALID_CONTRACT_FILE" });
  });

  it("reports CONTRACT_NOT_FOUND when the id is absent from an otherwise-valid file", () => {
    const dir = tempDir();
    const filePath = writeContractFile(dir, contractRequest);
    const result = readContractEntry(filePath, "login.tablet");
    expect(result).toMatchObject({ ok: false, error: "CONTRACT_NOT_FOUND" });
  });

  it("returns the matching entry, schema-validated, from a multi-contract file", () => {
    const dir = tempDir();
    const filePath = writeContractFile(dir, contractRequest);

    const desktop = readContractEntry(filePath, "login.desktop");
    expect(desktop).toMatchObject({
      ok: true,
      contract: { id: "login.desktop", viewport: { width: 1440, height: 1024 } },
    });

    const mobile = readContractEntry(filePath, "login.mobile");
    expect(mobile).toMatchObject({
      ok: true,
      contract: { id: "login.mobile", viewport: { width: 390, height: 844 } },
    });
  });
});
