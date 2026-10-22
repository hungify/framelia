import * as fs from "node:fs";
import * as path from "node:path";

import {
  COLLECTION_FORMAT_VERSION,
  COMMAND_OUTCOME_FORMAT_VERSION,
  RUN_PLAN_FORMAT_VERSION,
  collectionManifestSchema,
  commandOutcomeSchema,
  runPlanSchema,
  type CasePlan,
  type CollectedCase,
  type CollectionManifest,
  type CommandOutcome,
  type RunPlan,
  type RunProjection,
} from "@framelia/contracts/workflow";
import { EXIT_USAGE_ERROR, canonicalJsonDigest, portableErrorMessage } from "@framelia/verify";
import {
  discoverAuthoredContracts,
  resolveContractProjectMatrix,
  type ContractProjectCase,
  type ResolvedProjectPolicy,
} from "@framelia/verify/project-policy";
import {
  buildCasePlanForCollectedCase,
  computeExecutionGraphDigest,
  finalizeRunRecord,
  freezeRunPlan,
  runDir,
  startRunRecord,
  toProjectRelative,
} from "@framelia/verify/run-bundle";
import { nanoid } from "nanoid";

import type { CommandEnvironment } from "../environment.ts";
import { UsageError } from "../exit.ts";
import type { CliRuntime } from "../runtime-types.ts";
import { reconcileBinding } from "./binding-reconciliation.ts";
import { createInterruptHandler } from "./interrupt.ts";
import { failureDiagnostic, frameliaNext, nextForFailureCode, runExitCode } from "./outcome.ts";
import {
  collectPlaywrightBindings,
  executePlaywrightRun,
  type PlaywrightCancellation,
  type PlaywrightExecution,
} from "./playwright-transport.ts";
import { openProject } from "./project.ts";
import { nextForRun, readRunProjection } from "./run-projection.ts";

export interface CheckRequest {
  contract: readonly string[];
  all?: boolean;
  project: readonly string[];
  projectRoot?: string;
  /** File that receives the durable run ID as soon as the run starts. */
  runIdFile?: string;
}

/** Test seam: replaces run finalization to observe or fail it. */
export interface CheckSeams {
  finalizeRun?: typeof finalizeRunRecord;
}

function selectionError(code: string, message: string): UsageError {
  return new UsageError(message, { code });
}

