import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import * as crypto from "node:crypto";
import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PassThrough } from "node:stream";

import {
  authoredContractSchema,
  baselineSnapshotSchema,
  type CollectionManifest,
  type RunContext,
} from "@framelia/contracts/workflow";
import { canonicalJsonDigest } from "@framelia/verify";
import { fileHash } from "@framelia/verify/project-policy";
import { finalizeRunRecord, readRunRecord } from "@framelia/verify/run-bundle";
import { afterEach, describe, expect, it } from "vitest";

import type { CommandEnvironment } from "../src/environment.ts";
import { runCheck } from "../src/internal/check.ts";
import type { PlaywrightTransportDependencies } from "../src/internal/playwright-transport.ts";
import type { CliRuntime } from "../src/runtime-types.ts";
import { testEnvironment } from "./test-environment.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function coordinatorProject(): {
  root: string;
  contractDigest: `sha256:${string}`;
  specDigest: `sha256:${string}`;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-check-coordinator-"));
  roots.push(root);
  fs.writeFileSync(
    path.join(root, "framelia.config.mjs"),
    'export default { playwright: { config: "playwright.config.ts", projects: ["chromium"] }, contracts: ["contracts/*.json"] };\n',
  );
  fs.writeFileSync(path.join(root, "playwright.config.ts"), "export default {};\n");
  const image = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAIAAAACUFjqAAAAH0lEQVR4nOTJQQ0AAAwCMbLMv+VDARig3z6g7FSttgEAAP//iF8rAQAAAAZJREFUAwCphQMUUAhjNAAAAABJRU5ErkJggg==",
    "base64",
  );
  const imageDigest = `sha256:${crypto.createHash("sha256").update(image).digest("hex")}` as const;
  fs.writeFileSync(path.join(root, "expected.png"), image);
  const snapshot = baselineSnapshotSchema.parse({
    formatVersion: 1,
    kind: "framelia.baseline-snapshot",
    source: { kind: "figma", fileKey: "fixture", nodeId: "1:2" },
    rendering: {
      viewport: { preset: "custom", width: 10, height: 10 },
      deviceScaleFactor: 1,
    },
    expected: {
      kind: "page",
      image: { path: "expected.png", digest: imageDigest, width: 10, height: 10 },
    },
  });
  const snapshotDigest = canonicalJsonDigest(snapshot);
  const snapshotDirectory = path.join(root, ".framelia", "baselines", snapshotDigest.slice(7));
  fs.mkdirSync(snapshotDirectory, { recursive: true });
  fs.writeFileSync(path.join(snapshotDirectory, "snapshot.json"), JSON.stringify(snapshot));
  const contract = authoredContractSchema.parse({
    formatVersion: 1,
    kind: "framelia.contract",
    id: "home.visual",
    name: "Home visual",
    revision: 1,
    target: { path: "/" },
    viewport: { preset: "custom", width: 10, height: 10 },
    scope: { kind: "page", pageReason: "coordinator fixture" },
    baseline: { snapshotDigest },
    required: true,
  });
  fs.mkdirSync(path.join(root, "contracts"), { recursive: true });
  fs.writeFileSync(path.join(root, "contracts", "home.json"), JSON.stringify(contract));
  fs.mkdirSync(path.join(root, "tests"), { recursive: true });
  const specPath = path.join(root, "tests", "visual.spec.ts");
  fs.writeFileSync(specPath, "// visual fixture\n");
  return {
    root,
    contractDigest: canonicalJsonDigest(contract) as `sha256:${string}`,
    specDigest: fileHash(specPath) as `sha256:${string}`,
  };
}

function runtime(root: string): CliRuntime {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  stdout.resume();
  stderr.resume();
  return {
    cwd: () => root,
    env: {},
    stdin: process.stdin,
    stdout,
    stderr,
    exitCode: undefined,
  };
}

