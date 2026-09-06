import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { RecordStorageStateOptions, RecordStorageStateResult } from "@framelia/verify/cli";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UsageError } from "../src/exit.ts";
import type { AuthDependencies } from "../src/internal/auth.ts";
import { authCommand } from "../src/internal/auth.ts";
import type { PromptAdapter } from "../src/internal/prompts.ts";
import type { CliRuntime } from "../src/runtime-types.ts";

function fakeDeps(overrides: Partial<AuthDependencies> = {}): AuthDependencies {
  return {
    recordStorageState: vi.fn<
      (options: RecordStorageStateOptions) => Promise<RecordStorageStateResult>
    >(async (options) => {
      await options.waitForUser();
      fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
      fs.writeFileSync(options.outputPath, "{}");
      return { outputPath: options.outputPath, finalUrl: "http://localhost:3000/dashboard" };
    }),
    ...overrides,
  };
}

function fakeRuntime(overrides: Partial<CliRuntime> = {}): CliRuntime {
  return {
    cwd: () => process.cwd(),
    env: {},
    stdin: process.stdin,
    stdout: { write: vi.fn<(text: string) => void>() },
    stderr: { write: vi.fn<(text: string) => void>() },
    exitCode: undefined,
    ...overrides,
  };
}

function recordingPrompts(confirmAnswers: boolean[]): {
  adapter: PromptAdapter;
  calls: string[];
} {
  const calls: string[] = [];
  let confirmIndex = 0;
  const adapter: PromptAdapter = {
    interactive: false,
    intro: (message) => calls.push(`intro:${message}`),
    outro: (message) => calls.push(`outro:${message}`),
    note: (_message, title) => calls.push(`note:${title}`),
    warn: () => undefined,
    cancel: () => undefined,
    confirm: async (message) => {
      calls.push(`confirm:${message}`);
      return confirmAnswers[confirmIndex++] ?? true;
    },
    text: async () => {
      throw new Error("unexpected text prompt");
    },
    select: async () => {
      throw new Error("unexpected select prompt");
    },
  };
  return { adapter, calls };
}

const projectRoots: string[] = [];
afterEach(() => {
  for (const directory of projectRoots.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

function tempProjectWithConfig(storageStatePath = "state.json"): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-cli-auth-prompts-"));
  projectRoots.push(directory);
  fs.writeFileSync(
    path.join(directory, "framelia.config.ts"),
    `export default { storageStatePath: ${JSON.stringify(storageStatePath)} };\n`,
  );
  return directory;
}

describe("auth prompt sequence", () => {
  it("intro, then (no existing state) straight to login-completion confirm, then note, then outro", async () => {
    const projectRoot = tempProjectWithConfig("state.json");
    const { adapter, calls } = recordingPrompts([true]);

    await authCommand(
      { url: "http://localhost/login", projectRoot, yes: undefined },
      adapter,
      fakeRuntime({ cwd: () => projectRoot }),
      fakeDeps(),
    );

    expect(calls).toEqual([
      "intro:Record Playwright login state",
      "confirm:Finish login in browser, then save session?",
      "note:Auth ready",
      "outro:Use target.auth=storageState for protected screens.",
    ]);
  });

  it("intro, then replacement confirm, then login-completion confirm, then note, then outro", async () => {
    const projectRoot = tempProjectWithConfig("state.json");
    fs.writeFileSync(path.join(projectRoot, "state.json"), "{}");
    const { adapter, calls } = recordingPrompts([true, true]);

    await authCommand(
      { url: "http://localhost/login", projectRoot, yes: undefined },
      adapter,
      fakeRuntime({ cwd: () => projectRoot }),
      fakeDeps(),
    );

    expect(calls).toEqual([
      "intro:Record Playwright login state",
      "confirm:Replace existing auth state at state.json?",
      "confirm:Finish login in browser, then save session?",
      "note:Auth ready",
      "outro:Use target.auth=storageState for protected screens.",
    ]);
  });

  it("cancelling the replacement confirm short-circuits before the login-completion prompt", async () => {
    const projectRoot = tempProjectWithConfig("state.json");
    fs.writeFileSync(path.join(projectRoot, "state.json"), "{}");
    const { adapter, calls } = recordingPrompts([false]);
    const deps = fakeDeps();

    await expect(
      authCommand(
        { url: "http://localhost/login", projectRoot, yes: undefined },
        adapter,
        fakeRuntime({ cwd: () => projectRoot }),
        deps,
      ),
    ).rejects.toThrow(new UsageError("Auth capture cancelled."));

    expect(calls).toEqual([
      "intro:Record Playwright login state",
      "confirm:Replace existing auth state at state.json?",
    ]);
    expect(deps.recordStorageState).not.toHaveBeenCalled();
  });

  it("cancelling the login-completion confirm short-circuits before note/outro", async () => {
    const projectRoot = tempProjectWithConfig("state.json");
    const { adapter, calls } = recordingPrompts([false]);

    await expect(
      authCommand(
        { url: "http://localhost/login", projectRoot, yes: undefined },
        adapter,
        fakeRuntime({ cwd: () => projectRoot }),
        fakeDeps(),
      ),
    ).rejects.toThrow(new UsageError("Auth capture cancelled."));

    expect(calls).toEqual([
      "intro:Record Playwright login state",
      "confirm:Finish login in browser, then save session?",
    ]);
  });

  it("--yes skips the replacement confirm but the intro still fires and login-completion is still asked", async () => {
    const projectRoot = tempProjectWithConfig("state.json");
    fs.writeFileSync(path.join(projectRoot, "state.json"), "{}");
    const { adapter, calls } = recordingPrompts([true]);

    await authCommand(
      { url: "http://localhost/login", projectRoot, yes: true },
      adapter,
      fakeRuntime({ cwd: () => projectRoot }),
      fakeDeps(),
    );

    expect(calls).toEqual([
      "intro:Record Playwright login state",
      "confirm:Finish login in browser, then save session?",
      "note:Auth ready",
      "outro:Use target.auth=storageState for protected screens.",
    ]);
  });
});
