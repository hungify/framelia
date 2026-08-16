import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadEnvFiles, loadProjectEnv } from "../src/load-env.ts";

const originalValue = process.env.FRAMELIA_LOAD_ENV_TEST;

afterEach(() => {
  if (originalValue === undefined) {
    delete process.env.FRAMELIA_LOAD_ENV_TEST;
  } else {
    process.env.FRAMELIA_LOAD_ENV_TEST = originalValue;
  }
});

describe("loadProjectEnv", () => {
  it("loads .env from the project root only", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fidelity-env-"));
    const nested = path.join(root, "apps", "web");
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(root, ".env"), "FRAMELIA_LOAD_ENV_TEST=root\n");
    fs.writeFileSync(path.join(nested, ".env"), "FRAMELIA_LOAD_ENV_TEST=nested\n");

    delete process.env.FRAMELIA_LOAD_ENV_TEST;
    const loaded = loadProjectEnv(root);

    expect(loaded).toEqual([path.join(root, ".env")]);
    expect(process.env.FRAMELIA_LOAD_ENV_TEST).toBe("root");
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("lets callers override which env basenames are loaded", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fidelity-env-custom-"));
    fs.writeFileSync(path.join(root, ".env"), "FRAMELIA_LOAD_ENV_TEST=default\n");
    fs.writeFileSync(path.join(root, ".env.playwright"), "FRAMELIA_LOAD_ENV_TEST=playwright\n");

    delete process.env.FRAMELIA_LOAD_ENV_TEST;
    const loaded = loadProjectEnv(root, { files: [".env.playwright"] });

    expect(loaded).toEqual([path.join(root, ".env.playwright")]);
    expect(process.env.FRAMELIA_LOAD_ENV_TEST).toBe("playwright");
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("skips missing default files", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fidelity-env-empty-"));
    delete process.env.FRAMELIA_LOAD_ENV_TEST;
    expect(loadProjectEnv(root)).toEqual([]);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("loadEnvFiles", () => {
  it("loads project-relative custom env files without overwriting existing keys", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fidelity-env-files-"));
    fs.writeFileSync(path.join(root, ".env.playwright"), "FRAMELIA_LOAD_ENV_TEST=custom\n");

    process.env.FRAMELIA_LOAD_ENV_TEST = "preset";
    const loaded = loadEnvFiles(root, ".env.playwright");

    expect(loaded).toEqual([path.join(root, ".env.playwright")]);
    expect(process.env.FRAMELIA_LOAD_ENV_TEST).toBe("preset");
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("rejects parent traversal", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fidelity-env-escape-"));
    expect(() => loadEnvFiles(root, "../.env")).toThrow(/project-relative/);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
