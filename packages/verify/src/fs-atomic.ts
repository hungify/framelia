import * as fs from "node:fs";
import * as path from "node:path";

import { nanoid } from "nanoid";

export function fsyncDirectory(
  directory: string,
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform === "win32") return;
  const descriptor = fs.openSync(directory, "r");
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

/** Create each missing path component and durably publish its parent entry. */
function ensureDirectoryDurable(directory: string): void {
  const missing: string[] = [];
  let candidate = directory;
  while (!fs.existsSync(candidate)) {
    missing.push(candidate);
    const parent = path.dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  for (const entry of missing.toReversed()) {
    try {
      fs.mkdirSync(entry);
      fsyncDirectory(path.dirname(entry));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
}

/**
 * Durably replace one file without exposing partial bytes. Newly created directory
 * entries, the temporary file, and the containing directory are fsync'd around the
 * rename so success cannot leave a contract pointer whose bytes existed only in cache.
 */
export function writeFileAtomic(filePath: string, content: string | Buffer): void {
  const directory = path.dirname(filePath);
  ensureDirectoryDurable(directory);
  const temporary = `${filePath}.${process.pid}.${nanoid()}.tmp`;
  try {
    const descriptor = fs.openSync(temporary, "wx", 0o600);
    try {
      fs.writeFileSync(descriptor, content);
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    fs.renameSync(temporary, filePath);
    fsyncDirectory(directory);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}
