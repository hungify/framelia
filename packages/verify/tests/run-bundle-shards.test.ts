import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
  RUN_PLAN_FRAGMENT_FORMAT_VERSION,
  type CasePlan,
  type RunPlanFragment,
  type RunShard,
  type ShardCompletion,
} from "@framelia/contracts/workflow";
import { afterEach, describe, expect, it } from "vitest";

import { canonicalJsonDigest } from "../src/canonical-json.ts";
import {
  buildDirectRunPlan,
  finalizeShardedRun,
  inspectShardedRun,
  listRuns,
  planDir,
  planFragmentPath,
  publishAttempt,
  publishPlanFragment,
  publishShardCompletion,
  readRunBundle,
  readSelectedRun,
  runRecordPath,
} from "../src/run-bundle/index.ts";
import { AppError } from "../src/types.ts";
import {
  attemptFixture,
  completeEvidence,
  realCasePlanFixture,
} from "./support/run-bundle-fixtures.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function temporaryRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-run-shards-"));
  roots.push(root);
  return root;
}

const RUN_ID = "ci-1234";

async function shardedCasePlans(root: string, contractIds: readonly string[]) {
  const plans: CasePlan[] = [];
  for (const contractId of contractIds) {
    // eslint-disable-next-line no-await-in-loop -- fixtures share one project root's files
    const casePlan = await realCasePlanFixture(root, { contractId });
    plans.push({ ...casePlan, runId: RUN_ID });
  }
  return plans;
}

function fragment(
  shard: RunShard,
  casePlans: readonly CasePlan[],
  overrides: Partial<RunPlanFragment> = {},
): RunPlanFragment {
  return {
    formatVersion: RUN_PLAN_FRAGMENT_FORMAT_VERSION,
    kind: "framelia.run-plan-fragment",
    runId: RUN_ID,
    shard,
    policyDigest: casePlans[0]?.policyDigest ?? `sha256:${"a".repeat(64)}`,
    retryAcceptance: "require-first-attempt",
    createdAt: `2026-10-21T00:00:0${shard.current}.000Z`,
    casePlans: [...casePlans],
    ...overrides,
  };
}

async function publishPassingAttempt(root: string, casePlan: CasePlan, shard: RunShard) {
  await publishAttempt(
    root,
    RUN_ID,
    attemptFixture(casePlan, 0),
    completeEvidence(Buffer.from(`actual-${casePlan.caseId}`)),
    { shard },
  );
}

function complete(
  root: string,
  shard: RunShard,
  resultStatus: ShardCompletion["resultStatus"] = "passed",
) {
  return publishShardCompletion(root, RUN_ID, shard, {
    resultStatus,
    globalErrors: [],
    diagnostics: [],
  });
}

const SHARD_1 = { current: 1, total: 2 };
const SHARD_2 = { current: 2, total: 2 };

