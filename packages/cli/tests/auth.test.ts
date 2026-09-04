import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { RecordStorageStateOptions, RecordStorageStateResult } from "@framelia/verify/cli";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UsageError } from "../src/errors.ts";
import type { AuthDependencies, AuthPromptAdapter } from "../src/internal/auth.ts";
import { authCommand } from "../src/internal/auth.ts";
import type { CliRuntime } from "../src/runtime-types.ts";

// `recordStorageState` is injected (never module-mocked) so these tests never touch a
// real browser/network -- see `AuthDependencies` in `internal/auth.ts`.
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

function fakePrompts(overrides: Partial<AuthPromptAdapter> = {}): AuthPromptAdapter {
  return {
    intro: vi.fn<AuthPromptAdapter["intro"]>(),
    outro: vi.fn<AuthPromptAdapter["outro"]>(),
    note: vi.fn<AuthPromptAdapter["note"]>(),
    confirm: vi.fn<AuthPromptAdapter["confirm"]>(async () => true),
    ...overrides,
  };
}

describe("authCommand: URL validation", () => {
  it("rejects a non-http(s) URL before touching config or prompts", async () => {
    const prompts = fakePrompts();
    await expect(
      authCommand(
        { url: "not-a-url", projectRoot: undefined, yes: undefined },
        prompts,
        fakeRuntime(),
        fakeDeps(),
      ),
    ).rejects.toThrow(new UsageError("Auth URL must use http:// or https://."));
    expect(prompts.intro).not.toHaveBeenCalled();
  });
});

describe("authCommand: config precondition", () => {
  it("throws UsageError when storageStatePath is not configured", async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-cli-auth-noconfig-"));
    projectRoots.push(projectRoot);
    fs.writeFileSync(path.join(projectRoot, "framelia.config.ts"), "export default {};\n");

    await expect(
      authCommand(
        { url: "http://localhost/login", projectRoot, yes: undefined },
        fakePrompts(),
        fakeRuntime({ cwd: () => projectRoot }),
        fakeDeps(),
      ),
    ).rejects.toThrow(
      new UsageError(
        "storageStatePath is not configured. Uncomment it in framelia.config.ts before running framelia auth.",
      ),
    );
  });
});

describe("authCommand: replacement confirmation", () => {
  it("asks for confirmation when a storage state file already exists", async () => {
    const projectRoot = tempProjectWithConfig("state.json");
    fs.writeFileSync(path.join(projectRoot, "state.json"), "{}");
    const prompts = fakePrompts();

    await authCommand(
      { url: "http://localhost/login", projectRoot, yes: undefined },
      prompts,
      fakeRuntime({ cwd: () => projectRoot }),
      fakeDeps(),
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
      prompts,
      fakeRuntime({ cwd: () => projectRoot }),
      fakeDeps(),
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
      prompts,
      fakeRuntime({ cwd: () => projectRoot }),
      fakeDeps(),
    );

    expect(prompts.confirm).not.toHaveBeenCalledWith(
      expect.stringContaining("Replace existing"),
      expect.anything(),
    );
  });

  it("throws UsageError('Auth capture cancelled.') when replacement is declined", async () => {
    const projectRoot = tempProjectWithConfig("state.json");
    fs.writeFileSync(path.join(projectRoot, "state.json"), "{}");
    const prompts = fakePrompts({
      confirm: vi.fn<AuthPromptAdapter["confirm"]>(async () => false),
    });

    await expect(
      authCommand(
        { url: "http://localhost/login", projectRoot, yes: undefined },
        prompts,
        fakeRuntime({ cwd: () => projectRoot }),
        fakeDeps(),
      ),
    ).rejects.toThrow(new UsageError("Auth capture cancelled."));
  });
});

describe("authCommand: login completion", () => {
  it("always asks the login-completion prompt, even with --yes", async () => {
    const projectRoot = tempProjectWithConfig("state.json");
    const prompts = fakePrompts();

    await authCommand(
      { url: "http://localhost/login", projectRoot, yes: true },
      prompts,
      fakeRuntime({ cwd: () => projectRoot }),
      fakeDeps(),
    );

    expect(prompts.confirm).toHaveBeenCalledWith(
      "Finish login in browser, then save session?",
      true,
    );
  });

  it("throws UsageError('Auth capture cancelled.') when login completion is declined", async () => {
    const projectRoot = tempProjectWithConfig("state.json");
    const prompts = fakePrompts({
      confirm: vi.fn<AuthPromptAdapter["confirm"]>(async () => false),
    });

    await expect(
      authCommand(
        { url: "http://localhost/login", projectRoot, yes: true },
        prompts,
        fakeRuntime({ cwd: () => projectRoot }),
        fakeDeps(),
      ),
    ).rejects.toThrow(new UsageError("Auth capture cancelled."));
  });
});

describe("authCommand: saved storage-state output", () => {
  it("reports the final URL and the configured (relative) storage-state path", async () => {
    const projectRoot = tempProjectWithConfig("nested/state.json");
    const prompts = fakePrompts();

    await authCommand(
      { url: "http://localhost/login", projectRoot, yes: true },
      prompts,
      fakeRuntime({ cwd: () => projectRoot }),
      fakeDeps(),
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
