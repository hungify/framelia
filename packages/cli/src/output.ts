import { EXIT_OK, EXIT_VISUAL_FAIL, JSON_INDENT_SPACES } from "./cli-constants.ts";
import type { CliContext } from "./context.ts";

/**
 * The one seam for JSON+exit-code output. Result-producing commands compute a plain
 * result and hand it here; no domain function serializes JSON or sets the exit code
 * itself.
 */
export function emitResult(context: CliContext, result: unknown, ok: boolean): void {
  context.process.stdout.write(`${JSON.stringify(result, null, JSON_INDENT_SPACES)}\n`);
  context.process.exitCode = ok ? EXIT_OK : EXIT_VISUAL_FAIL;
}
