/**
 * Process-facing subset of `NodeJS.Process` that host-facing `internal/*.ts` functions
 * receive explicitly. Production adapts the real `process` to this shape; tests provide
 * a small fake instead of a full `NodeJS.Process` double. Deliberately does not import
 * `@stricli/core` so `internal/*.ts` modules can depend on it without pulling in the
 * Stricli shell.
 */
export interface CliRuntime {
  readonly cwd: () => string;
  readonly env: NodeJS.ProcessEnv;
  readonly stdin: NodeJS.ReadableStream;
  readonly stdout: { write(text: string): void };
  readonly stderr: { write(text: string): void };
  exitCode?: number | string | null;
}
