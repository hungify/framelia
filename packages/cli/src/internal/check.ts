import * as path from "node:path";

import {
  COLLECTION_FORMAT_VERSION,
  COMMAND_OUTCOME_FORMAT_VERSION,
  RUN_PLAN_FORMAT_VERSION,
  collectionManifestSchema,
  commandOutcomeSchema,
  runPlanSchema,
  type CollectedCase,
  type CollectionManifest,
  type CommandOutcome,
  type Diagnostic,
} from "@framelia/contracts/workflow";
import { EXIT_USAGE_ERROR, canonicalJsonDigest, portableErrorMessage } from "@framelia/verify";
import {
  discoverAuthoredContracts,
  resolveContractProjectMatrix,
  type ContractProjectCase,
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
import { reconcileBinding } from "./binding-reconciliation.ts";
import { runExitCode } from "./outcome.ts";
import {
  PlaywrightTransportError,
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
}

/** Test seam: replaces run finalization to observe or fail it. */
export interface CheckSeams {
  finalizeRun?: typeof finalizeRunRecord;
}

function diagnostic(code: string, stage: string, message: string): Diagnostic {
  return { code, stage, message };
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
  const selected: CollectedCase[] = [];
  for (const matrixCase of expected) {
    const label = `${matrixCase.contractId}/${JSON.stringify(matrixCase.project)}`;
    const binding = reconcileBinding(manifest, matrixCase);
    switch (binding.status) {
      case "executable":
        selected.push(...binding.cases);
        break;
      case "project-missing":
        throw new Error(
          `Collection omitted selected project ${JSON.stringify(matrixCase.project)}.`,
        );
      case "unbound":
        throw new Error(
          `Selected binding ${label} matched 0 collected tests; expected exactly one.`,
        );
      case "duplicate":
        throw new Error(
          `Selected binding ${label}/repeat-${binding.repeatIndex} matched ${binding.matched} collected tests; expected exactly one.`,
        );
      case "stale":
        throw new Error(
          binding.reason === "identity"
            ? `Selected binding ${label} was remapped to a different authored contract file or digest.`
            : `Selected binding ${label} has non-contiguous repeat slots; expected exactly one per slot.`,
        );
    }
  }
  if (selected.length === 0) throw new Error("Collection produced zero selected visual cases.");
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
  details: Partial<Pick<CommandOutcome, "runId" | "bundlePath" | "selection">> = {},
): CommandOutcome {
  const message = portableErrorMessage(error, root);
  const code = error instanceof PlaywrightTransportError ? error.code : "FRAMELIA_CHECK_FAILED";
  return commandOutcomeSchema.parse({
    formatVersion: COMMAND_OUTCOME_FORMAT_VERSION,
    kind: "framelia.command-outcome",
    command: "check",
    executionState: "error",
    visualVerdict: "not-evaluated",
    exitCode: EXIT_USAGE_ERROR,
    diagnostics: [diagnostic(code, "check", message)],
    ...details,
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
    const policy = await openProject(request.projectRoot, runtime).loadConfig();
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
    const playwright = await env.adapters.playwright();
    const manifest = await collectPlaywrightBindings({
      policy,
      selectedProjects: selection.selectedProjects,
      runtime,
      runId,
      dependencies: playwright,
      cancellation,
    });
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

    let execution: PlaywrightExecution = {
      exitCode: null,
      signal: null,
      cancelled: cancellation.requested,
      reporterCompleted: false,
      diagnostics: [],
    };
    try {
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

    const projection = readRunProjection(policy.root, runId);
    const complete = execution.reporterCompleted && projection.executionState === "completed";
    const visualVerdict = projection.visualVerdict;
    return commandOutcomeSchema.parse({
      formatVersion: COMMAND_OUTCOME_FORMAT_VERSION,
      kind: "framelia.command-outcome",
      command: "check",
      executionState: complete ? "completed" : "incomplete",
      visualVerdict,
      exitCode: runExitCode(complete, visualVerdict),
      runId,
      bundlePath,
      diagnostics: projection.diagnostics,
      selection: outcomeSelection,
      coverage: projection.selection,
      cases: projection.cases,
      ...(complete && visualVerdict === "passed"
        ? {}
        : { next: nextForRun(projection, request.projectRoot) }),
    });
  } catch (error) {
    return errorOutcome(error, outcomeRoot, {
      ...(bundlePath && runId ? { runId, bundlePath } : {}),
      ...(outcomeSelection ? { selection: outcomeSelection } : {}),
    });
  } finally {
    signalProcess.removeListener("SIGINT", handleSignal);
    signalProcess.removeListener("SIGTERM", handleSignal);
  }
}
