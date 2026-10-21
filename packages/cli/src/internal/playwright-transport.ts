import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from "node:child_process";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";

import {
  RUN_CONTEXT_ENV,
  RUN_CONTEXT_FORMAT_VERSION,
  collectionManifestSchema,
  runContextSchema,
  transportStatusSchema,
  type CollectedCase,
  type CollectionManifest,
  type Diagnostic,
  type RunContext,
  type TransportStatus,
} from "@framelia/contracts/workflow";
import { portableErrorMessage } from "@framelia/verify";
import type { ResolvedProjectPolicy } from "@framelia/verify/project-policy";
import {
  casePlansDir,
  computeExecutionGraphDigest,
  runPlanPath,
} from "@framelia/verify/run-bundle";
import { nanoid } from "nanoid";

import type { CliRuntime } from "../runtime-types.ts";

const AMBIGUOUS_TEST_LIST = /[\r\n›]/u;
const AMBIGUOUS_NAMED_PROJECT = /\[|\]/u;

/** A transport failure whose `code` callers surface as-is instead of a generic failure. */
export class PlaywrightTransportError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "PlaywrightTransportError";
  }
}

export interface PlaywrightCancellation {
  requested: boolean;
  forwarded?: boolean;
  child?: ChildProcess;
}

export interface PlaywrightTransportDependencies {
  spawnPlaywright?: (
    executable: string,
    argv: readonly string[],
    options: { cwd: string; env: NodeJS.ProcessEnv },
  ) => ChildProcessWithoutNullStreams;
  playwrightCli?: string;
}

interface PlaywrightChildOutcome {
  code: number | null;
  signal: NodeJS.Signals | null;
  cancelled: boolean;
}

function writePrivateJson(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(filePath, 0o600);
}

function withPrivateDirectory<T>(
  prefix: string,
  use: (directory: string) => Promise<T>,
): Promise<T> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.chmodSync(directory, 0o700);
  return use(directory).finally(() => fs.rmSync(directory, { recursive: true, force: true }));
}

function validateTransport<T>(
  filePath: string,
  schema: {
    safeParse: (input: unknown) => { success: true; data: T } | { success: false; error: Error };
  },
  label: string,
): T {
  if (!fs.existsSync(filePath)) {
    throw new PlaywrightTransportError(
      "FRAMELIA_REPORTER_MISSING",
      `${label} was not published. Configure @framelia/playwright/reporter in Playwright's reporter list.`,
    );
  }
  let input: unknown;
  try {
    input = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${String(error)}`, { cause: error });
  }
  const result = schema.safeParse(input);
  if (!result.success) throw new Error(`${label} is incompatible: ${result.error.message}`);
  return result.data;
}

function assertTransportIdentity(
  record: { runId: string; projectRoot: string; policyDigest?: string; mode?: string },
  context: RunContext,
  label: string,
): void {
  if (
    record.runId !== context.runId ||
    record.projectRoot !== context.projectRoot ||
    (record.policyDigest !== undefined && record.policyDigest !== context.policyDigest) ||
    (record.mode !== undefined && record.mode !== context.mode)
  ) {
    throw new Error(
      `${label} run/root/policy/mode identity does not match its invocation context.`,
    );
  }
}

function resolveLocalPlaywright(projectRoot: string): string {
  const packageJson = path.join(projectRoot, "package.json");
  if (!fs.existsSync(packageJson)) {
    throw new Error(`Cannot resolve local Playwright without ${packageJson}.`);
  }
  try {
    return createRequire(packageJson).resolve("@playwright/test/cli");
  } catch (error) {
    throw new Error(
      `Cannot resolve the consumer project's local @playwright/test/cli from ${projectRoot}. Install @playwright/test in that project.`,
      { cause: error },
    );
  }
}

/** The Playwright policy a transport needs; collection and execution refuse to run without it. */
function requirePlaywright(policy: ResolvedProjectPolicy) {
  if (!policy.playwright || !policy.policyDigest) {
    throw new Error(
      "framelia.config must declare playwright.config and one-or-more visual projects before collection can run.",
    );
  }
  return { configPath: policy.playwright.configPath, policyDigest: policy.policyDigest };
}

async function runPlaywrightChild(options: {
  policy: ResolvedProjectPolicy;
  argv: readonly string[];
  contextPath: string;
  runtime: CliRuntime;
  dependencies: PlaywrightTransportDependencies;
  cancellation: PlaywrightCancellation;
}): Promise<PlaywrightChildOutcome> {
  const { policy, runtime, dependencies, cancellation } = options;
  const playwrightCli = dependencies.playwrightCli ?? resolveLocalPlaywright(policy.root);
  const argv = [playwrightCli, ...options.argv];
  const env = { ...runtime.env, [RUN_CONTEXT_ENV]: options.contextPath };
  const child = dependencies.spawnPlaywright
    ? dependencies.spawnPlaywright(process.execPath, argv, { cwd: policy.root, env })
    : spawn(process.execPath, argv, {
        cwd: policy.root,
        env,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
  cancellation.child = child;
  const stderr = runtime.stderr as unknown as NodeJS.WritableStream;
  child.stdout.pipe(stderr, { end: false });
  child.stderr.pipe(stderr, { end: false });
  if (cancellation.requested) {
    cancellation.forwarded = true;
    child.kill("SIGINT");
  }
  try {
    return await new Promise<PlaywrightChildOutcome>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) =>
        resolve({ code, signal, cancelled: cancellation.requested }),
      );
    });
  } finally {
    if (cancellation.child === child) cancellation.child = undefined;
  }
}

