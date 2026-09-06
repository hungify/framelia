import type { StricliProcess } from "@stricli/core";

export interface CliRuntime extends StricliProcess {
  readonly cwd: () => string;
  readonly env: NodeJS.ProcessEnv;
  readonly stdin: NodeJS.ReadableStream;
}