function validateUnique(values: readonly string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throw selectionError(
        "CHECK_SELECTION_INVALID",
        `Duplicate ${label} ${JSON.stringify(value)}.`,
      );
    }
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
    throw selectionError(
      "CHECK_SELECTION_INVALID",
      "Use exactly one selector form: --all or one-or-more --contract values, not both.",
    );
  }
  if (request.all !== true && request.contract.length === 0) {
    throw selectionError(
      "CHECK_SELECTION_INVALID",
      "framelia check requires --all or one-or-more exact --contract values.",
    );
  }
  validateUnique(request.contract, "contract id");
  validateUnique(request.project, "project name");
  for (const id of request.contract) {
    if (!authoredIds.has(id)) {
      throw selectionError(
        "UNKNOWN_CONTRACT_ID",
        `Unknown authored contract id ${JSON.stringify(id)}.`,
      );
    }
  }
  const configured = new Set(configuredProjects);
  for (const project of request.project) {
    if (!configured.has(project)) {
      throw selectionError(
        "UNKNOWN_PLAYWRIGHT_PROJECT",
        `Unknown configured Playwright project ${JSON.stringify(project)}.`,
      );
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
  if (selected.length === 0) {
    throw selectionError(
      "CHECK_SELECTION_EMPTY",
      "Selection contains zero contract/project visual cases.",
    );
  }
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
  const selected: CollectedCase[] = [];
  for (const matrixCase of expected) {
    const label = `${matrixCase.contractId}/${JSON.stringify(matrixCase.project)}`;
    const binding = reconcileBinding(manifest, matrixCase);
    switch (binding.status) {
      case "executable":
        selected.push(...binding.cases);
        break;
      case "project-missing":
        throw new UsageError(
          `Collection omitted selected project ${JSON.stringify(matrixCase.project)}.`,
          { code: "CONTRACT_UNBOUND" },
        );
      case "unbound":
        throw new UsageError(
          `Selected binding ${label} matched 0 collected tests; expected exactly one.`,
          { code: "CONTRACT_UNBOUND" },
        );
      case "duplicate":
        throw new UsageError(
          `Selected binding ${label}/repeat-${binding.repeatIndex} matched ${binding.matched} collected tests; expected exactly one.`,
          { code: "DUPLICATE_CONTRACT_BINDING" },
        );
      case "stale":
        throw new UsageError(
          binding.reason === "identity"
            ? `Selected binding ${label} was remapped to a different authored contract file or digest.`
            : `Selected binding ${label} has non-contiguous repeat slots; expected exactly one per slot.`,
          { code: "STALE_CONTRACT_BINDING" },
        );
    }
  }
  if (selected.length === 0) {
    throw new UsageError("Collection produced zero selected visual cases.", {
      code: "CHECK_SELECTION_EMPTY",
    });
  }
  return selected;
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
  request: CheckRequest,
  details: Partial<Pick<CommandOutcome, "runId" | "bundlePath" | "selection">> = {},
): CommandOutcome {
  const failure = failureDiagnostic(
    error,
    "FRAMELIA_CHECK_FAILED",
    "check",
    portableErrorMessage(error, root),
  );
  const next =
    nextForFailureCode(failure.code, request.projectRoot) ??
    (details.runId
      ? frameliaNext(["open", "--run", details.runId], request.projectRoot)
      : undefined);
  return commandOutcomeSchema.parse({
    formatVersion: COMMAND_OUTCOME_FORMAT_VERSION,
    kind: "framelia.command-outcome",
    command: "check",
    executionState: "error",
    visualVerdict: "not-evaluated",
    exitCode: EXIT_USAGE_ERROR,
    diagnostics: [failure],
    ...details,
    ...(next ? { next } : {}),
  });
}

/**
 * Hands the durable run ID to CI before execution starts: `--run-id-file` receives it alone,
 * and GitHub Actions' `$GITHUB_OUTPUT` (when set) receives a `run-id=<id>` step output.
 */
function exportRunId(runId: string, request: CheckRequest, runtime: CliRuntime): void {
  try {
    if (request.runIdFile) {
      fs.writeFileSync(path.resolve(runtime.cwd(), request.runIdFile), `${runId}\n`);
    }
    const githubOutput = runtime.env.GITHUB_OUTPUT;
    if (githubOutput) fs.appendFileSync(githubOutput, `run-id=${runId}\n`);
  } catch (error) {
    throw new UsageError(
      `Could not export run ID ${runId}: ${error instanceof Error ? error.message : String(error)}`,
      { code: "RUN_ID_EXPORT_FAILED", cause: error },
    );
  }
}

/**
 * Binds the selection to the tests Playwright collected and builds what gets frozen: one
 * case plan per selected case, and the run plan that names them. Nothing is written here.
 */
async function planCheckRun(input: {
  policy: ResolvedProjectPolicy;
  policyDigest: string;
  matrix: ReturnType<typeof resolveContractProjectMatrix>;
  selection: ReturnType<typeof selectMatrix>;
  manifest: CollectionManifest;
  request: CheckRequest;
  runId: string;
}): Promise<{ selectedCollected: CollectedCase[]; casePlans: CasePlan[]; plan: RunPlan }> {
  const { policy, matrix, selection, manifest, request, runId } = input;
  const selectedCollected = reconcileSelectedCases(manifest, selection.selected);
  const casePlans = await Promise.all(
    selectedCollected.map((collected) =>
      buildCasePlanForCollectedCase(collected, {
        projectRoot: policy.root,
        runId,
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
    policyDigest: input.policyDigest,
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
  return { selectedCollected, casePlans, plan };
}

/** The outcome of a run that was planned, executed and finalized, read back from its bundle. */
function runOutcome(input: {
  request: CheckRequest;
  runId: string;
  bundlePath: string;
  selection: CommandOutcome["selection"];
  execution: PlaywrightExecution;
  projection: RunProjection;
}): CommandOutcome {
  const { request, execution, projection } = input;
  const complete = execution.reporterCompleted && projection.executionState === "completed";
  const visualVerdict = projection.visualVerdict;
  return commandOutcomeSchema.parse({
    formatVersion: COMMAND_OUTCOME_FORMAT_VERSION,
    kind: "framelia.command-outcome",
    command: "check",
    executionState: complete ? "completed" : "incomplete",
    visualVerdict,
    exitCode: runExitCode(complete, visualVerdict),
    runId: input.runId,
    bundlePath: input.bundlePath,
    diagnostics: projection.diagnostics,
    selection: input.selection,
    coverage: projection.selection,
    cases: projection.cases,
    ...(complete && visualVerdict === "passed"
      ? {}
      : { next: nextForRun(projection, request.projectRoot) }),
  });
}

/** Owns selection, collection transport, immutable planning, execution and sole finalization. */
export async function runCheck(
  request: CheckRequest,
  env: CommandEnvironment,
  seams: CheckSeams = {},
): Promise<CommandOutcome> {
  const runtime = env.process;
  const cwd = path.resolve(runtime.cwd());
  let outcomeRoot = cwd;
  let runId: string | undefined;
  let bundlePath: string | undefined;
  let outcomeSelection: CommandOutcome["selection"];
  const cancellation: PlaywrightCancellation = { requested: false, forwarded: false };
  const signalProcess = env.signals;
  const handleSignal = createInterruptHandler({
    cancellation,
    platform: env.platform,
    exit: env.exit,
  });
  signalProcess.on("SIGINT", handleSignal);
  signalProcess.on("SIGTERM", handleSignal);
  try {
    const policy = await openProject(request.projectRoot, runtime).loadConfig();
    outcomeRoot = policy.root;
    if (!policy.playwright || !policy.policyDigest) {
      throw new UsageError(
        "framelia.config must declare playwright.config and one-or-more visual projects before check can run.",
        { code: "PROJECT_POLICY_INCOMPLETE" },
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
    if (cancellation.requested) {
      throw new UsageError("Check was cancelled before Playwright collection.", {
        code: "CHECK_CANCELLED",
      });
    }

    runId = nanoid();
    const playwright = await env.adapters.playwright();
    const manifest = await collectPlaywrightBindings({
      policy,
      selectedProjects: selection.selectedProjects,
      runtime,
      runId,
      dependencies: playwright,
      cancellation,
    });
    if (cancellation.requested) {
      throw new UsageError("Check was cancelled after Playwright collection.", {
        code: "CHECK_CANCELLED",
      });
    }

    const { selectedCollected, casePlans, plan } = await planCheckRun({
      policy,
      policyDigest: policy.policyDigest,
      matrix,
      selection,
      manifest,
      request,
      runId,
    });
    outcomeSelection = selectionResult(
      request,
      selection.selectedProjects,
      casePlans.map((entry) => entry.caseId),
      matrix.requiredCases.length,
      selection.scope,
    );
    freezeRunPlan(policy.root, plan, casePlans);
    startRunRecord(policy.root, plan, env.now().toISOString());
    bundlePath = toProjectRelative(policy.root, runDir(policy.root, runId));

    let execution: PlaywrightExecution = {
      exitCode: null,
      signal: null,
      cancelled: cancellation.requested,
      reporterCompleted: false,
      diagnostics: [],
    };
    try {
      exportRunId(runId, request, runtime);
      execution = await executePlaywrightRun({
        policy,
        runId,
        selectedProjects: selection.selectedProjects,
        selectedCases: selectedCollected,
        executionGraphDigest: plan.executionGraphDigest,
        runtime,
        dependencies: playwright,
        cancellation,
      });
    } finally {
      await (seams.finalizeRun ?? finalizeRunRecord)(policy.root, runId, {
        retryAcceptance: policy.retryAcceptance,
        diagnostics: [...execution.diagnostics],
        transport: {
          exitCode: execution.exitCode,
          signal: execution.signal,
          cancelled: execution.cancelled || cancellation.requested,
          reporterCompleted: execution.reporterCompleted,
          ...(execution.resultStatus ? { resultStatus: execution.resultStatus } : {}),
        },
      });
    }

    return runOutcome({
      request,
      runId,
      bundlePath,
      selection: outcomeSelection,
      execution,
      projection: readRunProjection(policy.root, runId),
    });
  } catch (error) {
    return errorOutcome(error, outcomeRoot, request, {
      ...(bundlePath && runId ? { runId, bundlePath } : {}),
      ...(outcomeSelection ? { selection: outcomeSelection } : {}),
    });
  } finally {
    signalProcess.removeListener("SIGINT", handleSignal);
    signalProcess.removeListener("SIGTERM", handleSignal);
  }
}
