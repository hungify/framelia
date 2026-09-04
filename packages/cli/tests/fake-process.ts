import type { CliRuntime } from "../src/runtime-types.ts";

export interface FakeProcess extends CliRuntime {
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
