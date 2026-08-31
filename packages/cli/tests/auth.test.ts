import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { RecordStorageStateOptions, RecordStorageStateResult } from "@framelia/verify/cli";
import { afterEach, describe, expect, it, vi } from "vitest";

import { authCommand } from "../src/commands/auth.ts";

const CANCEL = Symbol("cancel");
const { confirmMock, recordStorageStateMock } = vi.hoisted(() => ({
  confirmMock: vi.fn<(options: { message: string }) => Promise<boolean | symbol>>(),
  recordStorageStateMock:
    vi.fn<(options: RecordStorageStateOptions) => Promise<RecordStorageStateResult>>(),
}));

vi.mock("@clack/prompts", () => ({
  confirm: (options: { message: string }) => confirmMock(options),
  isCancel: (value: unknown) => value === CANCEL,
  intro: vi.fn<(message: string) => void>(),
  outro: vi.fn<(message: string) => void>(),
  note: vi.fn<(message: string, title?: string) => void>(),
}));

vi.mock("@framelia/verify/cli", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@framelia/verify/cli")>();
  return { ...actual, recordStorageState: recordStorageStateMock };
});

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  confirmMock.mockReset();
  recordStorageStateMock.mockReset();
});

function projectWithStorageStateConfig(): string {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-auth-"));
  temporaryDirectories.push(projectRoot);
  fs.writeFileSync(
    path.join(projectRoot, "framelia.config.mjs"),
    'export default { storageStatePath: ".framelia/auth/user.json" };\n',
  );
  return projectRoot;
}

describe("authCommand", () => {
  it("rejects a non-http(s) auth URL before touching the project", async () => {
    await expect(
      authCommand({ url: "ftp://example.test", projectRoot: os.tmpdir(), yes: true }),
    ).rejects.toThrow("Auth URL must use http:// or https://.");
    expect(recordStorageStateMock).not.toHaveBeenCalled();
  });

  it("requires storageStatePath to be configured", async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-auth-unconfigured-"));
    temporaryDirectories.push(projectRoot);
    fs.writeFileSync(path.join(projectRoot, "framelia.config.mjs"), "export default {};\n");

    await expect(
      authCommand({ url: "https://example.test/login", projectRoot, yes: true }),
    ).rejects.toThrow("storageStatePath is not configured");
    expect(recordStorageStateMock).not.toHaveBeenCalled();
  });

  it("--yes skips only the replace-existing-session prompt, not the login-completion prompt", async () => {
    const projectRoot = projectWithStorageStateConfig();
    const statePath = path.join(projectRoot, ".framelia/auth/user.json");
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, "{}");
    recordStorageStateMock.mockImplementation(async (options) => {
      await options.waitForUser();
      return { outputPath: options.outputPath, finalUrl: "https://example.test/after-login" };
    });
    confirmMock.mockResolvedValueOnce(true);

    await authCommand({ url: "https://example.test/login", projectRoot, yes: true });

    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(confirmMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("Finish login") }),
    );
    expect(recordStorageStateMock).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://example.test/login", outputPath: statePath }),
    );
  });

  it("asks to replace an existing session file, and aborts when the user declines", async () => {
    const projectRoot = projectWithStorageStateConfig();
    const statePath = path.join(projectRoot, ".framelia/auth/user.json");
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, "{}");
    confirmMock.mockResolvedValueOnce(false);

    await expect(authCommand({ url: "https://example.test/login", projectRoot })).rejects.toThrow(
      "Auth capture cancelled.",
    );

    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(recordStorageStateMock).not.toHaveBeenCalled();
  });

  it("aborts when the replace-existing-session prompt is cancelled", async () => {
    const projectRoot = projectWithStorageStateConfig();
    const statePath = path.join(projectRoot, ".framelia/auth/user.json");
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, "{}");
    confirmMock.mockResolvedValueOnce(CANCEL);

    await expect(authCommand({ url: "https://example.test/login", projectRoot })).rejects.toThrow(
      "Auth capture cancelled.",
    );
    expect(recordStorageStateMock).not.toHaveBeenCalled();
  });

  it("does not prompt to replace when no prior session file exists, but still confirms before saving", async () => {
    const projectRoot = projectWithStorageStateConfig();
    recordStorageStateMock.mockImplementation(async (options) => {
      await options.waitForUser();
      return { outputPath: options.outputPath, finalUrl: "https://example.test/after-login" };
    });
    confirmMock.mockResolvedValueOnce(true);

    await authCommand({ url: "https://example.test/login", projectRoot });

    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(confirmMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("Finish login") }),
    );
  });
});
