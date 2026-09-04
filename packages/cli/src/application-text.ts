import { ExitCode, text_en, type ApplicationText } from "@stricli/core";

import { EXIT_USAGE_ERROR } from "./cli-constants.ts";

/**
 * Stricli's default `formatException` returns an Error's `.stack` for thrown exceptions.
 * Today's CLI (`cli.ts`'s `run()`) writes only `error.message` to stderr for any error
 * that escapes a command -- no stack trace. Overriding this one hook keeps every
 * formatter that delegates to `this.formatException` (including `text_en`'s own
 * `exceptionWhileParsingArguments`/`exceptionWhileRunningCommand`) message-only instead
 * of leaking a stack trace into the published CLI's stderr.
 */
function formatException(exc: unknown): string {
  return exc instanceof Error ? exc.message : String(exc);
}

/**
 * Compatibility adapter for Stricli's `ApplicationText`, used via
 * `buildApplication`'s `localization: { text: applicationText }` integration.
 *
 * Built on top of Stricli's own English defaults (`text_en`) rather than
 * reimplemented from scratch: help/documentation wording is allowed to be clearer or
 * more consistent than today's Commander output per the rewrite plan's output-compatibility
 * contract, so only the formatters with a documented current-behavior contract are
 * overridden here. Kept in the shell layer -- `internal/*.ts` never imports this module.
 */
export const applicationText: ApplicationText = {
  ...text_en,
  formatException,
  /**
   * Today's CLI writes exactly `error.message` (no prefix, no stack) to stderr for any
   * error thrown out of a command (`cli.ts`'s `run()`: `console.error(error.message)`).
   * `text_en`'s default prefixes this with "Command failed, " -- override to preserve
   * the current, simpler wording for our own `UsageError`s and other thrown exceptions.
   */
  exceptionWhileRunningCommand(exc: unknown): string {
    return formatException(exc);
  },
};

/**
 * Stricli's own argument-scanning/routing failures (`ExitCode.InvalidArgument = -4`,
 * `ExitCode.UnknownCommand = -5`, ...) are internal implementation details that must
 * never escape as the process exit code -- the published CLI has always exited `2`
 * for a usage mistake. `run()` (cli.ts, Phase 2) calls this after Stricli's own
 * `run()` has set `context.process.exitCode`, to normalize any such negative code to
 * the documented status. Anything already non-negative (Stricli's `Success = 0` /
 * `CommandRunError = 1`, or a value our own `determineExitCode` returned) passes through
 * unchanged.
 */
export function normalizeStricliExitCode(
  exitCode: number | string | null | undefined,
): number | string | null | undefined {
  if (typeof exitCode === "number" && exitCode < ExitCode.Success) return EXIT_USAGE_ERROR;
  return exitCode;
}
