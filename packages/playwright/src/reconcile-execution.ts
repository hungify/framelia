import type { CasePlan, RunContext } from "@framelia/contracts/workflow";
import { canonicalJsonDigest } from "@framelia/verify";
import {
  computeCaseId,
  computeExecutionGraphDigest,
  readCasePlans,
  readRunPlan,
} from "@framelia/verify/run-bundle";

import type { RetryAcceptancePolicy } from "./project-policy.ts";
import type { TransportCollection } from "./transport-collection.ts";

export interface ExecutionBundle {
  root: string;
  runId: string;
  /** Collected Playwright test id -> the frozen case plan it executes. */
  cases: Map<string, { casePlan: CasePlan }>;
  retryAcceptance: RetryAcceptancePolicy;
}

/**
 * Execute mode: proves that what Playwright collected in this process is exactly what
 * `framelia check` froze into the run plan -- same policy, execution graph, case set, and
 * per-case bindings -- and returns the collected tests keyed to their frozen case plans.
 * Throws when anything was remapped after the plan was frozen.
 */
export function reconcileExecution(
  context: RunContext,
  collection: TransportCollection,
): ExecutionBundle {
  const plan = readRunPlan(context.projectRoot, context.runId);
  if (plan.policyDigest !== context.policyDigest) {
    throw new Error("framelia reporter: frozen plan policy does not match execute context.");
  }
  const graphDigest = computeExecutionGraphDigest(collection.manifest);
  if (graphDigest !== plan.executionGraphDigest) {
    throw new Error(
      `framelia reporter: execution graph changed after collection (${graphDigest} != ${plan.executionGraphDigest}).`,
    );
  }
  const casePlans = readCasePlans(context.projectRoot, context.runId);
  if (collection.visualTests.length !== plan.selectedCases.length) {
    throw new Error(
      `framelia reporter: execution collected ${collection.visualTests.length} visual cases, but the frozen plan selected ${plan.selectedCases.length}.`,
    );
  }
  const selectedById = new Map(plan.selectedCases.map((entry) => [entry.caseId, entry]));
  const cases = new Map<string, { casePlan: CasePlan }>();
  const seen = new Set<string>();
  for (const { test, collected } of collection.visualTests) {
    const caseId = computeCaseId({
      contractId: collected.binding.contractId,
      projectName: collected.project,
      repeatIndex: collected.repeatIndex,
    });
    if (seen.has(caseId)) {
      throw new Error(`framelia reporter: duplicate execute binding for selected case ${caseId}.`);
    }
    seen.add(caseId);
    const selected = selectedById.get(caseId);
    const casePlan = casePlans.get(caseId);
    if (!selected || !casePlan) {
      throw new Error(`framelia reporter: execute case ${caseId} is absent from the frozen plan.`);
    }
    if (
      canonicalJsonDigest(casePlan) !== selected.casePlanDigest ||
      canonicalJsonDigest(casePlan.binding) !== canonicalJsonDigest(collected.binding) ||
      casePlan.specFile !== collected.specFile ||
      casePlan.specFileDigest !== collected.specFileDigest ||
      casePlan.project.name !== collected.project ||
      casePlan.project.runtimeDigest !== collected.projectRuntimeDigest ||
      casePlan.repeatIndex !== collected.repeatIndex ||
      JSON.stringify(casePlan.registration.titlePath) !== JSON.stringify(collected.testTitlePath)
    ) {
      throw new Error(
        `framelia reporter: execute case ${caseId} was remapped after its plan was frozen.`,
      );
    }
    cases.set(test.id, { casePlan });
  }
  if (seen.size !== selectedById.size) {
    throw new Error("framelia reporter: one or more frozen selected cases are missing at execute.");
  }
  return {
    root: context.projectRoot,
    runId: context.runId,
    cases,
    retryAcceptance: plan.retryAcceptance,
  };
}
