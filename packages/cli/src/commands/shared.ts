import * as fs from "node:fs";
import * as path from "node:path";

import { EXIT_OK, EXIT_VISUAL_FAIL, JSON_INDENT_SPACES } from "@framelia/verify";
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

/** Resolves `--project-root` (or the cwd) the same way every command does. */
export function resolveProjectRoot(raw?: string): string {
  return path.resolve(raw ?? process.cwd());
}

/** Prints a command's JSON result and sets the process exit code from its outcome. */
export function emitResult(result: unknown, ok: boolean): void {
  console.log(JSON.stringify(result, null, JSON_INDENT_SPACES));
  process.exitCode = ok ? EXIT_OK : EXIT_VISUAL_FAIL;
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
