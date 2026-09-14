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
 * sitting next to `targetDir` (never touching `targetDir` itself), and only once every
 * file has been written successfully is the whole staging directory moved into place with
 * one `fs.renameSync`. POSIX `rename()` on a directory is atomic when source and
 * destination share the same filesystem/device: a reader either sees `targetDir` fully
 * absent or fully populated, never partial. `targetDir`'s own parent already existing (or
 * not) doesn't matter for this guarantee -- only that the staging directory and
 * `targetDir` resolve to the same device, which is true whenever they share a parent
 * directory, as they do here.
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

  try {
    for (const file of files) {
      const destination = path.join(stagingDir, ...file.relativePath.split("/"));
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, file.content);
    }
  } catch (error) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    throw error;
  }

  try {
    fs.renameSync(stagingDir, targetDir);
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
