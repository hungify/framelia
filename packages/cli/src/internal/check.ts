import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from "node:child_process";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";

import {
  COLLECTION_FORMAT_VERSION,
  COMMAND_OUTCOME_FORMAT_VERSION,
  RUN_CONTEXT_FORMAT_VERSION,
  RUN_PLAN_FORMAT_VERSION,
  collectionManifestSchema,
  commandOutcomeSchema,
  runContextSchema,
  runPlanSchema,
  transportStatusSchema,
  type CollectedCase,
  type CollectionManifest,
  type CommandOutcome,
  type Diagnostic,
  type RunContext,
  type TransportStatus,
} from "@framelia/contracts/workflow";
import { canonicalJsonDigest, portableErrorMessage } from "@framelia/verify";
import {
  discoverAuthoredContracts,
  resolveContractProjectMatrix,
  resolveProjectPolicy,
  type ContractProjectCase,
} from "@framelia/verify/project-policy";
import {
  buildCasePlanForCollectedCase,
  casePlansDir,
  computeExecutionGraphDigest,
  finalizeRunRecord,
  freezeRunPlan,
  readSelectedRun,
  runDir,
  runPlanPath,
  startRunRecord,
  toProjectRelative,
} from "@framelia/verify/run-bundle";
import { nanoid } from "nanoid";

import type { CliRuntime } from "../runtime-types.ts";

const RUN_CONTEXT_ENV = "FRAMELIA_RUN_CONTEXT";
const AMBIGUOUS_TEST_LIST = /[\r\n›]/u;
const AMBIGUOUS_NAMED_PROJECT = /\[|\]/u;

export interface CheckRequest {
  contract: readonly string[];
  all?: boolean;
  project: readonly string[];
  runtime: CliRuntime;
}

interface ChildOutcome {
  code: number | null;
  signal: NodeJS.Signals | null;
  cancelled: boolean;
}

interface CancellationState {
  requested: boolean;
  forwarded: boolean;
  child?: ChildProcess;
}

export interface CheckDependencies {
  spawnPlaywright?: (
    executable: string,
    argv: readonly string[],
    options: { cwd: string; env: NodeJS.ProcessEnv },
  ) => ChildProcessWithoutNullStreams;
  signalProcess?: Pick<NodeJS.Process, "on" | "removeListener">;
  playwrightCli?: string;
  finalizeRun?: typeof finalizeRunRecord;
}

function diagnostic(code: string, stage: string, message: string): Diagnostic {
  return { code, stage, message };
}

function writePrivateJson(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(filePath, 0o600);
}

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function validateTransport<T>(
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
    input = readJson(filePath);
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

async function runChild(
  executable: string,
  argv: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  runtime: CliRuntime,
  dependencies: CheckDependencies,
  cancellation: CancellationState,
): Promise<ChildOutcome> {
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
    return await new Promise<ChildOutcome>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) =>
        resolve({ code, signal, cancelled: cancellation.requested }),
      );
    });
  } finally {
    if (cancellation.child === child) cancellation.child = undefined;
  }
}

function validateUnique(values: readonly string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`Duplicate ${label} ${JSON.stringify(value)}.`);
    seen.add(value);
  }
}

