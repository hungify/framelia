import * as fs from "node:fs";
import * as path from "node:path";

import { nanoid } from "nanoid";

import { AppError } from "../types.ts";

export interface StagedFile {
  /** Path relative to the bundle unit's own target directory (portable, forward-slash). */
  relativePath: string;
  content: Buffer | string;
}

/**
 * Multi-file transaction primitive `writeFileAtomic` (fs-atomic.ts) can't provide on its
 * own: it only makes one file's own bytes appear atomically, with no way to publish a set
 * of files as a single all-or-nothing unit, and no notion of "this identity is already
 * taken, reject instead of overwrite." A run/case/attempt bundle needs both -- an attempt
 * with a half-written evidence triplet must never be visible, and a second writer racing
 * for the same identity must fail loudly, not silently clobber or merge.
 *
 * Every file in `files` is written into a fresh, uniquely-named staging directory
 * sitting next to `targetDir` (never touching `targetDir` itself), fsync'd individually
 * (and every containing directory fsync'd too) so the written bytes are durable on
 * stable storage, and only then is the whole staging directory moved into place with one
 * `fs.renameSync`, whose containing directory is fsync'd again afterward -- a host crash
 * at any point before this function returns must never leave a reader observing a
 * bundle whose "publish" apparently succeeded but whose bytes didn't survive the crash.
 * POSIX `rename()` on a directory is atomic when source and destination share the same
 * filesystem/device: a reader either sees `targetDir` fully absent or fully populated,
 * never partial. `targetDir`'s own parent already existing (or not) doesn't matter for
 * this guarantee -- only that the staging directory and `targetDir` resolve to the same
 * device, which is true whenever they share a parent directory, as they do here.
 *
 * Immutability: if `targetDir` already exists, this throws `RUN_BUNDLE_ALREADY_PUBLISHED`
 * without touching it -- a run/case-plan/attempt identity is published exactly once. The
 * same rejection also covers the race window between the initial existence check and the
 * final rename (two concurrent writers for the same identity): the loser's `renameSync`
 * fails with `ENOTEMPTY`/`EEXIST` against the winner's now-existing directory, which is
 * remapped to the same error rather than left as a raw, unattributed `fs` exception.
 *
 * Cross-device: if `targetDir`'s parent and the staging directory somehow resolve to
 * different devices (e.g. `.framelia/runs` is itself a separate mount/symlink target),
 * `rename()` fails with `EXDEV`. This function deliberately refuses to fall back to a
 * non-atomic copy-then-delete in that case -- a copy can be interrupted mid-way and leave
 * a torn bundle behind, which is exactly the failure mode this primitive exists to
 * prevent -- and instead throws `RUN_BUNDLE_CROSS_DEVICE` with a clear explanation. Keep
 * `.framelia/runs` and its parent on one filesystem/device.
 *
 * Every `relativePath` is validated to stay inside the staging directory -- a caller
 * (or, eventually, data derived from an external source) supplying `"../../etc/passwd"`
 * or an absolute path must never let this function write outside its own transaction.
 */
export function publishBundleUnit(targetDir: string, files: readonly StagedFile[]): void {
  if (fs.existsSync(targetDir)) {
    throw new AppError(
      "RUN_BUNDLE_ALREADY_PUBLISHED",
      `A bundle unit is already published at ${targetDir}; publication is immutable -- a second writer for the same identity is rejected, never merged or overwritten.`,
    );
  }

  const parentDir = path.dirname(targetDir);
  fs.mkdirSync(parentDir, { recursive: true });
  const stagingDir = path.join(
    parentDir,
    `.${path.basename(targetDir)}.staging-${process.pid}-${nanoid()}`,
  );
  fs.mkdirSync(stagingDir, { recursive: true });
  const resolvedStagingDir = path.resolve(stagingDir);

  try {
    const syncedDirs = new Set<string>();
    for (const file of files) {
      const destination = resolveStagedDestination(resolvedStagingDir, file.relativePath);
      const destinationDir = path.dirname(destination);
      fs.mkdirSync(destinationDir, { recursive: true });
      fs.writeFileSync(destination, file.content);
      fsyncFile(destination);
      for (const dir of ancestorDirsWithin(resolvedStagingDir, destinationDir)) syncedDirs.add(dir);
    }
    // Deepest first: a child directory's own fsync only guarantees its entries are
    // durable, not that its parent's directory entry for it is -- sync every level.
    for (const dir of [...syncedDirs].toSorted((a, b) => b.length - a.length)) fsyncDir(dir);
  } catch (error) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    throw error;
  }

  try {
    fs.renameSync(stagingDir, targetDir);
    fsyncDir(parentDir);
  } catch (error) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOTEMPTY" || code === "EEXIST") {
      throw new AppError(
        "RUN_BUNDLE_ALREADY_PUBLISHED",
        `A concurrent writer published ${targetDir} first (race detected while finalizing the atomic rename); publication is immutable -- this writer's attempt was rejected, not merged.`,
      );
    }
    if (code === "EXDEV") {
      throw new AppError(
        "RUN_BUNDLE_CROSS_DEVICE",
        `Cannot publish ${targetDir}: its parent directory and the staging directory used to build it are on different filesystems/devices, so POSIX rename() cannot move the bundle unit atomically. Framelia refuses to fall back to a non-atomic copy here (a copy could be interrupted mid-way and publish a torn bundle) -- keep the run bundle root (.framelia/runs) and its parent on one device/volume.`,
      );
    }
    throw error;
  }
}

/** Rejects an absolute path and any empty/`"."`/`".."` segment, then resolves the
 *  destination and reconfirms it still resolves inside `resolvedStagingDir` -- belt and
 *  suspenders against a `relativePath` engineered to escape the staging directory. */
function resolveStagedDestination(resolvedStagingDir: string, relativePath: string): string {
  if (path.isAbsolute(relativePath)) {
    throw new AppError(
      "RUN_BUNDLE_INVALID",
      `Staged file path "${relativePath}" must be relative, not absolute.`,
    );
  }
  const segments = relativePath.split("/");
  if (
    segments.length === 0 ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new AppError(
      "RUN_BUNDLE_INVALID",
      `Staged file path "${relativePath}" must not contain empty, ".", or ".." segments.`,
    );
  }
  const destination = path.resolve(resolvedStagingDir, ...segments);
  if (
    destination !== resolvedStagingDir &&
    !destination.startsWith(`${resolvedStagingDir}${path.sep}`)
  ) {
    throw new AppError(
      "RUN_BUNDLE_INVALID",
      `Staged file path "${relativePath}" resolves outside the staging directory.`,
    );
  }
  return destination;
}

/** Every directory from `dir` up to (and including) `root`, root-most last. */
function ancestorDirsWithin(root: string, dir: string): string[] {
  const dirs: string[] = [];
  let current = dir;
  for (;;) {
    dirs.push(current);
    if (current === root) break;
    current = path.dirname(current);
  }
  return dirs;
}

function fsyncFile(filePath: string): void {
  const fd = fs.openSync(filePath, "r");
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function fsyncDir(dirPath: string): void {
  const fd = fs.openSync(dirPath, "r");
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
