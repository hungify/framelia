import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from "node:child_process";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";

import {
  RUN_CONTEXT_FORMAT_VERSION,
  collectionManifestSchema,
  runContextSchema,
  transportStatusSchema,
  type CollectionManifest,
  type RunContext,
} from "@framelia/contracts/workflow";
import type { ResolvedProjectPolicy } from "@framelia/verify/project-policy";
import { casePlansDir, runPlanPath } from "@framelia/verify/run-bundle";
import { nanoid } from "nanoid";

import type { CliRuntime } from "../runtime-types.ts";

export const RUN_CONTEXT_ENV = "FRAMELIA_RUN_CONTEXT";

export interface PlaywrightChildOutcome {
  code: number | null;
  signal: NodeJS.Signals | null;
  cancelled: boolean;
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

export function writePrivateJson(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(filePath, 0o600);
}

export function validateTransport<T>(
  filePath: string,
  schema: {
    safeParse: (input: unknown) => { success: true; data: T } | { success: false; error: Error };
  },
  label: string,
): T {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `FRAMELIA_REPORTER_MISSING: ${label} was not published. Configure @framelia/playwright/reporter in Playwright's reporter list.`,
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

export function assertTransportIdentity(
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

export function resolveLocalPlaywright(projectRoot: string): string {
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

export async function runPlaywrightChild(
  executable: string,
  argv: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  runtime: CliRuntime,
  dependencies: PlaywrightTransportDependencies,
  cancellation: PlaywrightCancellation,
): Promise<PlaywrightChildOutcome> {
  const child = dependencies.spawnPlaywright
    ? dependencies.spawnPlaywright(executable, argv, { cwd, env })
    : spawn(executable, argv, { cwd, env, shell: false, stdio: ["ignore", "pipe", "pipe"] });
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

export function createRunContext(
  mode: RunContext["mode"],
  root: string,
  runId: string,
  policyDigest: `sha256:${string}`,
  selectedProjects: string[],
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

export interface CollectPlaywrightBindingsOptions {
  policy: ResolvedProjectPolicy;
  selectedProjects: string[];
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
  if (!options.policy.playwright || !options.policy.policyDigest) {
    throw new Error(
      "framelia.config must declare playwright.config and one-or-more visual projects before collection can run.",
    );
  }
  const dependencies = options.dependencies ?? {};
  const cancellation = options.cancellation ?? { requested: false };
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-collect-"));
  fs.chmodSync(temporaryDirectory, 0o700);
  try {
    const runId = options.runId ?? `collect-${nanoid()}`;
    const context = createRunContext(
      "collect",
      options.policy.root,
      runId,
      options.policy.policyDigest,
      options.selectedProjects,
      temporaryDirectory,
    );
    const contextPath = path.join(temporaryDirectory, "collect-context.json");
    writePrivateJson(contextPath, context);
    const playwrightCli = dependencies.playwrightCli ?? resolveLocalPlaywright(options.policy.root);
    const projectArgs = options.selectedProjects.map((project) => `--project=${project}`);
    const child = await runPlaywrightChild(
      process.execPath,
      [
        playwrightCli,
        "test",
        "--config",
        options.policy.playwright.configPath,
        "--list",
        ...projectArgs,
      ],
      options.policy.root,
      { ...options.runtime.env, [RUN_CONTEXT_ENV]: contextPath },
      options.runtime,
      dependencies,
      cancellation,
    );
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
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}
