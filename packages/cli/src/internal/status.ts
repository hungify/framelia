import type { CliRuntime } from "../runtime-types.ts";
import { resolveProjectRoot } from "./project-root.ts";

export interface StatusOptions {
  readonly projectRoot: string | undefined;
  readonly version: string;
}

export interface StatusResult {
  readonly ok: true;
  readonly name: "framelia";
  readonly version: string;
  readonly mode: "cli";
  readonly baselineKinds: readonly ["figma"];
  readonly projectRoot: string;
  readonly figmaTokenAvailable: boolean;
}

/**
 * Mirrors `@framelia/verify`'s `resolveToken(explicit?)` fallback to
 * `FIGMA_ACCESS_TOKEN` without importing the heavy verify root or reaching for
 * global `process.env` -- this command never has an explicit token to pass.
 */
export function statusCommand(options: StatusOptions, runtime: CliRuntime): StatusResult {
  return {
    ok: true,
    name: "framelia",
    version: options.version,
    mode: "cli",
    baselineKinds: ["figma"],
    projectRoot: resolveProjectRoot(options.projectRoot, runtime),
    figmaTokenAvailable: Boolean(runtime.env.FIGMA_ACCESS_TOKEN),
  };
}