function manifestFor(
  context: RunContext,
  contractDigest: `sha256:${string}`,
  specDigest: `sha256:${string}`,
): CollectionManifest {
  const runtimeDigest = `sha256:${"b".repeat(64)}` as const;
  return {
    formatVersion: 2,
    kind: "framelia.collection",
    runId: context.runId,
    projectRoot: context.projectRoot,
    policyDigest: context.policyDigest,
    projects: [
      {
        name: "chromium",
        runtimeDigest,
        dependencies: [],
        repeatEach: 1,
        retries: 0,
        testDir: "tests",
      },
    ],
    visualCases: [
      {
        formatVersion: 1,
        kind: "framelia.collected-case",
        binding: {
          formatVersion: 1,
          kind: "framelia.contract-binding",
          contractId: "home.visual",
          contractFile: "contracts/home.json",
          contractDigest,
        },
        project: "chromium",
        projectRuntimeDigest: runtimeDigest,
        specFile: "tests/visual.spec.ts",
        testListFile: "visual.spec.ts",
        specFileDigest: specDigest,
        location: { line: 1, column: 0 },
        testTitlePath: ["case"],
        repeatIndex: 0,
      },
    ],
    setupCases: [],
  };
}

function writeJson(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(value));
}

function collectionTransport(
  context: RunContext,
  contractDigest: `sha256:${string}`,
  specDigest: `sha256:${string}`,
): void {
  writeJson(context.manifestPath, manifestFor(context, contractDigest, specDigest));
  writeJson(context.statusPath, {
    formatVersion: 1,
    kind: "framelia.transport-status",
    writerVersion: "test",
    phase: "collection",
    mode: "collect",
    projectRoot: context.projectRoot,
    runId: context.runId,
    state: "completed",
    diagnostics: [],
  });
}

function immediateChild(): ChildProcessWithoutNullStreams {
  return spawn(process.execPath, ["-e", ""], { stdio: ["pipe", "pipe", "pipe"] });
}

