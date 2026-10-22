import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as zlib from "node:zlib";

import { afterEach, describe, expect, it, vi } from "vitest";

import { compareCommand } from "../src/internal/compare.ts";
import type { CliRuntime } from "../src/runtime-types.ts";

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

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A solid-colour RGB PNG, so the test needs no image dependency. */
function solidPng(width: number, height: number, rgb: readonly [number, number, number]): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(width).fill(rgb).flat())]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlib.deflateSync(Buffer.concat(Array(height).fill(row)))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-compare-"));
  temporaryDirectories.push(directory);
  return directory;
}

describe("compareCommand", () => {
  it("resolves relative baseline/actual paths against the injected runtime cwd, not global process.cwd()", () => {
    const result = compareCommand(
      {
        baseline: "missing-a.png",
        actual: "sub/missing-b.png",
        outDir: undefined,
        profile: "component/strict",
      },
      { process: fakeRuntime({ cwd: () => "/from/runtime" }) },
    );
    expect(result.body.pass).toBe(false);
    const message = result.body.topIssues[0]?.message ?? "";
    expect(message).toContain(path.resolve("/from/runtime", "missing-a.png"));
  });

  it.each(["page", "component/strict", "component/dev"] as const)(
    "accepts the %s profile without throwing",
    (profile) => {
      const result = compareCommand(
        { baseline: "a.png", actual: "b.png", outDir: undefined, profile },
        { process: fakeRuntime() },
      );
      expect(result.body.pass).toBe(false);
    },
  );

  it("reports missing or unreadable input as an operational failure (exit 2), not a mismatch", () => {
    const directory = tempDir();
    fs.writeFileSync(path.join(directory, "corrupt.png"), "not a png");
    fs.writeFileSync(path.join(directory, "ok.png"), solidPng(4, 4, [255, 255, 255]));
    for (const [baseline, actual] of [
      ["missing.png", "ok.png"],
      ["corrupt.png", "ok.png"],
    ] as const) {
      const result = compareCommand(
        { baseline, actual, outDir: directory, profile: "component/strict" },
        { process: fakeRuntime({ cwd: () => directory }) },
      );
      expect(result.ok).toBe(false);
      expect(result.exitCode).toBe(2);
    }
  });

  it("reports a completed visual mismatch as exit 1 and a match as exit 0", () => {
    const directory = tempDir();
    fs.writeFileSync(path.join(directory, "white.png"), solidPng(8, 8, [255, 255, 255]));
    fs.writeFileSync(path.join(directory, "white-copy.png"), solidPng(8, 8, [255, 255, 255]));
    fs.writeFileSync(path.join(directory, "black.png"), solidPng(8, 8, [0, 0, 0]));
    const options = { outDir: directory, profile: "component/strict" } as const;
    const env = { process: fakeRuntime({ cwd: () => directory }) };

    const mismatch = compareCommand(
      { ...options, baseline: "white.png", actual: "black.png" },
      env,
    );
    expect(mismatch).toMatchObject({ ok: false, exitCode: 1 });

    const match = compareCommand(
      { ...options, baseline: "white.png", actual: "white-copy.png" },
      env,
    );
    expect(match).toMatchObject({ ok: true, exitCode: 0 });
  });
});
