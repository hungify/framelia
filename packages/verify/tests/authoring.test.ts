import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { withAuthoringLock } from "../src/authoring.ts";
import { AppError } from "../src/types.ts";

const roots: string[] = [];

function temporaryRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-authoring-lock-"));
  roots.push(root);
  return root;
}

function lockPath(root: string): string {
  return path.join(root, ".framelia", "authoring.lock");
}

function writeLock(root: string, pid: number, token = "stale-owner"): void {
  fs.mkdirSync(path.dirname(lockPath(root)), { recursive: true });
  fs.writeFileSync(
    lockPath(root),
    `${JSON.stringify({
      formatVersion: 1,
      pid,
      token,
      createdAt: "2026-09-25T00:00:00.000Z",
    })}\n`,
  );
}

function errorFrom(reason: unknown): AppError {
  expect(reason).toBeInstanceOf(AppError);
  return reason as AppError;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("withAuthoringLock", () => {
  it("writes its PID and blocks a second author while the owner is live", async () => {
    const root = temporaryRoot();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const holder = withAuthoringLock(root, async () => {
      entered.resolve();
      await release.promise;
    });
    await entered.promise;

    const owner = JSON.parse(fs.readFileSync(lockPath(root), "utf8"));
    expect(owner).toMatchObject({ formatVersion: 1, pid: process.pid });
    expect(owner.token).toEqual(expect.any(String));

    const blocked = await withAuthoringLock(root, () => undefined).catch((error) => error);
    const appError = errorFrom(blocked);
    expect(appError.code).toBe("AUTHORING_LOCKED");
    expect(appError.message).toContain(path.resolve(lockPath(root)));
    expect(appError.message).toContain(`PID ${process.pid}`);
    expect(fs.existsSync(lockPath(root))).toBe(true);

    release.resolve();
    await holder;
    expect(fs.existsSync(lockPath(root))).toBe(false);
  });

  it("reclaims a stale lock whose owner PID is no longer alive", async () => {
    const root = temporaryRoot();
    writeLock(root, 424_242);
    let observedPid: number | undefined;
    let ran = false;

    await withAuthoringLock(
      root,
      () => {
        ran = true;
        const owner = JSON.parse(fs.readFileSync(lockPath(root), "utf8"));
        expect(owner.pid).toBe(process.pid);
      },
      {
        isProcessAlive(pid) {
          observedPid = pid;
          return false;
        },
      },
    );

    expect(observedPid).toBe(424_242);
    expect(ran).toBe(true);
    expect(fs.existsSync(lockPath(root))).toBe(false);
    expect(fs.readdirSync(path.join(root, ".framelia"))).toEqual([]);
  });

  it("does not let simultaneous stale reclaimers delete the live replacement", async () => {
    const root = temporaryRoot();
    writeLock(root, 424_242);
    const bothObserved = Promise.withResolvers<void>();
    const releaseWinner = Promise.withResolvers<void>();
    const winnerStarted = Promise.withResolvers<number>();
    let observers = 0;
    const dependencies = {
      isProcessAlive: (pid: number) => pid === process.pid,
      beforeReclaim: async () => {
        observers += 1;
        if (observers === 2) bothObserved.resolve();
        await bothObserved.promise;
      },
    };
    const contender = (id: number) =>
      withAuthoringLock(
        root,
        async () => {
          winnerStarted.resolve(id);
          await releaseWinner.promise;
          return id;
        },
        dependencies,
      );

    const first = contender(1);
    const second = contender(2);
    const winner = await winnerStarted.promise;
    const loser = winner === 1 ? second : first;
    const loserError = errorFrom(await loser.catch((error) => error));

    expect(loserError.code).toBe("AUTHORING_LOCKED");
    expect(JSON.parse(fs.readFileSync(lockPath(root), "utf8"))).toMatchObject({
      pid: process.pid,
    });
    expect(fs.existsSync(`${lockPath(root)}.reclaim`)).toBe(false);

    releaseWinner.resolve();
    await expect(winner === 1 ? first : second).resolves.toBe(winner);
    expect(fs.existsSync(lockPath(root))).toBe(false);
  });

  it("keeps a malformed lock for explicit manual recovery", async () => {
    const root = temporaryRoot();
    fs.mkdirSync(path.dirname(lockPath(root)), { recursive: true });
    fs.writeFileSync(lockPath(root), "not-json\n");

    const blocked = await withAuthoringLock(root, () => undefined).catch((error) => error);
    const appError = errorFrom(blocked);
    expect(appError.code).toBe("AUTHORING_LOCKED");
    expect(appError.message).toContain(path.resolve(lockPath(root)));
    expect(appError.message).toContain("manually");
    expect(fs.readFileSync(lockPath(root), "utf8")).toBe("not-json\n");
  });
});
