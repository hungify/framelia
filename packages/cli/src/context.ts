import type { CommandContext } from "@stricli/core";

import type { CliRuntime } from "./runtime-types.ts";

export type { CliRuntime } from "./runtime-types.ts";

export interface CliContext extends CommandContext {
  readonly process: CliRuntime;
  readonly version: string;
}

export function buildContext(options: { process?: CliRuntime; version: string }): CliContext {
  return {
    process: options.process ?? process,
    version: options.version,
  };
}
