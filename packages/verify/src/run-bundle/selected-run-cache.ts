import * as fs from "node:fs";
import * as path from "node:path";

import { isTerminalRunStatus } from "@framelia/contracts/workflow";

import { ATTEMPTS_DIR_NAME, CASES_DIR_NAME, runDir, runRecordPath } from "./layout.ts";
import { readSelectedRun, type SelectedRun } from "./selected-run.ts";

/** Identity of one file version: run.json is replaced atomically, so any rewrite changes it. */
function fileStamp(filePath: string): string {
  try {
    const stat = fs.statSync(filePath);
    return `${stat.ino}:${stat.size}:${stat.mtimeMs}`;
  } catch {
    return "missing";
  }
}

function readDirectoryNames(directory: string): string[] {
  try {
    return fs.readdirSync(directory).toSorted();
  } catch {
    return [];
  }
}

/**
 * Names of every published attempt directory. Attempts are published as immutable units
 * (one atomic directory rename) without rewriting run.json, so for a running run this
 * listing -- not run.json -- is what changes when a new attempt lands.
 */
function attemptsStamp(root: string, runId: string): string {
  const casesRoot = path.join(runDir(root, runId), CASES_DIR_NAME);
  return readDirectoryNames(casesRoot)
    .map(
      (caseName) =>
        `${caseName}/${readDirectoryNames(path.join(casesRoot, caseName, ATTEMPTS_DIR_NAME)).join(",")}`,
    )
    .join(";");
}

/**
 * Memoizes `project(readSelectedRun(root, runId))` for one explicit run, so a live source
 * reads and hashes the run's evidence once per change instead of on every call.
 *
 * The cache is keyed on run.json's own file identity and, while the run is not terminal,
 * on the published attempt directories. A terminal run with an unchanged run.json is
 * served without touching the filesystem beyond one stat. Stamps are taken before the
 * read, so a change racing the read only causes one extra recompute, never a stale hit.
 * A failed read is rethrown and never cached.
 */
export function cacheSelectedRunProjection<T>(
  root: string,
  runId: string,
  project: (selectedRun: SelectedRun) => T,
): () => T {
  let cached: { record: string; attempts?: string; terminal: boolean; value: T } | undefined;
  return () => {
    const record = fileStamp(runRecordPath(root, runId));
    if (cached?.terminal && cached.record === record) return cached.value;
    const attempts = attemptsStamp(root, runId);
    if (cached && cached.record === record && cached.attempts === attempts) return cached.value;
    const selectedRun = readSelectedRun(root, runId);
    cached = {
      record,
      attempts,
      terminal: isTerminalRunStatus(selectedRun.record.status),
      value: project(selectedRun),
    };
    return cached.value;
  };
}
