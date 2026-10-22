import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { RecordStorageStateOptions, RecordStorageStateResult } from "@framelia/verify/cli";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BrowserAdapter } from "../src/environment.ts";
import { authCommand } from "../src/internal/auth.ts";
import type { PromptAdapter } from "../src/internal/prompts.ts";
import type { CliRuntime } from "../src/runtime-types.ts";
import { testEnvironment } from "./test-environment.ts";

function fakeDeps(
  overrides: Partial<Pick<BrowserAdapter, "recordStorageState">> = {},
): Pick<BrowserAdapter, "recordStorageState"> {
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

const projectRoots: string[] = [];
afterEach(() => {
  for (const directory of projectRoots.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

function tempProjectWithConfig(storageStatePath = "state.json"): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-cli-auth-"));
  projectRoots.push(directory);
  fs.writeFileSync(
    path.join(directory, "framelia.config.ts"),
    `export default { storageStatePath: ${JSON.stringify(storageStatePath)} };\n`,
  );
  return directory;
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

function fakePrompts(overrides: Partial<PromptAdapter> = {}): PromptAdapter {
  return {
    interactive: true,
    intro: vi.fn<PromptAdapter["intro"]>(),
    outro: vi.fn<PromptAdapter["outro"]>(),
    note: vi.fn<PromptAdapter["note"]>(),
    warn: vi.fn<PromptAdapter["warn"]>(),
    cancel: vi.fn<PromptAdapter["cancel"]>(),
    confirm: vi.fn<PromptAdapter["confirm"]>(async () => true),
    text: vi.fn<PromptAdapter["text"]>(async () => {
      throw new Error("unexpected text prompt");
    }),
    select: async () => {
      throw new Error("unexpected select prompt");
    },
    ...overrides,
  };
}

describe("authCommand: URL validation", () => {
  it("rejects a non-http(s) URL before touching config or prompts", async () => {
    const prompts = fakePrompts();
    await expect(
      authCommand(
        { url: "not-a-url", projectRoot: undefined, yes: undefined },
        testEnvironment(fakeRuntime(), { prompts: prompts, browser: fakeDeps() }),
      ),
    ).resolves.toMatchObject({
      exitCode: 2,
      body: { diagnostics: [{ message: "Auth URL must use http:// or https://." }] },
    });
    expect(prompts.intro).not.toHaveBeenCalled();
  });

  it("rejects non-loopback HTTP because auth persists browser storage state", async () => {
    const prompts = fakePrompts();
    await expect(
      authCommand(
        { url: "http://example.test/login", projectRoot: undefined, yes: undefined },
        testEnvironment(fakeRuntime(), { prompts: prompts, browser: fakeDeps() }),
      ),
    ).resolves.toMatchObject({
      exitCode: 2,
      body: { diagnostics: [{ message: expect.stringMatching(/must use https:\/\//) }] },
    });
    expect(prompts.intro).not.toHaveBeenCalled();
  });
});

describe("authCommand: config precondition", () => {
  it("reports an exit-2 outcome when storageStatePath is not configured", async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-cli-auth-noconfig-"));
    projectRoots.push(projectRoot);
    fs.writeFileSync(path.join(projectRoot, "framelia.config.ts"), "export default {};\n");

    await expect(
      authCommand(
        { url: "http://localhost/login", projectRoot, yes: undefined },
        testEnvironment(fakeRuntime({ cwd: () => projectRoot }), {
          prompts: fakePrompts(),
          browser: fakeDeps(),
        }),
      ),
    ).resolves.toMatchObject({
      exitCode: 2,
      body: {
        diagnostics: [
          {
            message:
              "storageStatePath is not configured. Uncomment it in framelia.config.ts before running framelia auth.",
          },
        ],
      },
    });
  });
});

describe("authCommand: replacement confirmation", () => {
  it("asks for confirmation when a storage state file already exists", async () => {
    const projectRoot = tempProjectWithConfig("state.json");
    fs.writeFileSync(path.join(projectRoot, "state.json"), "{}");
    const prompts = fakePrompts();

    await authCommand(
      { url: "http://localhost/login", projectRoot, yes: undefined },
      testEnvironment(fakeRuntime({ cwd: () => projectRoot }), {
        prompts: prompts,
        browser: fakeDeps(),
      }),
    );

    expect(prompts.confirm).toHaveBeenCalledWith(
      `Replace existing auth state at state.json?`,
      true,
    );
  });

  it("skips the replacement confirmation when --yes is set", async () => {
    const projectRoot = tempProjectWithConfig("state.json");
    fs.writeFileSync(path.join(projectRoot, "state.json"), "{}");
    const prompts = fakePrompts();

    await authCommand(
      { url: "http://localhost/login", projectRoot, yes: true },
      testEnvironment(fakeRuntime({ cwd: () => projectRoot }), {
        prompts: prompts,
        browser: fakeDeps(),
      }),
    );

    expect(prompts.confirm).not.toHaveBeenCalledWith(
      expect.stringContaining("Replace existing"),
      expect.anything(),
    );
  });

  it("does not ask for confirmation when no storage state file exists yet", async () => {
    const projectRoot = tempProjectWithConfig("state.json");
    const prompts = fakePrompts();

    await authCommand(
      { url: "http://localhost/login", projectRoot, yes: undefined },
      testEnvironment(fakeRuntime({ cwd: () => projectRoot }), {
        prompts: prompts,
        browser: fakeDeps(),
      }),
    );

    expect(prompts.confirm).not.toHaveBeenCalledWith(
      expect.stringContaining("Replace existing"),
      expect.anything(),
    );
  });

  it("reports 'Auth capture cancelled.' when replacement is declined", async () => {
    const projectRoot = tempProjectWithConfig("state.json");
    fs.writeFileSync(path.join(projectRoot, "state.json"), "{}");
    const prompts = fakePrompts({
      confirm: vi.fn<PromptAdapter["confirm"]>(async () => false),
    });

    await expect(
      authCommand(
        { url: "http://localhost/login", projectRoot, yes: undefined },
        testEnvironment(fakeRuntime({ cwd: () => projectRoot }), {
          prompts: prompts,
          browser: fakeDeps(),
        }),
      ),
    ).resolves.toMatchObject({
      exitCode: 2,
      body: { diagnostics: [{ message: "Auth capture cancelled." }] },
    });
  });
});

describe("authCommand: login completion", () => {
  it("always asks the login-completion prompt, even with --yes", async () => {
    const projectRoot = tempProjectWithConfig("state.json");
    const prompts = fakePrompts();

    await authCommand(
      { url: "http://localhost/login", projectRoot, yes: true },
      testEnvironment(fakeRuntime({ cwd: () => projectRoot }), {
        prompts: prompts,
        browser: fakeDeps(),
      }),
    );

    expect(prompts.confirm).toHaveBeenCalledWith(
      "Finish login in browser, then save session?",
      true,
    );
  });

  it("reports 'Auth capture cancelled.' when login completion is declined", async () => {
    const projectRoot = tempProjectWithConfig("state.json");
    const prompts = fakePrompts({
      confirm: vi.fn<PromptAdapter["confirm"]>(async () => false),
    });

    await expect(
      authCommand(
        { url: "http://localhost/login", projectRoot, yes: true },
        testEnvironment(fakeRuntime({ cwd: () => projectRoot }), {
          prompts: prompts,
          browser: fakeDeps(),
        }),
      ),
    ).resolves.toMatchObject({
      exitCode: 2,
      body: { diagnostics: [{ message: "Auth capture cancelled." }] },
    });
  });
});

describe("authCommand: saved storage-state output", () => {
  it("reports the final URL and the configured (relative) storage-state path", async () => {
    const projectRoot = tempProjectWithConfig("nested/state.json");
    const prompts = fakePrompts();

    await authCommand(
      { url: "http://localhost/login", projectRoot, yes: true },
      testEnvironment(fakeRuntime({ cwd: () => projectRoot }), {
        prompts: prompts,
        browser: fakeDeps(),
      }),
    );

    expect(prompts.note).toHaveBeenCalledWith(
      [
        "Final URL: http://localhost:3000/dashboard",
        "Saved: nested/state.json",
        "Session file remains ignored by Git.",
      ].join("\n"),
      "Auth ready",
    );
    expect(prompts.outro).toHaveBeenCalledWith(
      "Use target.auth=storageState for protected screens.",
    );
  });
});

describe("authCommand: structured outcome", () => {
  it("fails fast with a usage outcome when no person can confirm the login", async () => {
    const projectRoot = tempProjectWithConfig("state.json");
    const deps = fakeDeps();
    const result = await authCommand(
      { url: "http://localhost/login", projectRoot, yes: true },
      testEnvironment(fakeRuntime({ cwd: () => projectRoot }), {
        prompts: fakePrompts({ interactive: false }),
        browser: deps,
      }),
    );
    expect(result).toMatchObject({
      exitCode: 2,
      body: {
        kind: "framelia.auth-outcome",
        diagnostics: [{ code: "INTERACTIVE_TERMINAL_REQUIRED" }],
      },
    });
    expect(deps.recordStorageState).not.toHaveBeenCalled();
  });

  it("returns a JSON outcome naming the saved path without query secrets", async () => {
    const projectRoot = tempProjectWithConfig("nested/state.json");
    const result = await authCommand(
      { url: "http://localhost/login", projectRoot, yes: true },
      testEnvironment(fakeRuntime({ cwd: () => projectRoot }), {
        prompts: fakePrompts(),
        browser: fakeDeps({
          recordStorageState: async (options) => {
            await options.waitForUser();
            return {
              outputPath: options.outputPath,
              finalUrl: "http://localhost/home?code=s3cret",
            };
          },
        }),
      }),
    );
    expect(result).toEqual({
      ok: true,
      exitCode: 0,
      body: {
        formatVersion: 1,
        kind: "framelia.auth-outcome",
        command: "auth",
        executionState: "completed",
        exitCode: 0,
        storageStatePath: "nested/state.json",
        finalUrl: "http://localhost/home",
        diagnostics: [],
      },
    });
  });
});
