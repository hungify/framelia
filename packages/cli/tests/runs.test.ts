import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { RUN_FORMAT_VERSION } from "@framelia/contracts/workflow";
import { runDir } from "@framelia/verify/run-bundle";
import { afterEach, describe, expect, it } from "vitest";

import { run } from "../src/cli.ts";
import { parseDuration, runsListCommand, runsPruneCommand } from "../src/internal/runs.ts";
import { createFakeProcess } from "./fake-process.ts";
import { testEnvironment } from "./test-environment.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function project(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-cli-runs-"));
  roots.push(root);
  fs.writeFileSync(path.join(root, "framelia.config.mjs"), "export default {};\n");
  return root;
}

function writeRun(root: string, runId: string, createdAt: string, status = "finalized"): void {
  const directory = runDir(root, runId);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, "run.json"),
    JSON.stringify({
      formatVersion: RUN_FORMAT_VERSION,
      kind: "framelia.run",
      runId,
      planDigest: `sha256:${"a".repeat(64)}`,
      status,
      createdAt,
      ...(status === "running" ? {} : { finalizedAt: createdAt }),
      diagnostics: [],
      cases: [{ caseId: "a@chromium#0", attemptIds: ["a1"], selectedAttemptId: "a1" }],
    }),
  );
}

function env(root: string, now = new Date("2026-10-21T00:00:00.000Z")) {
  return testEnvironment({ ...createFakeProcess(), cwd: () => root }, {}, { now: () => now });
}

describe("runs list", () => {
  it("lists runs newest first and suggests opening the newest", () => {
    const root = project();
    writeRun(root, "first", "2026-10-01T00:00:00.000Z");
    writeRun(root, "second", "2026-10-02T00:00:00.000Z");

    const result = runsListCommand({ projectRoot: root }, env(root));

    expect(result).toMatchObject({
      exitCode: 0,
      body: {
        kind: "framelia.runs-list-outcome",
        runs: [
          { runId: "second", status: "finalized", caseCount: 1 },
          { runId: "first", status: "finalized" },
        ],
        next: { command: "framelia", argv: ["open", "--run", "second", "--project-root", root] },
      },
    });
  });

  it("is what bare `framelia` prints, suggesting a first check when no run exists", async () => {
    const root = project();
    const fakeProcess = { ...createFakeProcess(), cwd: () => root };

    await run([], { process: fakeProcess, loadProjectEnv: false });

    expect(fakeProcess.exitCode).toBe(0);
    expect(JSON.parse(fakeProcess.stdoutText())).toMatchObject({
      kind: "framelia.runs-list-outcome",
      runs: [],
      next: { command: "framelia", argv: ["check", "--all"] },
    });
  });
});

describe("runs prune", () => {
  it("keeps the newest runs and never removes in-progress or locked ones", () => {
    const root = project();
    writeRun(root, "r1", "2026-10-01T00:00:00.000Z");
    writeRun(root, "r2", "2026-10-02T00:00:00.000Z", "running");
    writeRun(root, "r3", "2026-10-03T00:00:00.000Z");
    fs.mkdirSync(path.join(runDir(root, "r3"), "lock"));
    writeRun(root, "r4", "2026-10-04T00:00:00.000Z");
    writeRun(root, "r5", "2026-10-05T00:00:00.000Z");

    const dryRun = runsPruneCommand(
      { projectRoot: root, keep: 2, olderThan: undefined, dryRun: true },
      env(root),
    );
    expect(dryRun.body).toMatchObject({
      dryRun: true,
      removed: [{ runId: "r1" }],
      skipped: [
        { runId: "r3", reason: "locked" },
        { runId: "r2", reason: "in-progress" },
      ],
    });
    expect(fs.existsSync(runDir(root, "r1"))).toBe(true);

    const pruned = runsPruneCommand(
      { projectRoot: root, keep: 2, olderThan: undefined, dryRun: undefined },
      env(root),
    );
    expect(pruned.body).toMatchObject({ removed: [{ runId: "r1" }], kept: 4 });
    expect(fs.existsSync(runDir(root, "r1"))).toBe(false);
    expect(fs.existsSync(runDir(root, "r4"))).toBe(true);
  });

  it("removes only runs older than --older-than", () => {
    const root = project();
    writeRun(root, "old", "2026-10-01T00:00:00.000Z");
    writeRun(root, "recent", "2026-10-20T12:00:00.000Z");

    const result = runsPruneCommand(
      { projectRoot: root, keep: undefined, olderThan: "7d", dryRun: undefined },
      env(root),
    );

    expect(result.body).toMatchObject({ removed: [{ runId: "old" }] });
    expect(fs.existsSync(runDir(root, "recent"))).toBe(true);
  });

  it("requires a criterion and a valid duration", () => {
    const root = project();
    expect(
      runsPruneCommand(
        { projectRoot: root, keep: undefined, olderThan: undefined, dryRun: undefined },
        env(root),
      ),
    ).toMatchObject({ exitCode: 2, body: { diagnostics: [{ code: "INVALID_INPUT" }] } });
    expect(parseDuration("12h")).toBe(12 * 3_600_000);
    expect(() => parseDuration("7 days")).toThrow(/--older-than/);
  });
});
