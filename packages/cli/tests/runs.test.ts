import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { RUN_FORMAT_VERSION, RUN_PLAN_FRAGMENT_FORMAT_VERSION } from "@framelia/contracts/workflow";
import {
  publishPlanFragment,
  publishShardCompletion,
  readCasePlans,
  runDir,
} from "@framelia/verify/run-bundle";
import { afterEach, describe, expect, it } from "vitest";

import { run } from "../src/cli.ts";
import {
  parseDuration,
  runsFinalizeCommand,
  runsListCommand,
  runsPruneCommand,
} from "../src/internal/runs.ts";
import { createFakeProcess } from "./fake-process.ts";
import { createSelectedRun } from "./selected-run-fixture.ts";
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

/**
 * A sharded run collected from two shards: shard N planned the N-th case of a two-case
 * fixture run (or `planned` overrides which case indexes each shard planned).
 */
async function collectShards(
  root: string,
  shards: readonly number[],
  planned: Record<number, number[]> = { 1: [0], 2: [1] },
): Promise<void> {
  const runId = "run-selected";
  await createSelectedRun(root, { runId, secondCase: { pass: true } });
  const casePlans = [...readCasePlans(root, runId).values()].toSorted((a, b) =>
    a.caseId.localeCompare(b.caseId),
  );
  fs.rmSync(runDir(root, runId), { recursive: true });
  for (const current of shards) {
    const shard = { current, total: 2 };
    // eslint-disable-next-line no-await-in-loop -- each shard publishes under the run lock
    await publishPlanFragment(root, {
      formatVersion: RUN_PLAN_FRAGMENT_FORMAT_VERSION,
      kind: "framelia.run-plan-fragment",
      runId,
      shard,
      policyDigest: casePlans[0]!.policyDigest,
      retryAcceptance: "require-first-attempt",
      createdAt: "2026-10-20T00:00:00.000Z",
      casePlans: (planned[current] ?? []).map((index) => casePlans[index]!),
    });
    // eslint-disable-next-line no-await-in-loop -- each shard publishes under the run lock
    await publishShardCompletion(root, runId, shard, {
      resultStatus: "passed",
      globalErrors: [],
      diagnostics: [],
    });
  }
}

describe("runs finalize", () => {
  it("composes and finalizes a collected sharded run once", async () => {
    const root = project();
    await collectShards(root, [1, 2]);

    const first = await runsFinalizeCommand({ projectRoot: root, run: "run-selected" }, env(root));
    expect(first).toMatchObject({
      exitCode: 0,
      body: {
        kind: "framelia.runs-finalize-outcome",
        command: "runs finalize",
        executionState: "completed",
        exitCode: 0,
        runId: "run-selected",
        state: "finalized",
        shards: { total: 2, completed: [1, 2], missing: [] },
        next: {
          command: "framelia",
          argv: ["open", "--run", "run-selected", "--project-root", root],
        },
      },
    });
    expect(first.body).toHaveProperty("status");

    const again = await runsFinalizeCommand({ projectRoot: root, run: "run-selected" }, env(root));
    expect(again).toMatchObject({ exitCode: 0, body: { state: "already-finalized" } });
  });

  it("exits 2 and lists the shards it is still missing", async () => {
    const root = project();
    await collectShards(root, [1]);

    const result = await runsFinalizeCommand({ projectRoot: root, run: "run-selected" }, env(root));

    expect(result).toMatchObject({
      exitCode: 2,
      body: {
        executionState: "incomplete",
        exitCode: 2,
        state: "waiting",
        shards: {
          total: 2,
          completed: [1],
          missing: [{ current: 2, total: 2, parts: ["plan", "completion"] }],
        },
        diagnostics: [
          { code: "RUN_SHARDS_MISSING", message: expect.stringContaining("shard 2/2") },
        ],
      },
    });
    expect(fs.existsSync(path.join(runDir(root, "run-selected"), "run.json"))).toBe(false);
  });

  it("rejects shards that planned the same case", async () => {
    const root = project();
    await collectShards(root, [1, 2], { 1: [0], 2: [0, 1] });

    const result = await runsFinalizeCommand({ projectRoot: root, run: "run-selected" }, env(root));

    expect(result).toMatchObject({
      exitCode: 2,
      body: {
        executionState: "error",
        diagnostics: [
          { code: "RUN_BUNDLE_SHARD_CONFLICT", message: expect.stringContaining("login.desktop") },
        ],
      },
    });
  });

  it("requires --run and reports a run without shard records", async () => {
    const root = project();
    expect(
      await runsFinalizeCommand({ projectRoot: root, run: undefined }, env(root)),
    ).toMatchObject({
      exitCode: 2,
      body: {
        diagnostics: [{ code: "RUN_SELECTION_MISSING" }],
        next: { command: "framelia", argv: ["runs", "list", "--project-root", root] },
      },
    });
    expect(await runsFinalizeCommand({ projectRoot: root, run: "nope" }, env(root))).toMatchObject({
      exitCode: 2,
      body: { diagnostics: [{ code: "RUN_BUNDLE_MISSING" }] },
    });
    expect(fs.existsSync(runDir(root, "nope"))).toBe(false);
  });

  it("is routed as `framelia runs finalize`", async () => {
    const root = project();
    await collectShards(root, [1, 2]);
    const fakeProcess = { ...createFakeProcess(), cwd: () => root };

    await run(["runs", "finalize", "--run", "run-selected"], {
      process: fakeProcess,
      loadProjectEnv: false,
    });

    expect(fakeProcess.exitCode).toBe(0);
    expect(JSON.parse(fakeProcess.stdoutText())).toMatchObject({
      kind: "framelia.runs-finalize-outcome",
      state: "finalized",
    });
  });
});