const failedCollectionChild: NonNullable<PlaywrightTransportDependencies["spawnPlaywright"]> = (
  _executable,
  _argv,
  options,
) =>
  spawn(
    process.execPath,
    ["-e", 'process.stderr.write("playwright config exploded\\n"); process.exitCode = 7;'],
    {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

describe("runCheck command-lifetime finalization", () => {
  it("reports a failed collection child before diagnosing a missing reporter", async () => {
    const fixture = coordinatorProject();
    const spawnPlaywright = failedCollectionChild;

    const outcome = await runCheck(
      { contract: [], all: true, project: [] },
      testEnvironment(runtime(fixture.root), {
        playwright: { playwrightCli: "/unused/local/playwright-cli.js", spawnPlaywright },
      }),
    );

    expect(outcome.exitCode).toBe(2);
    expect(outcome.diagnostics).toContainEqual({
      code: "FRAMELIA_CHECK_FAILED",
      stage: "check",
      message:
        "Playwright collection exited with code 7 before the Framelia collection status was published. Review the Playwright output forwarded to stderr.",
    });
  });

  it("preserves the missing-reporter preflight when collection exits cleanly without publishing", async () => {
    const fixture = coordinatorProject();

    const outcome = await runCheck(
      { contract: [], all: true, project: [] },
      testEnvironment(runtime(fixture.root), {
        playwright: {
          playwrightCli: "/unused/local/playwright-cli.js",
          spawnPlaywright: immediateChild,
        },
      }),
    );

    expect(outcome.exitCode).toBe(2);
    expect(outcome.diagnostics[0]?.code).toBe("FRAMELIA_REPORTER_MISSING");
    expect(outcome.diagnostics[0]?.message).toContain(
      "Framelia collection status was not published",
    );
  });

  it("retains the reporter's blocked reason when execute manifest validation fails later", async () => {
    const fixture = coordinatorProject();
    const reporterReason = "Visual project setup failed before any selected test could run.";
    const spawnPlaywright: NonNullable<PlaywrightTransportDependencies["spawnPlaywright"]> = (
      _executable,
      _argv,
      options,
    ) => {
      const context = JSON.parse(
        fs.readFileSync(options.env.FRAMELIA_RUN_CONTEXT!, "utf8"),
      ) as RunContext;
      if (context.mode === "collect") {
        collectionTransport(context, fixture.contractDigest, fixture.specDigest);
      } else {
        writeJson(context.statusPath, {
          formatVersion: 1,
          kind: "framelia.transport-status",
          writerVersion: "test",
          phase: "execution-reconciliation",
          mode: "execute",
          projectRoot: context.projectRoot,
          runId: context.runId,
          state: "blocked",
          diagnostics: [{ code: "fixture-setup-failed", message: reporterReason }],
        });
      }
      return immediateChild();
    };

    const outcome = await runCheck(
      { contract: [], all: true, project: [] },
      testEnvironment(runtime(fixture.root), {
        playwright: { playwrightCli: "/unused/local/playwright-cli.js", spawnPlaywright },
      }),
    );

    expect(outcome.exitCode).toBe(2);
    expect(outcome.executionState).toBe("incomplete");
    expect(outcome.diagnostics).toContainEqual({
      code: "FRAMELIA_EXECUTION_BLOCKED",
      stage: "execution",
      message: reporterReason,
    });
    expect(readRunRecord(fixture.root, outcome.runId!).diagnostics).toContainEqual({
      code: "FRAMELIA_EXECUTION_BLOCKED",
      stage: "execution",
      message: reporterReason,
    });
  });
  it("forwards cancellation to the active execute child and terminalizes exactly once", async () => {
    const fixture = coordinatorProject();
    const signals = new EventEmitter();
    const forwarded: NodeJS.Signals[] = [];
    let invocation = 0;
    const finalizeCalls: string[] = [];
    const finalizeRun: typeof finalizeRunRecord = async (root, runId, options) => {
      finalizeCalls.push(runId);
      return finalizeRunRecord(root, runId, options);
    };
    const spawnPlaywright: NonNullable<PlaywrightTransportDependencies["spawnPlaywright"]> = (
      _executable,
      _argv,
      options,
    ) => {
      invocation += 1;
      const contextPath = options.env.FRAMELIA_RUN_CONTEXT!;
      const context = JSON.parse(fs.readFileSync(contextPath, "utf8")) as RunContext;
      if (context.mode === "collect") {
        collectionTransport(context, fixture.contractDigest, fixture.specDigest);
        return immediateChild();
      }
      const child = spawn(process.execPath, ["-e", "process.stdin.resume()"], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      const kill = child.kill.bind(child);
      child.kill = ((signal?: NodeJS.Signals | number) => {
        if (typeof signal === "string") forwarded.push(signal);
        return kill(signal);
      }) as typeof child.kill;
      setImmediate(() => signals.emit("SIGTERM"));
      return child;
    };

    const outcome = await runCheck(
      { contract: [], all: true, project: [] },
      testEnvironment(
        runtime(fixture.root),
        { playwright: { playwrightCli: "/unused/local/playwright-cli.js", spawnPlaywright } },
        { signals: signals as unknown as CommandEnvironment["signals"] },
      ),
      { finalizeRun },
    );

    expect(invocation).toBe(2);
    expect(forwarded[0]).toBe("SIGINT");
    expect(finalizeCalls).toHaveLength(1);
    expect(outcome.runId).toBe(finalizeCalls[0]);
    expect(outcome.bundlePath).toBeDefined();
    expect(outcome.executionState).toBe("incomplete");
    const record = readRunRecord(fixture.root, outcome.runId!);
    expect(record.status).toBe("error");
    expect(record.diagnostics.map((entry) => entry.code)).toEqual(
      expect.arrayContaining([
        "execution-cancelled",
        "FRAMELIA_EXECUTION_TRANSPORT",
        "selected-attempt-missing",
      ]),
    );
  });

  it("rejects a stale execute status after child close and still performs one terminal finalization", async () => {
    const fixture = coordinatorProject();
    const finalizeCalls: string[] = [];
    const finalizeRun: typeof finalizeRunRecord = async (root, runId, options) => {
      finalizeCalls.push(runId);
      return finalizeRunRecord(root, runId, options);
    };
    const spawnPlaywright: NonNullable<PlaywrightTransportDependencies["spawnPlaywright"]> = (
      _executable,
      _argv,
      options,
    ) => {
      const context = JSON.parse(
        fs.readFileSync(options.env.FRAMELIA_RUN_CONTEXT!, "utf8"),
      ) as RunContext;
      if (context.mode === "collect") {
        collectionTransport(context, fixture.contractDigest, fixture.specDigest);
      } else {
        writeJson(
          context.manifestPath,
          manifestFor(context, fixture.contractDigest, fixture.specDigest),
        );
        writeJson(context.statusPath, {
          formatVersion: 1,
          kind: "framelia.transport-status",
          writerVersion: "test",
          phase: "execution-reconciliation",
          mode: "execute",
          projectRoot: context.projectRoot,
          runId: "stale-run",
          state: "completed",
          diagnostics: [],
          execution: {
            resultStatus: "passed",
            setupFailures: [],
            teardownFailures: [],
            globalErrors: [],
          },
        });
      }
      return immediateChild();
    };

    const outcome = await runCheck(
      { contract: [], all: true, project: [] },
      testEnvironment(runtime(fixture.root), {
        playwright: { playwrightCli: "/unused/local/playwright-cli.js", spawnPlaywright },
      }),
      { finalizeRun },
    );

    expect(finalizeCalls).toHaveLength(1);
    expect(outcome.runId).toBe(finalizeCalls[0]);
    expect(outcome.diagnostics.map((entry) => entry.code)).toContain(
      "FRAMELIA_EXECUTION_TRANSPORT",
    );
    expect(readRunRecord(fixture.root, outcome.runId!).status).toBe("error");
  });
});

describe("runCheck failure codes and follow-ups", () => {
  it("reports an unknown contract id with its own code and points at contract list", async () => {
    const fixture = coordinatorProject();
    const outcome = await runCheck(
      { contract: ["missing.visual"], project: [], projectRoot: fixture.root },
      testEnvironment(runtime(fixture.root)),
    );
    expect(outcome.exitCode).toBe(2);
    expect(outcome.diagnostics[0]?.code).toBe("UNKNOWN_CONTRACT_ID");
    expect(outcome.next).toEqual({
      command: "framelia",
      argv: ["contract", "list", "--project-root", fixture.root],
    });
  });

  it("points a missing reporter at init", async () => {
    const fixture = coordinatorProject();
    const outcome = await runCheck(
      { contract: [], all: true, project: [] },
      testEnvironment(runtime(fixture.root), {
        playwright: {
          playwrightCli: "/unused/local/playwright-cli.js",
          spawnPlaywright: immediateChild,
        },
      }),
    );
    expect(outcome.diagnostics[0]?.code).toBe("FRAMELIA_REPORTER_MISSING");
    expect(outcome.next).toEqual({ command: "framelia", argv: ["init"] });
  });

  it("keeps an invalid project config's own code instead of FRAMELIA_CHECK_FAILED", async () => {
    const fixture = coordinatorProject();
    fs.writeFileSync(
      path.join(fixture.root, "framelia.config.mjs"),
      "export default { totallyMadeUpOption: true };\n",
    );
    const outcome = await runCheck(
      { contract: [], all: true, project: [] },
      testEnvironment(runtime(fixture.root)),
    );
    expect(outcome.diagnostics[0]?.code).toBe("INVALID_PROJECT_CONFIG");
    expect(outcome.next).toEqual({ command: "framelia", argv: ["status"] });
  });
});

describe("runCheck interrupts", () => {
  it("exits on a second interrupt while no Playwright child is running", async () => {
    const fixture = coordinatorProject();
    const signals = new EventEmitter();
    const exits: number[] = [];
    const pending = runCheck(
      { contract: [], all: true, project: [] },
      testEnvironment(
        runtime(fixture.root),
        {},
        {
          signals: signals as unknown as CommandEnvironment["signals"],
          exit: (code) => void exits.push(code),
        },
      ),
    );
    signals.emit("SIGINT");
    expect(exits).toEqual([]);
    signals.emit("SIGINT");
    expect(exits).toEqual([2]);
    const outcome = await pending;
    expect(outcome.diagnostics[0]?.code).toBe("CHECK_CANCELLED");
  });

  it.runIf(process.platform !== "win32")(
    "forwards SIGINT first, then SIGTERM, never SIGKILL while the child stops gracefully",
    async () => {
      const fixture = coordinatorProject();
      const signals = new EventEmitter();
      const sent: NodeJS.Signals[] = [];
      const spawnPlaywright: NonNullable<PlaywrightTransportDependencies["spawnPlaywright"]> = (
        _executable,
        _argv,
        options,
      ) => {
        const context = JSON.parse(
          fs.readFileSync(options.env.FRAMELIA_RUN_CONTEXT!, "utf8"),
        ) as RunContext;
        if (context.mode === "collect") {
          collectionTransport(context, fixture.contractDigest, fixture.specDigest);
          return immediateChild();
        }
        // Ignores SIGINT (like a Playwright run still tearing down) but stops on SIGTERM.
        const child = spawn(
          process.execPath,
          [
            "-e",
            'process.on("SIGINT", () => {}); process.stdout.write("ready\\n"); setInterval(() => {}, 1000);',
          ],
          { stdio: ["pipe", "pipe", "pipe"] },
        );
        const kill = child.kill.bind(child);
        child.kill = ((signal?: NodeJS.Signals | number) => {
          if (typeof signal === "string") sent.push(signal);
          return kill(signal);
        }) as typeof child.kill;
        child.stdout.once("data", () => {
          signals.emit("SIGINT");
          setTimeout(() => signals.emit("SIGINT"), 100);
        });
        return child;
      };

      const outcome = await runCheck(
        { contract: [], all: true, project: [] },
        testEnvironment(
          runtime(fixture.root),
          { playwright: { playwrightCli: "/unused/local/playwright-cli.js", spawnPlaywright } },
          { signals: signals as unknown as CommandEnvironment["signals"] },
        ),
      );

      expect(sent).toEqual(["SIGINT", "SIGTERM"]);
      expect(outcome.executionState).toBe("incomplete");
      expect(outcome.runId).toBeDefined();
    },
  );
});

describe("runCheck run ID export", () => {
  it("writes --run-id-file and appends run-id to $GITHUB_OUTPUT once the run starts", async () => {
    const fixture = coordinatorProject();
    const githubOutput = path.join(fixture.root, "github-output.txt");
    fs.writeFileSync(githubOutput, "existing=1\n");
    const spawnPlaywright: NonNullable<PlaywrightTransportDependencies["spawnPlaywright"]> = (
      _executable,
      _argv,
      options,
    ) => {
      const context = JSON.parse(
        fs.readFileSync(options.env.FRAMELIA_RUN_CONTEXT!, "utf8"),
      ) as RunContext;
      if (context.mode === "collect") {
        collectionTransport(context, fixture.contractDigest, fixture.specDigest);
      }
      return immediateChild();
    };
    const processRuntime = { ...runtime(fixture.root), env: { GITHUB_OUTPUT: githubOutput } };

    const outcome = await runCheck(
      { contract: [], all: true, project: [], runIdFile: "run-id.txt" },
      testEnvironment(processRuntime, {
        playwright: { playwrightCli: "/unused/local/playwright-cli.js", spawnPlaywright },
      }),
    );

    expect(outcome.runId).toBeDefined();
    expect(fs.readFileSync(path.join(fixture.root, "run-id.txt"), "utf8")).toBe(
      `${outcome.runId}\n`,
    );
    expect(fs.readFileSync(githubOutput, "utf8")).toBe(`existing=1\nrun-id=${outcome.runId}\n`);
  });
});
