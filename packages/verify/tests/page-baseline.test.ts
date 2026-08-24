import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  pageBaselineImagePath,
  pageBaselineMetaPath,
  promotePageBaseline,
  readPageBaselineMeta,
  resolvePageBaseline,
} from "../src/page-baseline.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-page-baseline-"));
  temporaryDirectories.push(dir);
  return dir;
}

function writePng(filePath: string, marker: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, marker);
}

describe("resolvePageBaseline", () => {
  it("reports no baseline found when nothing has been promoted yet", () => {
    const outDir = tempDir();
    const result = resolvePageBaseline(outDir);
    expect(result).toMatchObject({
      ok: false,
      error: "BASELINE_NOT_FOUND",
      message: expect.stringMatching(/framelia baseline promote/),
    });
  });
});

describe("promotePageBaseline", () => {
  it("writes the baseline image and a meta record at version 1 on first promotion", () => {
    const outDir = tempDir();
    const sourcePath = path.join(tempDir(), "capture.png");
    writePng(sourcePath, "capture-v1");

    const result = promotePageBaseline({
      sourcePath,
      outDir,
      promotedBy: "alice@example.com",
      runId: "run-1",
    });

    expect(result.baselinePath).toBe(pageBaselineImagePath(outDir, 1));
    expect(result.metaPath).toBe(pageBaselineMetaPath(outDir));
    expect(result.archivedPath).toBeUndefined();
    expect(fs.readFileSync(result.baselinePath, "utf8")).toBe("capture-v1");
    expect(result.meta.current).toMatchObject({
      version: 1,
      promotedBy: "alice@example.com",
      runId: "run-1",
    });
    expect(result.meta.history).toEqual([]);

    const resolved = resolvePageBaseline(outDir);
    expect(resolved).toMatchObject({
      ok: true,
      path: pageBaselineImagePath(outDir, 1),
      meta: { current: { version: 1 } },
    });
  });

  it("archives the previous baseline image and versions history on a second promotion", () => {
    const outDir = tempDir();
    const firstSource = path.join(tempDir(), "capture-1.png");
    const secondSource = path.join(tempDir(), "capture-2.png");
    writePng(firstSource, "capture-v1");
    writePng(secondSource, "capture-v2");

    promotePageBaseline({ sourcePath: firstSource, outDir, promotedBy: "alice@example.com" });
    const second = promotePageBaseline({
      sourcePath: secondSource,
      outDir,
      promotedBy: "bob@example.com",
      note: "intentional redesign",
    });

    expect(second.meta.current).toMatchObject({ version: 2, promotedBy: "bob@example.com" });
    expect(second.meta.history).toHaveLength(1);
    expect(second.meta.history[0]).toMatchObject({ version: 1, promotedBy: "alice@example.com" });

    // The new current version is the just-promoted capture...
    expect(fs.readFileSync(pageBaselineImagePath(outDir, 2), "utf8")).toBe("capture-v2");
    // ...and the prior one is still there under its own path, not lost.
    expect(second.archivedPath).toBe(pageBaselineImagePath(outDir, 1));
    expect(fs.readFileSync(second.archivedPath!, "utf8")).toBe("capture-v1");
  });

  it("never rewrites a previously promoted version's image bytes once written (PR #50 review: the pointer -- meta.json -- must be the only thing a later promotion changes)", () => {
    const outDir = tempDir();
    const firstSource = path.join(tempDir(), "capture-1.png");
    writePng(firstSource, "capture-v1");
    promotePageBaseline({ sourcePath: firstSource, outDir, promotedBy: "alice@example.com" });
    const v1Path = pageBaselineImagePath(outDir, 1);
    const v1StatBefore = fs.statSync(v1Path);

    for (let i = 2; i <= 4; i += 1) {
      const source = path.join(tempDir(), `capture-${i}.png`);
      writePng(source, `capture-v${i}`);
      promotePageBaseline({ sourcePath: source, outDir, promotedBy: `user-${i}@example.com` });
    }

    // v1's file identity (mtime) is untouched by every later promotion -- nothing ever
    // copies over an existing version's path, only meta.json's pointer moves.
    expect(fs.statSync(v1Path).mtimeMs).toBe(v1StatBefore.mtimeMs);
    expect(fs.readFileSync(v1Path, "utf8")).toBe("capture-v1");
  });

  it("never leaves the previous baseline.png silently overwritten with no history on repeated promotions", () => {
    const outDir = tempDir();
    for (let i = 1; i <= 3; i += 1) {
      const source = path.join(tempDir(), `capture-${i}.png`);
      writePng(source, `capture-v${i}`);
      promotePageBaseline({ sourcePath: source, outDir, promotedBy: `user-${i}@example.com` });
    }

    const meta = readPageBaselineMeta(outDir);
    expect(meta?.current.version).toBe(3);
    expect(meta?.history.map((entry) => entry.version)).toEqual([1, 2]);
    // Every prior version's image is still recoverable on disk.
    for (let version = 1; version <= 2; version += 1) {
      const archived = path.join(outDir, "web-baseline-history", `v${version}.png`);
      expect(fs.readFileSync(archived, "utf8")).toBe(`capture-v${version}`);
    }
  });
});
