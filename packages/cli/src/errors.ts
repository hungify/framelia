import type { ZodError } from "zod";

import { EXIT_USAGE_ERROR } from "./cli-constants.ts";

/**
 * Anything a command throws for a usage mistake (bad flag combination, invalid
 * value, missing precondition) -- as opposed to a bug or an I/O failure.
 * Distinguishing this from a bare `Error` lets `cli.ts`'s `determineExitCode`
 * map failures to the right exit code without string-matching messages.
 */
export class UsageError extends Error {
  readonly exitCode = EXIT_USAGE_ERROR;

  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

/**
 * The one formatter every command-level Zod validation seam uses (see the rewrite
 * plan's "Validation seam" section): preserves Zod's issue order, joins a single
 * issue's nested path segments with `.`, and joins multiple issues with `; ` --
 * so diagnostics stay identical across every command that adopts this pattern
 * instead of drifting per-command.
 */
export function usageErrorFromZodError(error: ZodError): UsageError {
  const message = error.issues
    .map((issue) =>
      issue.path.length > 0 ? `${issue.path.join(".")}: ${issue.message}` : issue.message,
    )
    .join("; ");
  return new UsageError(message);
}
