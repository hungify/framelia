import * as fs from "node:fs";
import * as path from "node:path";

import { verificationRequestSchema, type VerificationRequest } from "@framelia/contracts";
import { Command, InvalidArgumentError } from "commander";

/** Parses a JSON file, wrapping fs/parse errors with the file path. */
export function readJsonFile(filePath: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
  } catch (error) {
    throw new Error(
      `Cannot read JSON ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

/** Reads and validates a schema-v4 visual contract, wrapping schema errors with the file path. */
export function readVerificationRequest(filePath: string): VerificationRequest {
  try {
    return verificationRequestSchema.parse(readJsonFile(filePath));
  } catch (error) {
    throw new Error(
      `Cannot read valid visual contract ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

export function subcommand(name: string, description: string): Command {
  return new Command(name)
    .description(description)
    .allowExcessArguments(false)
    .showHelpAfterError()
    .exitOverride();
}

export function positiveNumber(raw: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new InvalidArgumentError("must be a positive number");
  }
  return value;
}

export function positiveInteger(raw: string): number {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new InvalidArgumentError("must be a positive integer");
  }
  return value;
}
