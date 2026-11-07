import * as fs from "node:fs";
import * as os from "node:os";

import * as z from "zod";

/**
 * Who holds a cross-process lock: written into the lock right after it is acquired so a
 * later contender can tell an abandoned lock (its holder crashed) from a held one.
 */
export interface LockOwner {
  pid: number;
  hostname: string;
  startedAt: string;
}

const lockOwnerSchema = z.object({
  pid: z.number().int().positive(),
  hostname: z.string().min(1),
  startedAt: z.string(),
});

export function currentLockOwner(): LockOwner {
  return { pid: process.pid, hostname: os.hostname(), startedAt: new Date().toISOString() };
}

export function serializeLockOwner(owner: LockOwner): string {
  return `${JSON.stringify(owner)}\n`;
}

/** null when the owner record is missing, partially written, or not ours to interpret. */
export function readLockOwner(ownerPath: string): LockOwner | null {
  try {
    const result = lockOwnerSchema.safeParse(JSON.parse(fs.readFileSync(ownerPath, "utf8")));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/**
 * True only when the owner provably no longer exists: it ran on this host, is not this
 * process, and signal 0 reports ESRCH. A different host, EPERM (alive, another user's),
 * or anything else counts as alive -- a wrong "dead" verdict would let two holders in,
 * whereas a wrong "alive" verdict only falls back to the old timeout behaviour.
 */
export function isLockOwnerDead(owner: LockOwner): boolean {
  if (owner.hostname !== os.hostname() || owner.pid === process.pid) return false;
  try {
    process.kill(owner.pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}

/**
 * Removes a lock whose recorded owner is dead, returning true when it did so (the caller
 * should then retry its own acquire). Contenders serialize through `<lockPath>.reclaim`
 * (an atomic mkdir) and re-read the owner under it, so a lock that another contender
 * already reclaimed and re-acquired between our first read and our removal is never
 * deleted: only a dead owner's record can still be there once we hold the reclaim guard,
 * because nobody else may remove the lock meanwhile. A lock with no readable owner (the
 * holder is between acquiring and recording itself, or wrote it with an older version)
 * is never reclaimed. If a contender crashes while holding the reclaim guard, remove
 * `<lockPath>.reclaim` manually.
 */
export function reclaimStaleLock(
  lockPath: string,
  readOwner: () => LockOwner | null,
  removeLock: () => void,
): boolean {
  const before = readOwner();
  if (!before || !isLockOwnerDead(before)) return false;
  const guard = `${lockPath}.reclaim`;
  try {
    fs.mkdirSync(guard);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
  try {
    const owner = readOwner();
    if (!owner || !isLockOwnerDead(owner)) return false;
    removeLock();
    return true;
  } finally {
    fs.rmSync(guard, { recursive: true, force: true });
  }
}