export function selectMatrix(
  matrix: readonly ContractProjectCase[],
  required: readonly ContractProjectCase[],
  request: CheckRequest,
  authoredIds: ReadonlySet<string>,
  configuredProjects: readonly string[],
): { selected: ContractProjectCase[]; selectedProjects: string[]; scope: "all" | "subset" } {
  if (request.all === true && request.contract.length > 0) {
    throw new Error(
      "Use exactly one selector form: --all or one-or-more --contract values, not both.",
    );
  }
  if (request.all !== true && request.contract.length === 0) {
    throw new Error("framelia check requires --all or one-or-more exact --contract values.");
  }
  validateUnique(request.contract, "contract id");
  validateUnique(request.project, "project name");
  for (const id of request.contract) {
    if (!authoredIds.has(id))
      throw new Error(`Unknown authored contract id ${JSON.stringify(id)}.`);
  }
  const configured = new Set(configuredProjects);
  for (const project of request.project) {
    if (!configured.has(project)) {
      throw new Error(`Unknown configured Playwright project ${JSON.stringify(project)}.`);
    }
  }
  const requestedIds = new Set(request.contract);
  let selected: ContractProjectCase[] = [
    ...(request.all === true
      ? required
      : matrix.filter((entry) => requestedIds.has(entry.contractId))),
  ];
  if (request.project.length > 0) {
    const narrowed = new Set(request.project);
    selected = selected.filter((entry) => narrowed.has(entry.project));
  }
  if (selected.length === 0)
    throw new Error("Selection contains zero contract/project visual cases.");
  const selectedProjects = [...new Set(selected.map((entry) => entry.project))];
  return {
    selected,
    selectedProjects,
    scope:
      request.all === true && request.project.length === 0 && selected.length === required.length
        ? "all"
        : "subset",
  };
}

export function reconcileSelectedCases(
  manifest: CollectionManifest,
  expected: readonly ContractProjectCase[],
): CollectedCase[] {
  const projects = new Map(manifest.projects.map((project) => [project.name, project]));
  const selected: CollectedCase[] = [];
  for (const matrixCase of expected) {
    const project = projects.get(matrixCase.project);
    if (!project) {
      throw new Error(`Collection omitted selected project ${JSON.stringify(matrixCase.project)}.`);
    }
    const candidates = manifest.visualCases.filter(
      (entry) =>
        entry.binding.contractId === matrixCase.contractId && entry.project === matrixCase.project,
    );
    const byRepeat = new Map<number, CollectedCase[]>();
    for (const candidate of candidates) {
      const entries = byRepeat.get(candidate.repeatIndex) ?? [];
      entries.push(candidate);
      byRepeat.set(candidate.repeatIndex, entries);
    }
    for (let repeatIndex = 0; repeatIndex < project.repeatEach; repeatIndex += 1) {
      const matches = byRepeat.get(repeatIndex) ?? [];
      if (matches.length !== 1) {
        throw new Error(
          `Selected binding ${matrixCase.contractId}/${JSON.stringify(matrixCase.project)}/repeat-${repeatIndex} matched ${matches.length} collected tests; expected exactly one.`,
        );
      }
      const collected = matches[0]!;
      if (
        collected.binding.contractFile !== matrixCase.contractFile ||
        collected.binding.contractDigest !== matrixCase.contractDigest
      ) {
        throw new Error(
          `Selected binding ${matrixCase.contractId}/${JSON.stringify(matrixCase.project)} was remapped to a different authored contract file or digest.`,
        );
      }
      selected.push(collected);
    }
    const indexes = [...byRepeat.keys()].toSorted((left, right) => left - right);
    if (
      indexes.length !== project.repeatEach ||
      indexes.some((repeatIndex, index) => repeatIndex !== index)
    ) {
      throw new Error(
        `Selected binding ${matrixCase.contractId}/${JSON.stringify(matrixCase.project)} has non-contiguous repeat slots; expected 0..${project.repeatEach - 1}.`,
      );
    }
  }
  if (selected.length === 0) throw new Error("Collection produced zero selected visual cases.");
  return selected;
}

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

