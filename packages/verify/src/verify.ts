import * as path from "node:path";

import { verificationArtifactSchema } from "@framelia/contracts";
import type {
  VerificationArtifact,
  VerificationContract,
  VerificationRequest,
  ExpectStyle,
} from "@framelia/contracts";

import { JSON_INDENT_SPACES } from "./constants.ts";
import { checkDoneGate, type DoneGateVerdict, type DoneGateViewport } from "./done-gate/index.ts";
import { writeFileAtomic } from "./fs-atomic.ts";
import { resolveArtifactPath } from "./paths.ts";
import type { ContractDefaults, ExpectSize, ProfileName } from "./types.ts";

/** Fields derived from a contract's page/region scope; identical for the verify pipeline and done-gate. */
interface ContractScopeFields {
  profile: ProfileName;
  selector: string | undefined;
  expectSize: ExpectSize | undefined;
  expectStyle: ExpectStyle | undefined;
  pageReason: string | undefined;
}

function resolveContractScope(contract: VerificationContract): ContractScopeFields {
  if (contract.scope.kind === "page") {
    return {
      profile: "page",
      selector: undefined,
      expectSize: undefined,
      expectStyle: undefined,
      pageReason: contract.scope.pageReason,
    };
  }
  return {
    profile: contract.profile ?? "component/strict",
    selector: contract.scope.selector,
    expectSize: contract.scope.expectSize,
    expectStyle: contract.scope.expectStyle,
    pageReason: undefined,
  };
}

export function doneGateFromArtifact(
  artifact: VerificationArtifact,
  options: {
    maxScoreAgeMs?: number;
    maxBaselineAgeMs?: number;
    now?: () => number;
    /** Project-wide capture-tuning defaults resolved from framelia.config.ts. */
    defaults?: ContractDefaults;
  } = {},
): DoneGateVerdict {
  const viewports = artifact.request.contracts.map((contract) =>
    contractToDoneGate(
      contract,
      artifact.request.target,
      artifact.projectRoot,
      options.defaults ?? {},
    ),
  );
  const verdict = checkDoneGate({
    viewports,
    cwd: artifact.projectRoot,
    maxScoreAgeMs: options.maxScoreAgeMs,
    maxBaselineAgeMs: options.maxBaselineAgeMs,
    now: options.now,
  });
  const results = new Map(artifact.results.map((result) => [result.id, result]));
  artifact.request.contracts.forEach((contract, index) => {
    const result = results.get(contract.id);
    const viewport = verdict.viewports[index];
    if (viewport && (!result || result.ok !== true || result.pass !== true)) {
      viewport.reasons.push("verification artifact result is not passing.");
      viewport.done = false;
    }
  });
  if (artifact.ok !== true || artifact.allPassed !== true) {
    verdict.done = false;
  } else {
    verdict.done = verdict.viewports.every((viewport) => viewport.done);
  }
  return verdict;
}

export function writeVerificationArtifact(filePath: string, artifact: VerificationArtifact): void {
  const validated = verificationArtifactSchema.parse(artifact);
  const resolved = path.resolve(filePath);
  writeFileAtomic(resolved, `${JSON.stringify(validated, null, JSON_INDENT_SPACES)}\n`);
}

function contractToDoneGate(
  contract: VerificationContract,
  target: VerificationRequest["target"],
  projectRoot: string,
  defaults: ContractDefaults,
): DoneGateViewport {
  const scope = resolveContractScope(contract);
  return {
    viewport: contract.viewport.name,
    outDir: resolveArtifactPath(contract.outDir, projectRoot),
    baseline: contract.baseline,
    target,
    profile: scope.profile,
    selector: scope.selector,
    expectSize: scope.expectSize,
    pageReason: scope.pageReason,
    masks: contract.masks,
    maxMaskedAreaRatio: defaults.maxMaskedAreaRatio,
  };
}
