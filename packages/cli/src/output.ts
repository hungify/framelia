import type { CliContext } from "./context.ts";
import { EXIT_OK, EXIT_USAGE_ERROR, JSON_INDENT_SPACES } from "./exit.ts";

export interface CliResult<T> {
  readonly ok: boolean;
  readonly body: T;
  /**
   * A visual failure must say `1` explicitly. A non-ok result without an exit code is an
   * operational failure (`2`), so a command can never report broken input as a mismatch.
   */
  readonly exitCode?: 0 | 1 | 2;
}

export function emitResult(context: CliContext, result: CliResult<unknown>): void {
  context.process.stdout.write(`${JSON.stringify(result.body, null, JSON_INDENT_SPACES)}\n`);
  context.process.exitCode = result.exitCode ?? (result.ok ? EXIT_OK : EXIT_USAGE_ERROR);
}
