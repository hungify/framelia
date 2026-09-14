import * as fs from "node:fs";
import * as path from "node:path";

import {
  authoredContractSchema,
  contractBindingSchema,
  BINDING_FORMAT_VERSION,
  type CasePlan,
} from "@framelia/contracts/workflow";

import { canonicalJsonDigest } from "../canonical-json.ts";
import { fileHash } from "../hash.ts";
import { readPinnedBaseline } from "../pinned-baseline.ts";
import { resolveProjectPolicy } from "../project-policy.ts";

export interface CasePlanReconciliation {
  consistent: boolean;
  /** Human-readable reasons the frozen case plan disagrees with current on-disk reality;
   *  empty when `consistent` is true. */
  reasons: string[];
}

/**
 * Re-derives the same contract/binding/pinned-baseline/policy/spec-file inputs a case
 * plan was originally frozen from, and compares each against the plan's own recorded
 * digest -- catching a contract file, pinned baseline, project policy, or spec file
 * edited *after* the run's plan was frozen but *before* the run finished. This is
 * framelia/#77's own "Reconcile changed contract/policy/binding/snapshot inputs before
 * capture and finalization" requirement and its "changed planning inputs invalidate the
 * run even when IDs/commit strings are unchanged" acceptance criterion, applied at
 * `finalizeRunRecord` time -- the last point before a run's membership becomes
 * authoritative.
 *
 * Deliberately does NOT reconcile `project.runtimeDigest`: recomputing it needs the live
 * Playwright project config (`viewport`/`deviceScaleFactor`), which this package has no
 * way to re-resolve without re-invoking Playwright itself -- reconciling that specific
 * input is out of scope for a `@framelia/verify`-only pass and is left for whichever
 * future ticket owns re-running/re-checking Playwright's own project config.
 */
export async function reconcileCasePlan(
  root: string,
  casePlan: CasePlan,
): Promise<CasePlanReconciliation> {
  const reasons: string[] = [];

  let currentContractDigest: `sha256:${string}` | undefined;
  let currentContract: ReturnType<typeof authoredContractSchema.parse> | undefined;
  const contractPath = path.resolve(root, casePlan.contract.file);
  try {
    const parsed = authoredContractSchema.parse(JSON.parse(fs.readFileSync(contractPath, "utf8")));
    currentContractDigest = canonicalJsonDigest(parsed);
    currentContract = parsed;
    if (currentContractDigest !== casePlan.contract.digest) {
      reasons.push(
        `contract "${casePlan.contract.id}" at ${contractPath} has changed since the case plan was frozen (recomputed digest ${currentContractDigest}, frozen ${casePlan.contract.digest})`,
      );
    }
  } catch (error) {
    reasons.push(
      `contract "${casePlan.contract.id}" at ${contractPath} could not be re-read/re-validated: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (currentContract && currentContractDigest === casePlan.contract.digest) {
    const currentBinding = contractBindingSchema.parse({
      formatVersion: BINDING_FORMAT_VERSION,
      kind: "framelia.contract-binding",
      contractId: currentContract.id,
      contractFile: casePlan.contract.file,
      contractDigest: currentContractDigest,
    });
    const currentBindingDigest = canonicalJsonDigest(currentBinding);
    if (currentBindingDigest !== casePlan.bindingDigest) {
      reasons.push(
        `binding for contract "${casePlan.contract.id}" recomputes to digest ${currentBindingDigest}, which disagrees with the frozen case plan's bindingDigest ${casePlan.bindingDigest}`,
      );
    }

    if (currentContract.baseline.snapshotDigest !== casePlan.snapshotDigest) {
      reasons.push(
        `contract "${casePlan.contract.id}"'s baseline.snapshotDigest (${currentContract.baseline.snapshotDigest}) no longer matches the frozen case plan's snapshotDigest (${casePlan.snapshotDigest})`,
      );
    } else {
      try {
        await readPinnedBaseline(root, currentContract);
      } catch (error) {
        reasons.push(
          `pinned baseline for contract "${casePlan.contract.id}" failed re-validation: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  try {
    const policy = await resolveProjectPolicy({
      cwd: root,
      projectRoot: root,
      allowUninitialized: true,
    });
    if (!policy.policyDigest || policy.policyDigest !== casePlan.policyDigest) {
      reasons.push(
        `project policy has changed since the case plan was frozen (recomputed ${policy.policyDigest ?? "none (uninitialized)"}, frozen ${casePlan.policyDigest})`,
      );
    }
  } catch (error) {
    reasons.push(
      `project policy could not be re-resolved: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const specFilePath = path.resolve(root, casePlan.specFile);
  try {
    const currentSpecFileDigest = fileHash(specFilePath);
    if (currentSpecFileDigest !== casePlan.specFileDigest) {
      reasons.push(
        `spec file ${casePlan.specFile} has changed since the case plan was frozen (recomputed ${currentSpecFileDigest}, frozen ${casePlan.specFileDigest})`,
      );
    }
  } catch (error) {
    reasons.push(
      `spec file ${casePlan.specFile} at ${specFilePath} could not be re-read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return { consistent: reasons.length === 0, reasons };
}
