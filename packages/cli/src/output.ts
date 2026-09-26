import type { CliContext } from "./context.ts";
import { EXIT_OK, EXIT_VISUAL_FAIL, JSON_INDENT_SPACES } from "./exit.ts";

export interface CliResult<T> {
  readonly ok: boolean;
  readonly body: T;
  readonly exitCode?: 0 | 1 | 2;
}

export function emitResult(context: CliContext, result: CliResult<unknown>): void {
  context.process.stdout.write(`${JSON.stringify(result.body, null, JSON_INDENT_SPACES)}\n`);
  context.process.exitCode = result.exitCode ?? (result.ok ? EXIT_OK : EXIT_VISUAL_FAIL);
}
