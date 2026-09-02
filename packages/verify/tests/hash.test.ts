import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { fileHash, sha256Hex } from "../src/hash.ts";

describe("sha256Hex", () => {
  it("matches node:crypto's own sha256 hex digest for a string", () => {
    const expected = crypto.createHash("sha256").update("hello world").digest("hex");
    expect(sha256Hex("hello world")).toBe(expected);
  });

  it("matches node:crypto's own sha256 hex digest for a Buffer", () => {
    const buf = Buffer.from([1, 2, 3, 4]);
    const expected = crypto.createHash("sha256").update(buf).digest("hex");
    expect(sha256Hex(buf)).toBe(expected);
  });

  it("is deterministic", () => {
    expect(sha256Hex("same input")).toBe(sha256Hex("same input"));
  });

  it("differs for different input", () => {
    expect(sha256Hex("a")).not.toBe(sha256Hex("b"));
  });
});

describe("fileHash", () => {
  const files: string[] = [];

  afterEach(() => {
    for (const file of files.splice(0)) fs.rmSync(file, { force: true });
  });

  it("formats as sha256:<hex> and matches the file's own content hash", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "framelia-hash-")), "f.txt");
    files.push(file);
    fs.writeFileSync(file, "artifact contents");

    const expected = `sha256:${crypto.createHash("sha256").update("artifact contents").digest("hex")}`;
    expect(fileHash(file)).toBe(expected);
  });

  it("changes when file contents change", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "framelia-hash-")), "f.txt");
    files.push(file);
    fs.writeFileSync(file, "version 1");
    const first = fileHash(file);
    fs.writeFileSync(file, "version 2");
    expect(fileHash(file)).not.toBe(first);
  });
});
