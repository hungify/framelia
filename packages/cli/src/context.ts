import type { CommandContext } from "@stricli/core";

import { buildEnvironment, type CliAdapters, type CommandEnvironment } from "./environment.ts";
import type { CliRuntime } from "./runtime-types.ts";

export type { CliRuntime } from "./runtime-types.ts";

export interface CliContext extends CommandContext, CommandEnvironment {
  readonly process: CliRuntime;
}

export function buildContext(options: {
  process?: CliRuntime;
  version: string;
  adapters?: Partial<CliAdapters>;
}): CliContext {
  return buildEnvironment(options);
}
