import type { StricliProcess } from "@stricli/core";

export interface CliRuntime extends StricliProcess {
  readonly cwd: () => string;
  readonly env: NodeJS.ProcessEnv;
  readonly stdin: NodeJS.ReadableStream;
}

/** Where termination signals (SIGINT/SIGTERM) come from; Node's `process` in production. */
export type SignalSource = Pick<NodeJS.Process, "on" | "once" | "off" | "removeListener">;
