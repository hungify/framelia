import {
  RUN_PLAN_FORMAT_VERSION,
  runPlanSchema,
  type CasePlan,
  type RunPlan,
} from "@framelia/contracts/workflow";

import { canonicalJsonDigest } from "../canonical-json.ts";
import type { RetryAcceptancePolicy } from "../project-policy.ts";

export interface DirectRunPlanInput {
  runId: string;
  policyDigest: string;
  retryAcceptance: RetryAcceptancePolicy;
  /** Every case the run selects, in the order the plan lists them. */
  casePlans: readonly CasePlan[];
}

/**
 * The `RunPlan` of a direct (uncoordinated) Playwright run, built from the case plans it
 * collected. A direct run has no independently authored full matrix: its collected cases are
 * exact selected membership but no proof of completeness, so the plan is always a `subset`
 * with no required cases, and independently signed gate requirements supply completeness.
 * A sharded run composes the same plan from the union of every shard's case plans.
 */
export function buildDirectRunPlan(input: DirectRunPlanInput): RunPlan {
  const { casePlans } = input;
  const planned = casePlans.map((casePlan) => ({
    caseId: casePlan.caseId,
    casePlanDigest: canonicalJsonDigest(casePlan),
  }));
  const contracts = [...new Set(casePlans.map((casePlan) => casePlan.contract.id))].toSorted();
  const availableMatrix = [
    ...new Map(
      casePlans.map(
        (casePlan) =>
          [
            `${casePlan.contract.id}\u0000${casePlan.project.name}`,
            {
              contractId: casePlan.contract.id,
              contractFile: casePlan.contract.file,
              contractDigest: casePlan.contract.digest,
              project: casePlan.project.name,
              required: casePlan.contract.authored.required,
            },
          ] as const,
      ),
    ).values(),
  ];
  return runPlanSchema.parse({
    formatVersion: RUN_PLAN_FORMAT_VERSION,
    kind: "framelia.run-plan",
    runId: input.runId,
    policyDigest: input.policyDigest,
    executionGraphDigest: canonicalJsonDigest({
      directCases: casePlans.map((casePlan) => ({
        caseId: casePlan.caseId,
        projectRuntimeDigest: casePlan.project.runtimeDigest,
        specFileDigest: casePlan.specFileDigest,
        titlePath: casePlan.registration.titlePath,
      })),
    }),
    retryAcceptance: input.retryAcceptance,
    selection: { mode: "subset", contracts },
    availableMatrix,
    requiredMatrix: [],
    availableCases: planned,
    requiredCases: [],
    selectedCases: planned,
  });
}
