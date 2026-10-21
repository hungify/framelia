import type { Diagnostic, RunProjection } from "@framelia/contracts/workflow";
import { AppError, EXIT_OK, EXIT_USAGE_ERROR, EXIT_VISUAL_FAIL } from "@framelia/verify";

/**
 * The CLI's one exit policy for run outcomes: only a completed run's visual verdict chooses
 * between 0 and 1; anything incomplete is an execution error.
 */
export function runExitCode(
  completed: boolean,
  visualVerdict: RunProjection["visualVerdict"],
): typeof EXIT_OK | typeof EXIT_VISUAL_FAIL | typeof EXIT_USAGE_ERROR {
  if (!completed) return EXIT_USAGE_ERROR;
  return visualVerdict === "mismatched" ? EXIT_VISUAL_FAIL : EXIT_OK;
}

/** A failure diagnostic carrying the AppError code when there is one, else `fallbackCode`. */
export function failureDiagnostic(
  error: unknown,
  fallbackCode: string,
  stage: string,
  message: string = error instanceof Error ? error.message : String(error),
): Diagnostic {
  return { code: error instanceof AppError ? error.code : fallbackCode, stage, message };
}

/** A `framelia` follow-up command that keeps the caller's explicit `--project-root`. */
export function frameliaNext(
  argv: readonly string[],
  projectRoot: string | undefined,
): { command: string; argv: string[] } {
  return {
    command: "framelia",
    argv: [...argv, ...(projectRoot ? ["--project-root", projectRoot] : [])],
  };
}
