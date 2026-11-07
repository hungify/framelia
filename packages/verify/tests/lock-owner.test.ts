import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { pageBaselineImagePath, promotePageBaseline } from "../src/baseline/page.ts";
import { isLockOwnerDead, type LockOwner } from "../src/lock-owner.ts";
import { runDir } from "../src/run-bundle/layout.ts";
import { withRunLock } from "../src/run-bundle/lock.ts";
import { AppError } from "../src/types.ts";

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const dir of temporaryDirectories.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-lock-owner-"));
  temporaryDirectories.push(dir);
  return dir;
}

/** The pid of a process that has already exited -- reaped, so signal 0 reports ESRCH. */
function exitedPid(): number {
  const child = spawnSync(process.execPath, ["-e", ""]);
  if (typeof child.pid !== "number") throw new Error("could not spawn a short-lived child");
  return child.pid;
}

function owner(overrides: Partial<LockOwner> = {}): LockOwner {
  return {
    pid: exitedPid(),
    hostname: os.hostname(),
    startedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("isLockOwnerDead", () => {
  it("is true only for a same-host pid that no longer exists", () => {
    expect(isLockOwnerDead(owner())).toBe(true);
    expect(isLockOwnerDead(owner({ pid: process.ppid }))).toBe(false);
    expect(isLockOwnerDead(owner({ pid: process.pid }))).toBe(false);
    expect(isLockOwnerDead(owner({ hostname: `${os.hostname()}-elsewhere` }))).toBe(false);
  });
});

function heldRunLock(root: string, lockOwner: LockOwner | string): void {
  const lockDir = path.join(runDir(root, "run-1"), "lock");
  fs.mkdirSync(lockDir, { recursive: true });
  fs.writeFileSync(
    path.join(lockDir, "owner.json"),
    typeof lockOwner === "string" ? lockOwner : JSON.stringify(lockOwner),
  );
}

describe("withRunLock stale-lock recovery", () => {
  it("reclaims a lock whose same-host owner process is gone", async () => {
    const root = tempDir();
    heldRunLock(root, owner());
    await expect(withRunLock(root, "run-1", () => "ran", { timeoutMs: 200 })).resolves.toBe("ran");
    expect(fs.existsSync(path.join(runDir(root, "run-1"), "lock"))).toBe(false);
  });

  it.each([
    ["a live owner", owner({ pid: process.ppid })],
    ["an owner on another host", owner({ hostname: `${os.hostname()}-elsewhere` })],
    ["an unreadable owner record", "not json"],
  ])("still times out on %s", async (_label, lockOwner) => {
    const root = tempDir();
    heldRunLock(root, lockOwner);
    const error = await withRunLock(root, "run-1", () => "ran", { timeoutMs: 100 }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("RUN_BUNDLE_LOCK_TIMEOUT");
  });

  it("records its own owner while held and removes the lock afterwards", async () => {
    const root = tempDir();
    const ownerPath = path.join(runDir(root, "run-1"), "lock", "owner.json");
    const recorded = await withRunLock(root, "run-1", () =>
      JSON.parse(fs.readFileSync(ownerPath, "utf8")),
    );
    expect(recorded).toMatchObject({ pid: process.pid, hostname: os.hostname() });
    expect(fs.existsSync(path.dirname(ownerPath))).toBe(false);
  });
});

describe("promotePageBaseline stale-lock recovery", () => {
  function capture(): string {
    const sourcePath = path.join(tempDir(), "capture.png");
    fs.writeFileSync(sourcePath, "capture");
    return sourcePath;
  }

  it("reclaims a promotion lock left by a crashed same-host promotion", () => {
    const outDir = tempDir();
    fs.writeFileSync(path.join(outDir, ".web-baseline-promotion.lock"), JSON.stringify(owner()));
    const result = promotePageBaseline({ sourcePath: capture(), outDir, promotedBy: "alice" });
    expect(result.baselinePath).toBe(pageBaselineImagePath(outDir, 1));
    expect(fs.existsSync(path.join(outDir, ".web-baseline-promotion.lock"))).toBe(false);
  });

  it("refuses a promotion lock held by a live process", () => {
    const outDir = tempDir();
    fs.writeFileSync(
      path.join(outDir, ".web-baseline-promotion.lock"),
      JSON.stringify(owner({ pid: process.ppid })),
    );
    expect(() =>
      promotePageBaseline({ sourcePath: capture(), outDir, promotedBy: "alice" }),
    ).toThrow(/active promotion/i);
    expect(fs.existsSync(pageBaselineImagePath(outDir, 1))).toBe(false);
  });
});
