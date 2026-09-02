import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadEnvFiles, loadProjectEnv } from "../src/load-env.ts";
import { AppError } from "../src/types.ts";
import { captureThrown } from "./support/capture-error.ts";

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

  it("raises an INVALID_PROJECT_RELATIVE_PATH AppError for parent traversal", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fidelity-env-escape-code-"));
    const error = captureThrown(() => loadEnvFiles(root, "../.env"));
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("INVALID_PROJECT_RELATIVE_PATH");
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("raises an ENV_FILE_ENTRY_INVALID AppError for a blank entry", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fidelity-env-blank-"));
    const error = captureThrown(() => loadEnvFiles(root, "   "));
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("ENV_FILE_ENTRY_INVALID");
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("raises an ENV_FILE_NOT_FOUND AppError for a required-but-missing file", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fidelity-env-missing-"));
    const error = captureThrown(() => loadEnvFiles(root, ".env.missing"));
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("ENV_FILE_NOT_FOUND");
    fs.rmSync(root, { recursive: true, force: true });
  });
});

/**
 * Fixtures pinning the syntax forms the dotenv-backed parser accepts beyond
 * plain `KEY=value` lines. Key-name filtering and "never overwrite an
 * already-set key" precedence (asserted above) apply identically here.
 */
function loadFixture(contents: string): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fidelity-env-widen-"));
  fs.writeFileSync(path.join(root, ".env.fixture"), contents);
  delete process.env.FRAMELIA_LOAD_ENV_TEST;
  loadEnvFiles(root, ".env.fixture");
  fs.rmSync(root, { recursive: true, force: true });
}

describe("widened .env syntax accepted via dotenv.parse", () => {
  it("accepts an `export` prefix before the key", () => {
    loadFixture("export FRAMELIA_LOAD_ENV_TEST=exported\n");
    expect(process.env.FRAMELIA_LOAD_ENV_TEST).toBe("exported");
  });

  it("accepts backtick-quoted values", () => {
    loadFixture("FRAMELIA_LOAD_ENV_TEST=`backtick value`\n");
    expect(process.env.FRAMELIA_LOAD_ENV_TEST).toBe("backtick value");
  });

  it("accepts a multiline double-quoted value", () => {
    loadFixture('FRAMELIA_LOAD_ENV_TEST="line one\nline two"\n');
    expect(process.env.FRAMELIA_LOAD_ENV_TEST).toBe("line one\nline two");
  });

  it("expands a backslash-n escape inside a double-quoted value", () => {
    loadFixture('FRAMELIA_LOAD_ENV_TEST="line one\\nline two"\n');
    expect(process.env.FRAMELIA_LOAD_ENV_TEST).toBe("line one\nline two");
  });

  it("still filters out keys that aren't valid identifiers", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fidelity-env-filter-"));
    fs.writeFileSync(
      path.join(root, ".env.fixture"),
      "FRAMELIA-LOAD-ENV-TEST=dashed\nFRAMELIA_LOAD_ENV_TEST=underscored\n",
    );
    delete process.env.FRAMELIA_LOAD_ENV_TEST;
    delete process.env["FRAMELIA-LOAD-ENV-TEST"];
    loadEnvFiles(root, ".env.fixture");
    expect(process.env.FRAMELIA_LOAD_ENV_TEST).toBe("underscored");
    expect(process.env["FRAMELIA-LOAD-ENV-TEST"]).toBeUndefined();
    fs.rmSync(root, { recursive: true, force: true });
  });
});
