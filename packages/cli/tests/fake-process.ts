import type { CliProcess } from "../src/context.ts";

/**
 * A minimal `CliProcess` double for route-map/scanner-level integration tests. Exercises
 * the `run(argv, { process: fakeProcess })` seam directly (see the rewrite plan's `cli.ts`
 * section) instead of spawning the published bin -- assertions here read captured bytes
 * from `stdout`/`stderr` and the mutated `exitCode`, without touching the real process.
 */
export interface FakeProcess extends CliProcess {
  readonly stdoutText: () => string;
  readonly stderrText: () => string;
}

export function createFakeProcess(env: NodeJS.ProcessEnv = {}): FakeProcess {
  let stdout = "";
  let stderr = "";
  return {
    cwd: () => "/tmp/framelia-fake-cwd",
    env,
    stdin: process.stdin,
    stdout: { write: (text: string) => void (stdout += text) },
    stderr: { write: (text: string) => void (stderr += text) },
    exitCode: undefined,
    stdoutText: () => stdout,
    stderrText: () => stderr,
  };
}
