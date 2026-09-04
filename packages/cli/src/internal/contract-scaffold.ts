import * as fs from "node:fs";
import * as path from "node:path";

import {
  SCHEMA_VERSION,
  verificationRequestSchema,
  visualArtifactPath,
  type ExpectStyle,
  type StyleCheckPoint,
  type VerificationRequest,
} from "@framelia/contracts";

import { JSON_INDENT_SPACES, UsageError } from "../exit.ts";

export interface ContractAnswers {
  targetUrl: string;
  contractId: string;
  name: string;
  baseline: { kind: "figma"; fileKey: string; nodeId: string };
  viewport: { preset: string; width: number; height: number };
  scope:
    | { kind: "page"; pageReason: string; styleChecks?: StyleCheckPoint[] }
    | {
        kind: "region";
        selector: string;
        expectSize: { width: number; height: number };
        expectStyle?: ExpectStyle;
      };
}

export function createContractRequest(answers: ContractAnswers): VerificationRequest {
  const outDirName = answers.contractId.replaceAll(".", "/");
  return verificationRequestSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    target: { kind: "web", url: answers.targetUrl },
    contracts: [
      {
        id: answers.contractId,
        name: answers.name,
        baseline: answers.baseline,
        viewport: answers.viewport,
        outDir: visualArtifactPath(outDirName),
        scope: answers.scope,
        ...(answers.scope.kind === "region" ? { profile: "component/strict" as const } : {}),
      },
    ],
  });
}

export type WriteContractRequestOutcome = "created" | "added" | "replaced";

function readExistingRequest(resolved: string): VerificationRequest | null {
  try {
    return verificationRequestSchema.parse(JSON.parse(fs.readFileSync(resolved, "utf8")));
  } catch {
    return null;
  }
}

function mergeContractRequest(
  resolved: string,
  existing: VerificationRequest,
  request: VerificationRequest,
  force: boolean,
): { merged: VerificationRequest; outcome: WriteContractRequestOutcome } {
  const newContract = request.contracts[0]!;
  const existingIndex = existing.contracts.findIndex((contract) => contract.id === newContract.id);

  if (existing.target.url !== request.target.url) {
    throw new UsageError(
      `${resolved} already targets ${existing.target.url}; every contract in one file shares a single target.url (got ${request.target.url}). Pass --output to write a separate file instead.`,
    );
  }
  if (existingIndex !== -1 && !force) {
    throw new UsageError(
      `Refusing to replace existing contract "${newContract.id}" in ${resolved}. Pass --force to replace it.`,
    );
  }

  const contracts =
    existingIndex === -1
      ? [...existing.contracts, newContract]
      : existing.contracts.map((contract, index) =>
          index === existingIndex ? newContract : contract,
        );
  return {
    merged: verificationRequestSchema.parse({ ...existing, contracts }),
    outcome: existingIndex === -1 ? "added" : "replaced",
  };
}

export function writeContractRequest(
  outputPath: string,
  request: VerificationRequest,
  force = false,
): WriteContractRequestOutcome {
  if (request.contracts.length !== 1) {
    throw new Error(
      `writeContractRequest expects exactly one contract per request; got ${request.contracts.length}.`,
    );
  }
  const resolved = path.resolve(outputPath);
  const fileExists = fs.existsSync(resolved);
  const existing = fileExists ? readExistingRequest(resolved) : null;

  let toWrite: VerificationRequest = request;
  let outcome: WriteContractRequestOutcome = "created";
  if (fileExists) {
    if (!existing) {
      if (!force) {
        throw new UsageError(
          `Refusing to overwrite existing file: ${resolved}. Pass --force to replace it.`,
        );
      }
      outcome = "replaced";
    } else {
      ({ merged: toWrite, outcome } = mergeContractRequest(resolved, existing, request, force));
    }
  }

  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(toWrite, null, JSON_INDENT_SPACES)}\n`, "utf8");
  return outcome;
}