describe("sharded direct runs", () => {
  it("composes one frozen plan from every shard's fragment and finalizes the run once", async () => {
    const root = temporaryRoot();
    const [login, checkout] = await shardedCasePlans(root, ["login.desktop", "checkout.desktop"]);
    // Shard 1 holds the case that sorts last, so the composed order is not shard order.
    await publishPlanFragment(root, fragment(SHARD_1, [login!]));
    await publishPlanFragment(root, fragment(SHARD_2, [checkout!]));
    await publishPassingAttempt(root, login!, SHARD_1);
    await publishPassingAttempt(root, checkout!, SHARD_2);

    await complete(root, SHARD_1);
    const waiting = await finalizeShardedRun(root, RUN_ID);
    expect(waiting).toMatchObject({
      state: "waiting",
      total: 2,
      missing: [{ current: 2, total: 2, parts: ["completion"] }],
    });
    expect(fs.existsSync(planDir(root, RUN_ID))).toBe(false);
    expect(fs.existsSync(runRecordPath(root, RUN_ID))).toBe(false);

    await complete(root, SHARD_2);
    const finalized = await finalizeShardedRun(root, RUN_ID);
    expect(finalized).toMatchObject({ state: "finalized", record: { status: "finalized" } });

    const bundle = readRunBundle(root, RUN_ID);
    expect(bundle.plan).toEqual(
      buildDirectRunPlan({
        runId: RUN_ID,
        policyDigest: login!.policyDigest,
        retryAcceptance: "require-first-attempt",
        casePlans: [checkout!, login!],
      }),
    );
    expect(bundle.plan.selectedCases.map((entry) => entry.caseId)).toEqual([
      "checkout.desktop@chromium#0",
      "login.desktop@chromium#0",
    ]);
    expect(bundle.record.createdAt).toBe("2026-10-21T00:00:01.000Z");
    expect(bundle.record.cases.every((entry) => entry.selectedAttemptId !== undefined)).toBe(true);
    expect(readSelectedRun(root, RUN_ID).executionState).toBe("completed");

    // Finalized once: a later trigger (another shard, or `framelia runs finalize`) is a no-op.
    const before = fs.readFileSync(runRecordPath(root, RUN_ID), "utf8");
    expect(await finalizeShardedRun(root, RUN_ID)).toMatchObject({ state: "already-finalized" });
    expect(fs.readFileSync(runRecordPath(root, RUN_ID), "utf8")).toBe(before);
  });

  it("reports an un-composed sharded run as in progress to every reader", async () => {
    const root = temporaryRoot();
    const [login, checkout] = await shardedCasePlans(root, ["login.desktop", "checkout.desktop"]);
    await publishPlanFragment(root, fragment({ current: 1, total: 3 }, [login!]));
    await publishPlanFragment(root, fragment({ current: 3, total: 3 }, [checkout!]));
    await publishPassingAttempt(root, login!, { current: 1, total: 3 });
    await complete(root, { current: 1, total: 3 });

    let failure: unknown;
    try {
      readSelectedRun(root, RUN_ID);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(AppError);
    expect(failure).toMatchObject({ code: "RUN_BUNDLE_SHARDS_PENDING" });
    expect((failure as Error).message).toMatch(/shard 2\/3.*shard 3\/3/su);
    expect((failure as Error).message).toContain(`framelia runs finalize --run ${RUN_ID}`);

    expect(listRuns(root)).toMatchObject({
      invalid: [],
      runs: [
        {
          runId: RUN_ID,
          status: "running",
          terminal: false,
          createdAt: "2026-10-21T00:00:01.000Z",
          caseCount: 2,
          attemptCount: 1,
          selectedAttemptCount: 0,
          shards: { total: 3, completed: [1], missing: [2, 3] },
        },
      ],
    });
    expect(inspectShardedRun(root, RUN_ID)).toMatchObject({
      total: 3,
      missing: [
        { current: 2, total: 3, parts: ["plan", "completion"] },
        { current: 3, total: 3, parts: ["completion"] },
      ],
    });
  });

  it("finalizes with the worst shard result status and every shard's global errors", async () => {
    const root = temporaryRoot();
    const [login, checkout] = await shardedCasePlans(root, ["login.desktop", "checkout.desktop"]);
    await publishPlanFragment(root, fragment(SHARD_1, [login!]));
    await publishPlanFragment(root, fragment(SHARD_2, [checkout!]));
    await publishPassingAttempt(root, login!, SHARD_1);
    await complete(root, SHARD_1);
    await publishShardCompletion(root, RUN_ID, SHARD_2, {
      resultStatus: "timedout",
      globalErrors: ["global timeout reached"],
      diagnostics: [],
    });

    const result = await finalizeShardedRun(root, RUN_ID);

    expect(result.state).toBe("finalized");
    const record = readRunBundle(root, RUN_ID).record;
    expect(record.status).toBe("error");
    expect(record.diagnostics).toEqual(
      expect.arrayContaining([
        {
          code: "execution-global-error",
          stage: "execution",
          message: "shard 2/2: global timeout reached",
        },
        expect.objectContaining({ code: "execution-timedout" }),
        expect.objectContaining({ code: "selected-attempt-missing" }),
      ]),
    );
  });

  it("finalizes an interrupted shard without global errors as incomplete", async () => {
    const root = temporaryRoot();
    const [login] = await shardedCasePlans(root, ["login.desktop"]);
    await publishPlanFragment(root, fragment(SHARD_1, [login!]));
    await publishPlanFragment(root, fragment(SHARD_2, [], { policyDigest: login!.policyDigest }));
    await publishPassingAttempt(root, login!, SHARD_1);
    await complete(root, SHARD_1);
    await complete(root, SHARD_2, "interrupted");

    await finalizeShardedRun(root, RUN_ID);

    expect(readRunBundle(root, RUN_ID).record).toMatchObject({
      status: "incomplete",
      diagnostics: [expect.objectContaining({ code: "execution-interrupted" })],
    });
  });

  it("rejects a case planned by two shards, naming the case and both shards", async () => {
    const root = temporaryRoot();
    const [login] = await shardedCasePlans(root, ["login.desktop"]);
    await publishPlanFragment(root, fragment(SHARD_1, [login!]));
    await publishPlanFragment(root, fragment(SHARD_2, [login!]));
    await complete(root, SHARD_1);
    await complete(root, SHARD_2);

    await expect(finalizeShardedRun(root, RUN_ID)).rejects.toMatchObject({
      code: "RUN_BUNDLE_SHARD_CONFLICT",
      message: expect.stringMatching(/login\.desktop@chromium#0.*shard 1\/2.*shard 2\/2/su),
    });
    expect(fs.existsSync(planDir(root, RUN_ID))).toBe(false);
  });

  it("rejects shards that disagree on the shard total or the policy", async () => {
    const root = temporaryRoot();
    const [login, checkout] = await shardedCasePlans(root, ["login.desktop", "checkout.desktop"]);
    await publishPlanFragment(root, fragment(SHARD_1, [login!]));
    await publishPlanFragment(root, fragment({ current: 2, total: 3 }, [checkout!]));
    await expect(finalizeShardedRun(root, RUN_ID)).rejects.toMatchObject({
      code: "RUN_BUNDLE_SHARD_CONFLICT",
      message: expect.stringContaining("shard total"),
    });

    const other = temporaryRoot();
    const [otherLogin, otherCheckout] = await shardedCasePlans(other, [
      "login.desktop",
      "checkout.desktop",
    ]);
    const foreignPolicy = `sha256:${"b".repeat(64)}` as const;
    await publishPlanFragment(other, fragment(SHARD_1, [otherLogin!]));
    await publishPlanFragment(
      other,
      fragment(SHARD_2, [{ ...otherCheckout!, policyDigest: foreignPolicy }], {
        policyDigest: foreignPolicy,
      }),
    );
    await complete(other, SHARD_1);
    await complete(other, SHARD_2);
    await expect(finalizeShardedRun(other, RUN_ID)).rejects.toMatchObject({
      code: "RUN_BUNDLE_SHARD_CONFLICT",
      message: expect.stringContaining("policy"),
    });
  });

  it("rejects a plan fragment changed after its shard completed", async () => {
    const root = temporaryRoot();
    const [login, checkout] = await shardedCasePlans(root, ["login.desktop", "checkout.desktop"]);
    await publishPlanFragment(root, fragment(SHARD_1, [login!]));
    await publishPlanFragment(root, fragment(SHARD_2, [checkout!]));
    await complete(root, SHARD_1);
    await complete(root, SHARD_2);
    const fragmentPath = planFragmentPath(root, RUN_ID, SHARD_2);
    const tampered = JSON.parse(fs.readFileSync(fragmentPath, "utf8")) as RunPlanFragment;
    tampered.createdAt = "2026-10-21T00:00:09.000Z";
    fs.writeFileSync(fragmentPath, JSON.stringify(tampered));

    await expect(finalizeShardedRun(root, RUN_ID)).rejects.toMatchObject({
      code: "RUN_BUNDLE_DIGEST_MISMATCH",
    });
  });

  it("accepts a shard's attempts only for its own planned cases and only until it completed", async () => {
    const root = temporaryRoot();
    const [login, checkout] = await shardedCasePlans(root, ["login.desktop", "checkout.desktop"]);
    await publishPlanFragment(root, fragment(SHARD_1, [login!]));
    await publishPlanFragment(root, fragment(SHARD_2, [checkout!]));

    await expect(publishPassingAttempt(root, checkout!, SHARD_1)).rejects.toMatchObject({
      code: "RUN_BUNDLE_INVALID",
    });
    await expect(
      publishAttempt(
        root,
        RUN_ID,
        { ...attemptFixture(login!, 0), casePlanDigest: `sha256:${"c".repeat(64)}` },
        completeEvidence(Buffer.from("actual")),
        { shard: SHARD_1 },
      ),
    ).rejects.toMatchObject({ code: "RUN_BUNDLE_DIGEST_MISMATCH" });

    await complete(root, SHARD_1);
    await expect(publishPassingAttempt(root, login!, SHARD_1)).rejects.toMatchObject({
      code: "RUN_BUNDLE_INVALID",
      message: expect.stringContaining("already completed"),
    });
  });

  it("refuses a new plan fragment once the run was composed", async () => {
    const root = temporaryRoot();
    const [login, checkout] = await shardedCasePlans(root, ["login.desktop", "checkout.desktop"]);
    await publishPlanFragment(root, fragment({ current: 1, total: 1 }, [login!]));
    await complete(root, { current: 1, total: 1 });
    expect(await finalizeShardedRun(root, RUN_ID)).toMatchObject({ state: "finalized" });

    await expect(
      publishPlanFragment(root, fragment({ current: 1, total: 2 }, [checkout!])),
    ).rejects.toMatchObject({ code: "RUN_BUNDLE_INVALID" });
  });

  it("records nothing when no shard planned a case", async () => {
    const root = temporaryRoot();
    await shardedCasePlans(root, ["login.desktop"]);
    await publishPlanFragment(root, fragment(SHARD_1, []));
    await publishPlanFragment(root, fragment(SHARD_2, []));
    await complete(root, SHARD_1);
    await complete(root, SHARD_2);

    expect(await finalizeShardedRun(root, RUN_ID)).toMatchObject({ state: "empty", total: 2 });
    expect(fs.existsSync(planDir(root, RUN_ID))).toBe(false);
  });

  it("reports a run with no shard records as missing", async () => {
    const root = temporaryRoot();
    await expect(finalizeShardedRun(root, RUN_ID)).rejects.toMatchObject({
      code: "RUN_BUNDLE_MISSING",
    });
  });
});

describe("concurrent shard finalization", () => {
  const workerPath = fileURLToPath(new URL("./support/run-bundle-lock-worker.ts", import.meta.url));

  function runWorker(args: readonly string[]): Promise<{ code: number | null; output: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ["--conditions=framelia-dev", "--import", "tsx", workerPath, ...args],
        { env: process.env, stdio: ["ignore", "pipe", "pipe"] },
      );
      let output = "";
      child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
      child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
      child.on("error", reject);
      child.on("exit", (code) => resolve({ code, output }));
    });
  }

  it("finalizes exactly once when shards on one machine finish at the same time", async () => {
    const root = temporaryRoot();
    const casePlans = await shardedCasePlans(root, ["a.desktop", "b.desktop", "c.desktop"]);
    const shards = casePlans.map((_, index) => ({ current: index + 1, total: casePlans.length }));
    for (const [index, shard] of shards.entries()) {
      // eslint-disable-next-line no-await-in-loop -- set-up order is irrelevant to the race
      await publishPlanFragment(root, fragment(shard, [casePlans[index]!]));
      // eslint-disable-next-line no-await-in-loop -- set-up order is irrelevant to the race
      await publishPassingAttempt(root, casePlans[index]!, shard);
    }

    const results = await Promise.all(
      shards.map((shard) => runWorker(["complete-shard", root, RUN_ID, JSON.stringify({ shard })])),
    );

    for (const result of results)
      expect({ code: result.code, output: result.output }).toMatchObject({ code: 0 });
    const states = results.map((result) => JSON.parse(result.output.trim()).state as string);
    expect(states.filter((state) => state === "finalized")).toHaveLength(1);
    expect(
      states.every((state) => ["finalized", "already-finalized", "waiting"].includes(state)),
    ).toBe(true);
    const bundle = readRunBundle(root, RUN_ID);
    expect(bundle.record.status).toBe("finalized");
    expect(bundle.plan.selectedCases).toHaveLength(3);
    expect(canonicalJsonDigest(bundle.plan)).toBe(bundle.record.planDigest);
  }, 30_000);
});
