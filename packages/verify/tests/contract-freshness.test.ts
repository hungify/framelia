import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  contractFreshnessPath,
  isContractFresh,
  readContractFreshness,
  writeContractFreshness,
} from "../src/contract-freshness.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-contract-freshness-"));
  temporaryDirectories.push(dir);
  return dir;
}

describe("readContractFreshness", () => {
  it("returns null when no receipt has ever been written", () => {
    expect(readContractFreshness(tempDir())).toBeNull();
  });

  it("returns null for a corrupt receipt instead of throwing", () => {
    const outDir = tempDir();
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(contractFreshnessPath(outDir), "{ not json");
    expect(readContractFreshness(outDir)).toBeNull();
  });

  it("returns null for valid JSON that doesn't match the receipt shape", () => {
    const outDir = tempDir();
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(contractFreshnessPath(outDir), JSON.stringify({ fingerprint: 123 }));
    expect(readContractFreshness(outDir)).toBeNull();
  });
});

describe("writeContractFreshness / isContractFresh", () => {
  it("is not fresh before any receipt exists", () => {
    expect(isContractFresh(tempDir(), "sha-1")).toBe(false);
  });

  it("is fresh once a passing receipt for the same fingerprint is recorded", () => {
    const outDir = tempDir();
    writeContractFreshness(outDir, { fingerprint: "sha-1", pass: true, checkedAt: "now" });
    expect(isContractFresh(outDir, "sha-1")).toBe(true);
  });

  it("is not fresh once the fingerprint changes", () => {
    const outDir = tempDir();
    writeContractFreshness(outDir, { fingerprint: "sha-1", pass: true, checkedAt: "now" });
    expect(isContractFresh(outDir, "sha-2")).toBe(false);
  });

  it("is never fresh off a failing receipt, even for the same fingerprint", () => {
    const outDir = tempDir();
    writeContractFreshness(outDir, { fingerprint: "sha-1", pass: false, checkedAt: "now" });
    expect(isContractFresh(outDir, "sha-1")).toBe(false);
  });

  it("a later write replaces the earlier receipt rather than appending to it", () => {
    const outDir = tempDir();
    writeContractFreshness(outDir, { fingerprint: "sha-1", pass: true, checkedAt: "t1" });
    writeContractFreshness(outDir, { fingerprint: "sha-2", pass: true, checkedAt: "t2" });
    expect(readContractFreshness(outDir)).toMatchObject({ fingerprint: "sha-2", checkedAt: "t2" });
  });
});
