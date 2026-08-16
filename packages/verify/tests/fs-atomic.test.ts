import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { writeFileAtomic } from "../src/fs-atomic.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-fs-atomic-"));
  roots.push(root);
  return root;
}

describe("writeFileAtomic", () => {
  it("creates the parent directory and writes the file", () => {
    const root = tempRoot();
    const target = path.join(root, "nested", "dir", "out.json");

    writeFileAtomic(target, '{"ok":true}');

    expect(fs.readFileSync(target, "utf8")).toBe('{"ok":true}');
  });

  it("overwrites an existing file's content", () => {
    const root = tempRoot();
    const target = path.join(root, "out.json");
    fs.writeFileSync(target, "stale");

    writeFileAtomic(target, "fresh");

    expect(fs.readFileSync(target, "utf8")).toBe("fresh");
  });

  it("leaves no temp file behind after a successful write", () => {
    const root = tempRoot();
    const target = path.join(root, "out.json");

    writeFileAtomic(target, "content");

    const entries = fs.readdirSync(root);
    expect(entries).toEqual(["out.json"]);
  });
});
