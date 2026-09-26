import { EXIT_OK, EXIT_USAGE_ERROR, EXIT_VISUAL_FAIL, JSON_INDENT_SPACES } from "@framelia/verify";
import { ExitCode } from "@stricli/core";
import type { ZodError } from "zod";

export { EXIT_OK, EXIT_USAGE_ERROR, EXIT_VISUAL_FAIL, JSON_INDENT_SPACES };

export class UsageError extends Error {
  readonly exitCode = EXIT_USAGE_ERROR;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "UsageError";
  }
}

function friendlyZodIssueMessage(issue: ZodError["issues"][number]): string {
  // Avoid leaking Zod's raw regex pattern from a failed .regex() check.
  if (issue.code === "invalid_format") return "has an invalid format";
  return issue.message;
}

export function usageErrorFromZodError(error: ZodError): UsageError {
  const message = error.issues
    .map((issue) => {
      const text = friendlyZodIssueMessage(issue);
      return issue.path.length > 0 ? `${issue.path.join(".")}: ${text}` : text;
    })
    .join("; ");
  return new UsageError(message);
}

export function determineExitCode(error: unknown): number {
  return error instanceof UsageError ? error.exitCode : EXIT_USAGE_ERROR;
}

export function normalizeStricliExitCode(
  exitCode: number | string | null | undefined,
): number | string | null | undefined {
  if (typeof exitCode === "number" && exitCode < ExitCode.Success) return EXIT_USAGE_ERROR;
  return exitCode;
}
