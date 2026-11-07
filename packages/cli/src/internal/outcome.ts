import type { Diagnostic, NextOperation, RunProjection } from "@framelia/contracts/workflow";
import { AppError, EXIT_OK, EXIT_USAGE_ERROR, EXIT_VISUAL_FAIL } from "@framelia/verify";

import { UsageError } from "../exit.ts";

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

/** The stable code an error carries (AppError, or a coded UsageError), if any. */
export function errorCode(error: unknown): string | undefined {
  if (error instanceof AppError) return error.code;
  if (error instanceof UsageError) return error.code;
  return undefined;
}

/** A failure diagnostic carrying the error's own code when there is one, else `fallbackCode`. */
export function failureDiagnostic(
  error: unknown,
  fallbackCode: string,
  stage: string,
  message: string = error instanceof Error ? error.message : String(error),
): Diagnostic {
  return { code: errorCode(error) ?? fallbackCode, stage, message };
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

/** Codes whose repair starts from the project's own setup state. */
const STATUS_CODES = new Set([
  "INVALID_PROJECT_CONFIG",
  "MULTIPLE_PROJECT_CONFIGS",
  "PROJECT_POLICY_INCOMPLETE",
  "ENV_FILE_ENTRY_INVALID",
  "ENV_FILE_NOT_FOUND",
  "FIGMA_TOKEN_MISSING",
  "PLAYWRIGHT_NOT_INSTALLED",
]);

/** Codes whose repair starts from the authored contract/binding inventory. */
const CONTRACT_LIST_CODES = new Set([
  "UNKNOWN_CONTRACT_ID",
  "CONTRACT_REQUIRED",
  "UNKNOWN_PLAYWRIGHT_PROJECT",
  "CHECK_SELECTION_INVALID",
  "CHECK_SELECTION_EMPTY",
  "DUPLICATE_CONTRACT_ID",
  "CONTRACT_FILE_INVALID",
  "CONTRACT_UNBOUND",
  "DUPLICATE_CONTRACT_BINDING",
  "STALE_CONTRACT_BINDING",
  "CONTRACT_BINDING_INVALID",
  "PINNED_BASELINE_MISSING",
  "PINNED_BASELINE_INVALID",
  "PINNED_BASELINE_DIGEST_MISMATCH",
]);

/**
 * The one `framelia` command that moves a failure with this code forward, when a command
 * can. Failures only an operator can repair (trust roots, signatures, network) have none.
 */
export function nextForFailureCode(
  code: string,
  projectRoot: string | undefined,
): NextOperation | undefined {
  if (code === "PROJECT_NOT_INITIALIZED" || code === "FRAMELIA_REPORTER_MISSING") {
    // init is idempotent: it creates only what is missing and prints the reporter recipe.
    return frameliaNext(["init"], projectRoot);
  }
  if (code === "RUN_BUNDLE_MISSING" || code === "RUN_SELECTION_MISSING") {
    return frameliaNext(["runs", "list"], projectRoot);
  }
  if (STATUS_CODES.has(code)) return frameliaNext(["status"], projectRoot);
  if (CONTRACT_LIST_CODES.has(code)) return frameliaNext(["contract", "list"], projectRoot);
  return undefined;
}

/** The shared shape of every finite command's operational-failure body. */
export interface FailureOutcome<K extends string, C extends string> {
  readonly formatVersion: 1;
  readonly kind: K;
  readonly command: C;
  readonly executionState: "error";
  readonly exitCode: 2;
  readonly diagnostics: Diagnostic[];
  readonly next?: NextOperation;
}

/**
 * One structured operational failure for a finite command: the error's own code (or the
 * fallback), and the follow-up that code calls for unless the caller supplies its own.
 */
export function failureOutcome<K extends string, C extends string>(options: {
  readonly kind: K;
  readonly command: C;
  readonly error: unknown;
  readonly fallbackCode: string;
  readonly stage: string;
  readonly projectRoot: string | undefined;
  readonly message?: string;
  readonly next?: NextOperation;
}): { ok: false; exitCode: 2; body: FailureOutcome<K, C> } {
  const diagnostic = failureDiagnostic(
    options.error,
    options.fallbackCode,
    options.stage,
    ...(options.message === undefined ? [] : [options.message]),
  );
  const next = options.next ?? nextForFailureCode(diagnostic.code, options.projectRoot);
  return {
    ok: false,
    exitCode: EXIT_USAGE_ERROR,
    body: {
      formatVersion: 1,
      kind: options.kind,
      command: options.command,
      executionState: "error",
      exitCode: EXIT_USAGE_ERROR,
      diagnostics: [diagnostic],
      ...(next ? { next } : {}),
    },
  };
}
