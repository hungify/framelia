import * as fs from "node:fs";
import * as path from "node:path";

import type { AuthoredContract, BaselineSnapshot } from "@framelia/contracts/workflow";
import { baselineSnapshotSchema } from "@framelia/contracts/workflow";
import * as z from "zod";

import { canonicalJsonDigest, type CanonicalJsonValue } from "./canonical-json.ts";
import { fileHash } from "./hash.ts";
import { AppError } from "./types.ts";

const BASELINES_DIR_SEGMENTS = [".framelia", "baselines"];
const SNAPSHOT_FILE_NAME = "snapshot.json";
const SHA256_PREFIX = "sha256:";

/**
 * A pinned baseline snapshot resolved from disk, with its own image (and, when present,
 * style) bytes validated against the digests recorded inside the snapshot record itself.
 * `imagePath`/`stylePath` are absolute filesystem paths, ready to hand to compare() or a
 * JSON.parse call -- every byte behind them has already been hashed and checked against
 * the immutable record, so a caller never re-validates them.
 */
export interface PinnedBaseline {
  snapshot: BaselineSnapshot;
  /** Absolute path to the validated expected image bytes. */
  imagePath: string;
  /** Absolute path to the validated expected style JSON, if the snapshot records one. */
  stylePath?: string;
}

/**
 * Resolves and validates the on-disk expected-image (and optional expected-style) bytes
 * a contract's `baseline.snapshotDigest` points at -- the whole of what a pinned Figma
 * comparison needs, with zero Figma credentials or network calls anywhere in this
 * function. The snapshot directory name is derived from the digest itself
 * (`.framelia/baselines/<hex>/snapshot.json`), so a tampered or stale snapshot record
 * can never silently masquerade as the one a contract actually pins: `readPinnedBaseline`
 * recomputes the record's own canonical-JSON digest and every referenced file's raw-byte
 * digest, and throws a descriptive `AppError` the moment any of them disagrees, instead
 * of returning bytes that don't match what the contract promised. `root` is the project
 * root `.framelia/baselines` is resolved under; see `defineFigmaTests`'s own doc comment
 * for how it resolves that root per contract file.
 */
export async function readPinnedBaseline(
  root: string,
  contract: AuthoredContract,
): Promise<PinnedBaseline> {
  const digestHex = contract.baseline.snapshotDigest.slice(SHA256_PREFIX.length);
  const snapshotDir = path.join(root, ...BASELINES_DIR_SEGMENTS, digestHex);
  const snapshotPath = path.join(snapshotDir, SNAPSHOT_FILE_NAME);

  if (!fs.existsSync(snapshotPath)) {
    throw new AppError(
      "PINNED_BASELINE_MISSING",
      `Pinned baseline snapshot for contract "${contract.id}" not found at ${snapshotPath}. Pinned checks never fetch from Figma -- acquire/refresh the baseline explicitly before running this contract.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
  } catch (error) {
    throw new AppError(
      "PINNED_BASELINE_INVALID",
      `Pinned baseline snapshot for contract "${contract.id}" at ${snapshotPath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}.`,
    );
  }

  const result = baselineSnapshotSchema.safeParse(parsed);
  if (!result.success) {
    throw new AppError(
      "PINNED_BASELINE_INVALID",
      `Pinned baseline snapshot for contract "${contract.id}" at ${snapshotPath} failed schema validation: ${z.prettifyError(result.error)}.`,
    );
  }
  const snapshot = result.data;

  const recomputedSnapshotDigest = canonicalJsonDigest(snapshot as CanonicalJsonValue);
  if (recomputedSnapshotDigest !== contract.baseline.snapshotDigest) {
    throw new AppError(
      "PINNED_BASELINE_DIGEST_MISMATCH",
      `Pinned baseline snapshot for contract "${contract.id}" at ${snapshotPath} does not match contract.baseline.snapshotDigest: expected ${contract.baseline.snapshotDigest}, recomputed ${recomputedSnapshotDigest}. Baseline snapshots are content-addressed and immutable -- re-acquire/refresh the baseline instead of hand-editing the file.`,
    );
  }

  if (snapshot.expected.kind !== contract.scope.kind) {
    throw new AppError(
      "PINNED_BASELINE_INVALID",
      `Pinned baseline snapshot for contract "${contract.id}" at ${snapshotPath} has expected.kind "${snapshot.expected.kind}", which disagrees with the contract's own scope.kind "${contract.scope.kind}".`,
    );
  }

  const imagePath = path.resolve(root, snapshot.expected.image.path);
  assertFileDigest(
    imagePath,
    snapshot.expected.image.digest,
    contract.id,
    "expected.image",
    snapshotPath,
  );

  let stylePath: string | undefined;
  if (snapshot.expected.style) {
    stylePath = path.resolve(root, snapshot.expected.style.path);
    assertFileDigest(
      stylePath,
      snapshot.expected.style.digest,
      contract.id,
      "expected.style",
      snapshotPath,
    );
  }

  return stylePath === undefined ? { snapshot, imagePath } : { snapshot, imagePath, stylePath };
}

function assertFileDigest(
  filePath: string,
  expectedDigest: string,
  contractId: string,
  field: string,
  snapshotPath: string,
): void {
  if (!fs.existsSync(filePath)) {
    throw new AppError(
      "PINNED_BASELINE_MISSING",
      `Pinned baseline ${field} for contract "${contractId}" not found at ${filePath} (referenced from ${snapshotPath}).`,
    );
  }
  const actualDigest = fileHash(filePath);
  if (actualDigest !== expectedDigest) {
    throw new AppError(
      "PINNED_BASELINE_DIGEST_MISMATCH",
      `Pinned baseline ${field} for contract "${contractId}" at ${filePath} does not match its recorded digest: expected ${expectedDigest}, recomputed ${actualDigest}.`,
    );
  }
}
