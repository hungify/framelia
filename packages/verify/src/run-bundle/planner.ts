import * as fs from "node:fs";
import * as path from "node:path";

import { DEFAULT_MAX_MASKED_AREA_RATIO, MIN_STABILITY_SAMPLES } from "@framelia/contracts";
import {
  authoredContractSchema,
  CASE_PLAN_FORMAT_VERSION,
  casePlanSchema,
  type CasePlan,
  type CollectedCase,
  type SourceIdentity,
} from "@framelia/contracts/workflow";

import { canonicalJsonDigest } from "../canonical-json.ts";
import { fileHash } from "../hash.ts";
import { readPinnedBaseline } from "../pinned-baseline.ts";
import type { ResolvedProjectPolicy } from "../project-policy.ts";
import { computeCaseId } from "./layout.ts";

export interface CollectedCasePlanContext {
  projectRoot: string;
  runId: string;
  policy: ResolvedProjectPolicy;
  source: SourceIdentity;
}

/**
 * Revalidates one runner-independent collection record against authored project inputs and
 * builds its immutable CasePlan. Runner adapters must first project their public metadata to a
 * CollectedCase; both direct reporter runs and the CLI collection transport share this planner.
 */
export async function buildCasePlanForCollectedCase(
  collected: CollectedCase,
  context: CollectedCasePlanContext,
): Promise<CasePlan> {
  const policyDigest = context.policy.policyDigest;
  if (!policyDigest)
    throw new Error("run-bundle: cannot plan a case without a project policy digest.");

  const contractPath = path.resolve(context.projectRoot, collected.binding.contractFile);
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(contractPath, "utf8"));
  } catch (error) {
    throw new Error(
      `run-bundle: cannot read contract "${collected.binding.contractId}" at ${contractPath} while freezing its case plan.`,
      { cause: error },
    );
  }
  const contract = authoredContractSchema.parse(parsed);
  const contractDigest = canonicalJsonDigest(contract);
  if (
    contract.id !== collected.binding.contractId ||
    contractDigest !== collected.binding.contractDigest
  ) {
    throw new Error(
      `run-bundle: contract "${collected.binding.contractId}" changed or was remapped after collection (collected ${collected.binding.contractDigest}, current ${contractDigest}).`,
    );
  }

  const specPath = path.resolve(context.projectRoot, collected.specFile);
  const currentSpecDigest = fileHash(specPath);
  if (currentSpecDigest !== collected.specFileDigest) {
    throw new Error(
      `run-bundle: spec ${collected.specFile} changed after collection (collected ${collected.specFileDigest}, current ${currentSpecDigest}).`,
    );
  }

  const pinnedBaseline = await readPinnedBaseline(context.projectRoot, contract);
  const caseId = computeCaseId({
    contractId: contract.id,
    projectName: collected.project,
    repeatIndex: collected.repeatIndex,
  });
  return casePlanSchema.parse({
    formatVersion: CASE_PLAN_FORMAT_VERSION,
    kind: "framelia.case-plan",
    runId: context.runId,
    caseId,
    contract: {
      id: contract.id,
      file: collected.binding.contractFile,
      digest: collected.binding.contractDigest,
      authored: contract,
    },
    snapshotDigest: contract.baseline.snapshotDigest,
    expectedDigest: pinnedBaseline.snapshot.expected.image.digest,
    expectedSize: {
      width: pinnedBaseline.snapshot.expected.image.width,
      height: pinnedBaseline.snapshot.expected.image.height,
    },
    baselineSource: pinnedBaseline.snapshot.source,
    maxMaskedAreaRatio: context.policy.capture.maxMaskedAreaRatio ?? DEFAULT_MAX_MASKED_AREA_RATIO,
    stabilitySamples: context.policy.capture.stabilitySamples ?? MIN_STABILITY_SAMPLES,
    policyDigest,
    bindingDigest: canonicalJsonDigest(collected.binding),
    binding: collected.binding,
    registration: {
      specFile: collected.specFile,
      specDigest: collected.specFileDigest,
      titlePath: collected.testTitlePath,
    },
    specFile: collected.specFile,
    specFileDigest: collected.specFileDigest,
    project: { name: collected.project, runtimeDigest: collected.projectRuntimeDigest },
    repeatIndex: collected.repeatIndex,
    retryAcceptance: context.policy.retryAcceptance,
    source: context.source,
  });
}