function createRunContext(
  mode: RunContext["mode"],
  root: string,
  runId: string,
  policyDigest: `sha256:${string}`,
  selectedProjects: readonly string[],
  directory: string,
): RunContext {
  return runContextSchema.parse({
    formatVersion: RUN_CONTEXT_FORMAT_VERSION,
    kind: "framelia.run-context",
    mode,
    projectRoot: root,
    runId,
    policyDigest,
    selectedProjects,
    manifestPath: path.join(directory, `${mode}-manifest.json`),
    statusPath: path.join(directory, `${mode}-status.json`),
    ...(mode === "execute"
      ? { planPath: runPlanPath(root, runId), casePlansPath: casePlansDir(root, runId) }
      : {}),
  });
}

function projectArgs(selectedProjects: readonly string[]): string[] {
  return selectedProjects.map((project) => `--project=${project}`);
}

/** Renders the Playwright `--test-list` file that selects exactly these collected cases. */
export function buildTestList(cases: readonly CollectedCase[]): string {
  const lines = new Map<string, string>();
  for (const collected of cases) {
    const segments = [collected.project, collected.testListFile, ...collected.testTitlePath];
    const ambiguous = segments.find((segment) => AMBIGUOUS_TEST_LIST.test(segment));
    if (ambiguous !== undefined) {
      throw new Error(
        `Playwright --test-list cannot safely represent project/file/title segment ${JSON.stringify(ambiguous)} because it contains CR, LF, or Unicode ›.`,
      );
    }
    if (collected.project !== "" && AMBIGUOUS_NAMED_PROJECT.test(collected.project)) {
      throw new Error(
        `Playwright --test-list cannot safely represent named project ${JSON.stringify(collected.project)} because it contains [ or ].`,
      );
    }
    const title = [collected.testListFile, ...collected.testTitlePath].join(" › ");
    const line = collected.project === "" ? title : `[${collected.project}] › ${title}`;
    const tuple = `${collected.binding.contractId}\u0000${collected.project}\u0000${collected.specFile}\u0000${collected.testTitlePath.join("\u0000")}`;
    const previous = lines.get(line);
    if (previous !== undefined && previous !== tuple) {
      throw new Error(
        `Two selected visual bindings collapse to the same --test-list line: ${line}.`,
      );
    }
    lines.set(line, tuple);
  }
  return `${[...lines.keys()].join("\n")}\n`;
}

export interface CollectPlaywrightBindingsOptions {
  policy: ResolvedProjectPolicy;
  selectedProjects: readonly string[];
  runtime: CliRuntime;
  runId?: string;
  dependencies?: PlaywrightTransportDependencies;
  cancellation?: PlaywrightCancellation;
}

/**
 * Runs the one safe local Playwright collect transport shared by check and contract list.
 * It only requests --list and the reporter's collect mode; it never executes tests,
 * captures evidence, starts a dashboard, or publishes a run bundle.
 */
export async function collectPlaywrightBindings(
  options: CollectPlaywrightBindingsOptions,
): Promise<CollectionManifest> {
  const playwright = requirePlaywright(options.policy);
  const cancellation = options.cancellation ?? { requested: false };
  return withPrivateDirectory("framelia-collect-", async (directory) => {
    const context = createRunContext(
      "collect",
      options.policy.root,
      options.runId ?? `collect-${nanoid()}`,
      playwright.policyDigest,
      options.selectedProjects,
      directory,
    );
    const contextPath = path.join(directory, "collect-context.json");
    writePrivateJson(contextPath, context);
    const child = await runPlaywrightChild({
      policy: options.policy,
      argv: [
        "test",
        "--config",
        playwright.configPath,
        "--list",
        ...projectArgs(options.selectedProjects),
      ],
      contextPath,
      runtime: options.runtime,
      dependencies: options.dependencies ?? {},
      cancellation,
    });
    if (child.cancelled) throw new Error("Playwright collection was cancelled.");
    if (!fs.existsSync(context.statusPath) && (child.signal !== null || child.code !== 0)) {
      const failure =
        child.signal !== null
          ? `was terminated by signal ${child.signal}`
          : `exited with code ${child.code}`;
      throw new Error(
        `Playwright collection ${failure} before the Framelia collection status was published. Review the Playwright output forwarded to stderr.`,
      );
    }
    const status = validateTransport(
      context.statusPath,
      transportStatusSchema,
      "Framelia collection status",
    );
    assertTransportIdentity(status, context, "Collection status");
    if (status.state !== "completed") {
      throw new Error(
        `Framelia collection reporter failed: ${status.diagnostics.map((entry) => entry.message).join("; ")}.`,
      );
    }
    const manifest = validateTransport(
      context.manifestPath,
      collectionManifestSchema,
      "Framelia collection manifest",
    );
    assertTransportIdentity(manifest, context, "Collection manifest");
    if (child.code !== 0) {
      throw new Error(
        `Playwright collection exited ${child.code ?? child.signal ?? "without a status"}.`,
      );
    }
    return manifest;
  });
}

