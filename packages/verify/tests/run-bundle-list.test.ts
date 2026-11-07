import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { RUN_FORMAT_VERSION } from "@framelia/contracts/workflow";
import { afterEach, describe, expect, it } from "vitest";

import { listRuns, runDir } from "../src/run-bundle/index.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function project(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-run-list-"));
  roots.push(root);
  return root;
}

function writeRun(
  root: string,
  runId: string,
  record: { status: string; createdAt: string; finalizedAt?: string },
  directory = runDir(root, runId),
): void {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, "run.json"),
    JSON.stringify({
      formatVersion: RUN_FORMAT_VERSION,
      kind: "framelia.run",
      runId,
      planDigest: `sha256:${"a".repeat(64)}`,
      diagnostics: [],
      cases: [
        { caseId: "a@chromium#0", attemptIds: ["a1", "a2"], selectedAttemptId: "a2" },
        { caseId: "b@chromium#0", attemptIds: [] },
      ],
      ...record,
    }),
  );
}

describe("listRuns", () => {
  it("returns nothing for a project without runs", () => {
    expect(listRuns(project())).toEqual({ runs: [], invalid: [] });
  });

  it("summarizes each run newest first and reports locks and broken directories", () => {
    const root = project();
    writeRun(root, "old run", {
      status: "finalized",
      createdAt: "2026-01-01T00:00:00.000Z",
      finalizedAt: "2026-01-01T00:01:00.000Z",
    });
    writeRun(root, "new-run", { status: "running", createdAt: "2026-02-01T00:00:00.000Z" });
    fs.mkdirSync(path.join(runDir(root, "new-run"), "lock"));
    fs.mkdirSync(path.join(root, ".framelia", "runs", "planning-only"));
    writeRun(
      root,
      "moved",
      {
        status: "error",
        createdAt: "2026-03-01T00:00:00.000Z",
        finalizedAt: "2026-03-01T00:00:01.000Z",
      },
      path.join(root, ".framelia", "runs", "wrong-dir"),
    );

    const listing = listRuns(root);

    expect(listing.runs).toEqual([
      {
        runId: "new-run",
        bundlePath: path.relative(root, runDir(root, "new-run")).split(path.sep).join("/"),
        status: "running",
        terminal: false,
        locked: true,
        createdAt: "2026-02-01T00:00:00.000Z",
        caseCount: 2,
        attemptCount: 2,
        selectedAttemptCount: 1,
      },
      expect.objectContaining({
        runId: "old run",
        status: "finalized",
        terminal: true,
        locked: false,
        finalizedAt: "2026-01-01T00:01:00.000Z",
      }),
    ]);
    expect(listing.invalid).toEqual([
      expect.objectContaining({
        bundlePath: ".framelia/runs/planning-only",
        code: "RUN_BUNDLE_MISSING",
      }),
      expect.objectContaining({
        bundlePath: ".framelia/runs/wrong-dir",
        code: "RUN_BUNDLE_INVALID",
      }),
    ]);
  });
});
