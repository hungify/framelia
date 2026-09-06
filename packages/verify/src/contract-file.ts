import * as fs from "node:fs";

import { verificationRequestSchema, type VerificationContract } from "@framelia/contracts";

export type ReadContractEntryOutcome =
  | { ok: true; contract: VerificationContract }
  | {
      ok: false;
      error: "FILE_NOT_FOUND" | "INVALID_CONTRACT_FILE" | "CONTRACT_NOT_FOUND";
      message: string;
    };

/**
 * Reads one contract entry by id out of a (possibly multi-viewport) `visual-contract.json`,
 * schema-validated against the same `verificationRequestSchema` `contract create` writes.
 */
export function readContractEntry(
  contractPath: string,
  contractId: string,
): ReadContractEntryOutcome {
  if (!fs.existsSync(contractPath)) {
    return {
      ok: false,
      error: "FILE_NOT_FOUND",
      message: `no contract file at ${contractPath}.`,
    };
  }

  let raw: string;
  try {
    raw = fs.readFileSync(contractPath, "utf8");
  } catch (error) {
    return {
      ok: false,
      error: "INVALID_CONTRACT_FILE",
      message: `${contractPath} could not be read: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (error) {
    return {
      ok: false,
      error: "INVALID_CONTRACT_FILE",
      message: `${contractPath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const parsed = verificationRequestSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return {
      ok: false,
      error: "INVALID_CONTRACT_FILE",
      message: `${contractPath} failed contract schema validation: ${parsed.error.message}`,
    };
  }

  const contract = parsed.data.contracts.find((candidate) => candidate.id === contractId);
  if (!contract) {
    return {
      ok: false,
      error: "CONTRACT_NOT_FOUND",
      message: `no contract with id "${contractId}" in ${contractPath}.`,
    };
  }
  return { ok: true, contract };
}
