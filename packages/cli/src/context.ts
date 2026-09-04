import type { CommandContext, StricliProcess } from "@stricli/core";

import type { CliRuntime } from "./runtime-types.ts";

export type { CliRuntime } from "./runtime-types.ts";
export type { DashboardHost } from "./dashboard-types.ts";

/**
 * Minimal host process needed by Framelia. NodeJS.Process satisfies this in production;
 * tests can provide a small fake without implementing Node's entire Process surface.
 */
export interface CliProcess extends StricliProcess {
  readonly cwd: () => string;
  readonly env: NodeJS.ProcessEnv;
  readonly stdin: NodeJS.ReadableStream;
}

/**
 * Everything a command needs from the outside world, as one seam. Real `process` in
 * production, a scripted fake in tests -- no command reaches for the global
 * `process`/`console` directly, so none needs its own one-off test double.
 *
 * `CliContext` extends Stricli's `CommandContext` (whose own `process` is only
 * `{ stdout, stderr }`), but types `process` as the fuller `StricliProcess`
 * (`{ stdout, stderr, env?, exitCode? }`) because that is what Stricli's `ApplicationContext`
 * -- the shape `run()` itself requires -- adds on top.
 */
export interface CliContext extends CommandContext {
  /** Stricli-compatible process object; production passes the real process, tests pass a fake. */
  readonly process: StricliProcess;
  readonly runtime: CliRuntime;
  readonly version: string;
}

export function buildContext(options: { process?: CliProcess; version: string }): CliContext {
  const nodeProcess = options.process ?? process;
  return {
    process: nodeProcess,
    runtime: nodeProcess,
    version: options.version,
  };
}
