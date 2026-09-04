import * as path from "node:path";

import type { CliRuntime } from "../runtime-types.ts";

/** Resolves `--project-root` (or the injected runtime's cwd) the same way every command
 * does -- relative paths resolve against `runtime.cwd()`, never global `process.cwd()`. */
export function resolveProjectRoot(raw: string | undefined, runtime: CliRuntime): string {
  return path.resolve(runtime.cwd(), raw ?? ".");
}