export interface ExecutePlaywrightRunOptions {
  policy: ResolvedProjectPolicy;
  runId: string;
  selectedProjects: readonly string[];
  selectedCases: readonly CollectedCase[];
  /** The frozen plan's graph digest; the reporter's execute manifest must reproduce it. */
  executionGraphDigest: string;
  runtime: CliRuntime;
  dependencies?: PlaywrightTransportDependencies;
  cancellation: PlaywrightCancellation;
}

export interface PlaywrightExecution {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly cancelled: boolean;
  /** True only when the reporter published a completed lifecycle for the frozen graph. */
  readonly reporterCompleted: boolean;
  readonly resultStatus?: NonNullable<TransportStatus["execution"]>["resultStatus"];
  /** Everything that kept execution from being complete; never thrown. */
  readonly diagnostics: readonly Diagnostic[];
}

function diagnostic(code: string, message: string): Diagnostic {
  return { code, stage: "execution", message };
}

/**
 * Executes exactly the selected collected cases of a frozen run plan through the local
 * Playwright and the reporter's execute mode. Every transport failure becomes a
 * diagnostic so the caller can always finalize the run it already started.
 */
export async function executePlaywrightRun(
  options: ExecutePlaywrightRunOptions,
): Promise<PlaywrightExecution> {
  const { cancellation } = options;
  const diagnostics: Diagnostic[] = [];
  let child: PlaywrightChildOutcome = {
    code: null,
    signal: null,
    cancelled: cancellation.requested,
  };
  let status: TransportStatus | undefined;
  let reporterCompleted = false;
  try {
    const playwright = requirePlaywright(options.policy);
    await withPrivateDirectory("framelia-check-", async (directory) => {
      const testListPath = path.join(directory, "selected-tests.txt");
      fs.writeFileSync(testListPath, buildTestList(options.selectedCases), { mode: 0o600 });
      const context = createRunContext(
        "execute",
        options.policy.root,
        options.runId,
        playwright.policyDigest,
        options.selectedProjects,
        directory,
      );
      const contextPath = path.join(directory, "execute-context.json");
      writePrivateJson(contextPath, context);
      child = await runPlaywrightChild({
        policy: options.policy,
        argv: [
          "test",
          "--config",
          playwright.configPath,
          "--test-list",
          testListPath,
          ...projectArgs(options.selectedProjects),
        ],
        contextPath,
        runtime: options.runtime,
        dependencies: options.dependencies ?? {},
        cancellation,
      });
      status = validateTransport(
        context.statusPath,
        transportStatusSchema,
        "Framelia execute status",
      );
      assertTransportIdentity(status, context, "Execute status");
      const statusCompleted = status.state === "completed" && status.execution !== undefined;
      if (!statusCompleted) {
        diagnostics.push(
          diagnostic(
            "FRAMELIA_EXECUTION_BLOCKED",
            status.diagnostics.map((entry) => entry.message).join("; ") ||
              "Reporter did not publish a final completed execution lifecycle summary.",
          ),
        );
      }
      const manifest = validateTransport(
        context.manifestPath,
        collectionManifestSchema,
        "Framelia execute manifest",
      );
      assertTransportIdentity(manifest, context, "Execute manifest");
      if (computeExecutionGraphDigest(manifest) !== options.executionGraphDigest) {
        throw new Error(
          "Framelia execute manifest graph/tuple digest does not match the frozen collection plan.",
        );
      }
      reporterCompleted = statusCompleted;
      const execution = status.execution;
      if (execution) {
        for (const failure of execution.setupFailures) {
          diagnostics.push(diagnostic("FRAMELIA_SETUP_FAILED", `Setup failed: ${failure}.`));
        }
        for (const failure of execution.teardownFailures) {
          diagnostics.push(diagnostic("FRAMELIA_TEARDOWN_FAILED", `Teardown failed: ${failure}.`));
        }
        for (const failure of execution.globalErrors) {
          diagnostics.push(diagnostic("FRAMELIA_GLOBAL_ERROR", failure));
        }
      }
    });
  } catch (error) {
    diagnostics.push(
      diagnostic("FRAMELIA_EXECUTION_TRANSPORT", portableErrorMessage(error, options.policy.root)),
    );
  }
  const resultStatus = status?.execution?.resultStatus;
  return {
    exitCode: child.code,
    signal: child.signal,
    cancelled: child.cancelled || cancellation.requested,
    reporterCompleted,
    ...(resultStatus ? { resultStatus } : {}),
    diagnostics,
  };
}
