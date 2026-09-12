import { randomUUID } from "node:crypto";
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

import { JSON_INDENT_SPACES, UsageError, usageErrorFromZodError } from "../exit.ts";

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
  const text = fs.readFileSync(resolved, "utf8");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = verificationRequestSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  // Force may replace foreign content, never erase contracts from a schema this build cannot read.
  if (value && typeof value === "object" && ("schemaVersion" in value || "contracts" in value)) {
    const rawVersion = "schemaVersion" in value ? value.schemaVersion : undefined;
    const foundVersion =
      typeof rawVersion === "number" && Number.isFinite(rawVersion)
        ? String(rawVersion)
        : "unknown";
    throw new UsageError(
      `${resolved} contains a contract document at schemaVersion ${foundVersion}, but this CLI build reads schemaVersion ${SCHEMA_VERSION}. There is no automatic migration -- --force does not bypass this check either, since it never overwrites a schema this build can't verify. Hand-edit the file to match the current shape (run \`framelia schema --target contract\` to see it) or pass --output to write a separate file.`,
    );
  }
  return null;
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
  const parsed = verificationRequestSchema.safeParse({ ...existing, contracts });
  if (!parsed.success) throw usageErrorFromZodError(parsed.error);
  return {
    merged: parsed.data,
    outcome: existingIndex === -1 ? "added" : "replaced",
  };
}

export function writeContractRequest(
  outputPath: string,
  request: VerificationRequest,
  force = false,
): WriteContractRequestOutcome {
  const resolved = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const lockPath = `${resolved}.lock`;
  let lock: number;
  try {
    lock = fs.openSync(lockPath, "wx");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    throw new UsageError(
      `Contract update is locked at ${lockPath}. Retry after the active writer finishes; remove a stale lock only after confirming no writer is running.`,
    );
  }
  try {
    return writeLocked(resolved, request, force);
  } finally {
    fs.closeSync(lock);
    fs.unlinkSync(lockPath);
  }
}

function writeLocked(
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

  const temporaryPath = `${resolved}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(toWrite, null, JSON_INDENT_SPACES)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    fs.renameSync(temporaryPath, resolved);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
  return outcome;
}