function createContext(
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

function selectionResult(
  request: CheckRequest,
  selectedProjects: string[],
  selectedCaseIds: string[],
  fullRequiredCount: number,
  scope: "all" | "subset",
): NonNullable<CommandOutcome["selection"]> {
  return {
    requested:
      request.all === true
        ? { mode: "all" }
        : { mode: "contracts", contracts: [...request.contract] },
    selectedProjects,
    selectedCaseIds,
    fullRequiredCount,
    selectedCount: selectedCaseIds.length,
    scope,
  };
}

function errorOutcome(
  error: unknown,
  root: string,
  details: Partial<Pick<CommandOutcome, "runId" | "bundlePath" | "selection">> = {},
): CommandOutcome {
  const message = portableErrorMessage(error, root);
  const code = message.includes("FRAMELIA_REPORTER_MISSING")
    ? "FRAMELIA_REPORTER_MISSING"
    : "FRAMELIA_CHECK_FAILED";
  return commandOutcomeSchema.parse({
    formatVersion: COMMAND_OUTCOME_FORMAT_VERSION,
    kind: "framelia.command-outcome",
    command: "check",
    executionState: "error",
    visualVerdict: "not-evaluated",
    exitCode: 2,
    diagnostics: [diagnostic(code, "check", message)],
    ...details,
  });
}

/** Owns selection, collection transport, immutable planning, execution and sole finalization. */
export async function runCheck(
  request: CheckRequest,
  dependencies: CheckDependencies = {},
): Promise<CommandOutcome> {
  const cwd = path.resolve(request.runtime.cwd());
  let outcomeRoot = cwd;
  let temporaryDirectory: string | undefined;
  let runId: string | undefined;
  let bundlePath: string | undefined;
  let outcomeSelection: CommandOutcome["selection"];
  const cancellation: CancellationState = { requested: false, forwarded: false };
  const signalProcess = dependencies.signalProcess ?? process;
  const handleSignal = (): void => {
    if (cancellation.requested) {
      cancellation.child?.kill("SIGKILL");
      return;
    }
    cancellation.requested = true;
    if (cancellation.child) {
      cancellation.forwarded = true;
      cancellation.child.kill("SIGINT");
    }
  };
  signalProcess.on("SIGINT", handleSignal);
  signalProcess.on("SIGTERM", handleSignal);
  try {
    const policy = await resolveProjectPolicy({
      cwd,
      env: request.runtime.env,
    });
    outcomeRoot = policy.root;
    if (!policy.playwright || !policy.policyDigest) {
      throw new Error(
        "framelia.config must declare playwright.config and one-or-more visual projects before check can run.",
      );
    }
    const contracts = await discoverAuthoredContracts(policy);
    const matrix = resolveContractProjectMatrix(policy, contracts);
    const selection = selectMatrix(
      matrix.allCases,
      matrix.requiredCases,
      request,
      new Set(contracts.map((entry) => entry.contract.id)),
      policy.playwright.projects,
    );
    if (cancellation.requested)
      throw new Error("Check was cancelled before Playwright collection.");

    runId = nanoid();
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-check-"));
    fs.chmodSync(temporaryDirectory, 0o700);
    const playwrightCli = dependencies.playwrightCli ?? resolveLocalPlaywright(policy.root);
    const collectContext = createContext(
      "collect",
      policy.root,
      runId,
      policy.policyDigest,
      selection.selectedProjects,
      temporaryDirectory,
    );
    const collectContextPath = path.join(temporaryDirectory, "collect-context.json");
    writePrivateJson(collectContextPath, collectContext);
    const projectArgs = selection.selectedProjects.map((project) => `--project=${project}`);
    const collectOutcome = await runChild(
      process.execPath,
      [playwrightCli, "test", "--config", policy.playwright.configPath, "--list", ...projectArgs],
      policy.root,
      { ...request.runtime.env, [RUN_CONTEXT_ENV]: collectContextPath },
      request.runtime,
      dependencies,
      cancellation,
    );
    if (collectOutcome.cancelled) throw new Error("Playwright collection was cancelled.");
    const collectStatus = validateTransport(
      collectContext.statusPath,
      transportStatusSchema,
      "Framelia collection status",
    );
    assertTransportIdentity(collectStatus, collectContext, "Collection status");
    if (collectStatus.state !== "completed") {
      throw new Error(
        `Framelia collection reporter failed: ${collectStatus.diagnostics.map((entry) => entry.message).join("; ")}.`,
      );
    }
    const manifest = validateTransport(
      collectContext.manifestPath,
      collectionManifestSchema,
      "Framelia collection manifest",
    );
    assertTransportIdentity(manifest, collectContext, "Collection manifest");
    if (collectOutcome.code !== 0) {
      throw new Error(
        `Playwright collection exited ${collectOutcome.code ?? collectOutcome.signal ?? "without a status"}.`,
      );
    }
    if (cancellation.requested) throw new Error("Check was cancelled after Playwright collection.");

    const selectedCollected = reconcileSelectedCases(manifest, selection.selected);
    const casePlans = await Promise.all(
      selectedCollected.map((collected) =>
        buildCasePlanForCollectedCase(collected, {
          projectRoot: policy.root,
          runId: runId!,
          policy,
          source: {},
        }),
      ),
    );
    const plannedCases = casePlans.map((casePlan) => ({
      caseId: casePlan.caseId,
      casePlanDigest: canonicalJsonDigest(casePlan),
    }));
    const graphManifest = collectionManifestSchema.parse({
      ...manifest,
      formatVersion: COLLECTION_FORMAT_VERSION,
      visualCases: selectedCollected,
    });
    const fullSelection = selection.scope === "all";
    const plan = runPlanSchema.parse({
      formatVersion: RUN_PLAN_FORMAT_VERSION,
      kind: "framelia.run-plan",
      runId,
      policyDigest: policy.policyDigest,
      executionGraphDigest: computeExecutionGraphDigest(graphManifest),
      selection: {
        mode: fullSelection ? "all" : "subset",
        contracts:
          request.all === true
            ? [...new Set(selection.selected.map((entry) => entry.contractId))]
            : [...request.contract],
        ...(request.project.length > 0 ? { projects: [...request.project] } : {}),
      },
      availableMatrix: matrix.allCases,
      requiredMatrix: matrix.requiredCases,
      availableCases: plannedCases,
      requiredCases: fullSelection ? plannedCases : [],
      retryAcceptance: policy.retryAcceptance,
      selectedCases: plannedCases,
    });
    outcomeSelection = selectionResult(
      request,
      selection.selectedProjects,
      casePlans.map((entry) => entry.caseId),
      matrix.requiredCases.length,
      selection.scope,
    );
    freezeRunPlan(policy.root, plan, casePlans);
    startRunRecord(policy.root, plan, new Date().toISOString());
    bundlePath = toProjectRelative(policy.root, runDir(policy.root, runId));

    const finalizationDiagnostics: Diagnostic[] = [];
    let executeOutcome: ChildOutcome = {
      code: null,
      signal: null,
      cancelled: cancellation.requested,
    };
    let executeStatus: TransportStatus | undefined;
    let reporterCompleted = false;
    try {
      const testListPath = path.join(temporaryDirectory, "selected-tests.txt");
      fs.writeFileSync(testListPath, buildTestList(selectedCollected), { mode: 0o600 });
      const executeContext = createContext(
        "execute",
        policy.root,
        runId,
        policy.policyDigest,
        selection.selectedProjects,
        temporaryDirectory,
      );
      const executeContextPath = path.join(temporaryDirectory, "execute-context.json");
      writePrivateJson(executeContextPath, executeContext);
      executeOutcome = await runChild(
        process.execPath,
        [
          playwrightCli,
          "test",
          "--config",
          policy.playwright.configPath,
          "--test-list",
          testListPath,
          ...projectArgs,
        ],
        policy.root,
        { ...request.runtime.env, [RUN_CONTEXT_ENV]: executeContextPath },
        request.runtime,
        dependencies,
        cancellation,
      );
      executeStatus = validateTransport(
        executeContext.statusPath,
        transportStatusSchema,
        "Framelia execute status",
      );
      assertTransportIdentity(executeStatus, executeContext, "Execute status");
      const executeManifest = validateTransport(
        executeContext.manifestPath,
        collectionManifestSchema,
        "Framelia execute manifest",
      );
      assertTransportIdentity(executeManifest, executeContext, "Execute manifest");
      if (computeExecutionGraphDigest(executeManifest) !== plan.executionGraphDigest) {
        throw new Error(
          "Framelia execute manifest graph/tuple digest does not match the frozen collection plan.",
        );
      }
      reporterCompleted =
        executeStatus.state === "completed" && executeStatus.execution !== undefined;
      if (!reporterCompleted) {
        finalizationDiagnostics.push(
          diagnostic(
            "FRAMELIA_EXECUTION_BLOCKED",
            "execution",
            executeStatus.diagnostics.map((entry) => entry.message).join("; ") ||
              "Reporter did not publish a final completed execution lifecycle summary.",
          ),
        );
      }
      const execution = executeStatus.execution;
      if (execution) {
        for (const failure of execution.setupFailures) {
          finalizationDiagnostics.push(
            diagnostic("FRAMELIA_SETUP_FAILED", "execution", `Setup failed: ${failure}.`),
          );
        }
        for (const failure of execution.teardownFailures) {
          finalizationDiagnostics.push(
            diagnostic("FRAMELIA_TEARDOWN_FAILED", "execution", `Teardown failed: ${failure}.`),
          );
        }
        for (const failure of execution.globalErrors) {
          finalizationDiagnostics.push(diagnostic("FRAMELIA_GLOBAL_ERROR", "execution", failure));
        }
      }
    } catch (error) {
      finalizationDiagnostics.push(
        diagnostic(
          "FRAMELIA_EXECUTION_TRANSPORT",
          "execution",
          portableErrorMessage(error, policy.root),
        ),
      );
    } finally {
      await (dependencies.finalizeRun ?? finalizeRunRecord)(policy.root, runId, {
        retryAcceptance: policy.retryAcceptance,
        diagnostics: finalizationDiagnostics,
        transport: {
          exitCode: executeOutcome.code,
          signal: executeOutcome.signal,
          cancelled: executeOutcome.cancelled || cancellation.requested,
          reporterCompleted,
          ...(executeStatus?.execution
            ? { resultStatus: executeStatus.execution.resultStatus }
            : {}),
        },
      });
    }

    const selectedRun = readSelectedRun(policy.root, runId);
    const complete =
      reporterCompleted &&
      selectedRun.record.status === "finalized" &&
      selectedRun.executionState === "completed";
    const visualVerdict = selectedRun.visualVerdict;
    return commandOutcomeSchema.parse({
      formatVersion: COMMAND_OUTCOME_FORMAT_VERSION,
      kind: "framelia.command-outcome",
      command: "check",
      executionState: complete ? "completed" : "incomplete",
      visualVerdict,
      exitCode: complete ? (visualVerdict === "mismatched" ? 1 : 0) : 2,
      runId,
      bundlePath,
      diagnostics: selectedRun.record.diagnostics,
      selection: outcomeSelection,
      ...(!complete
        ? {
            next: {
              command: "framelia",
              argv: [
                "check",
                ...(request.all === true
                  ? ["--all"]
                  : request.contract.flatMap((id) => ["--contract", id])),
                ...request.project.flatMap((project) => ["--project", project]),
              ],
            },
          }
        : {}),
    });
  } catch (error) {
    return errorOutcome(error, outcomeRoot, {
      ...(bundlePath && runId ? { runId, bundlePath } : {}),
      ...(outcomeSelection ? { selection: outcomeSelection } : {}),
    });
  } finally {
    signalProcess.removeListener("SIGINT", handleSignal);
    signalProcess.removeListener("SIGTERM", handleSignal);
    if (temporaryDirectory) fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}
