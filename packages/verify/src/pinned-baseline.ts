import * as fs from "node:fs";
import * as path from "node:path";

import type { AuthoredContract, BaselineSnapshot } from "@framelia/contracts/workflow";
import { baselineSnapshotSchema } from "@framelia/contracts/workflow";
import * as z from "zod";

import { canonicalJsonDigest, type CanonicalJsonValue } from "./canonical-json.ts";
import { sha256Hex } from "./hash.ts";
import { AppError } from "./types.ts";

const BASELINES_DIR_SEGMENTS = [".framelia", "baselines"];
const SNAPSHOT_FILE_NAME = "snapshot.json";
const SHA256_PREFIX = "sha256:";

/**
 * A pinned baseline snapshot resolved from disk, with its own image (and, when present,
 * style) bytes validated against the digests recorded inside the snapshot record itself.
 * `imagePath`/`stylePath` are absolute filesystem paths, ready to hand to compare() or a
 * JSON.parse call -- every byte behind them has already been hashed and checked against
 * the immutable record, so a caller never re-validates them. `imageBytes`/`styleBytes`
 * are the *exact* `Buffer`s `readPinnedBaseline` read from those same paths to compute
 * that verification -- each shared file's bytes are read from disk exactly once, ever,
 * inside this function. A caller that needs the verified bytes (e.g. to copy them into a
 * private, race-free location) MUST use `imageBytes`/`styleBytes` rather than re-reading
 * `imagePath`/`stylePath`: re-reading reopens a TOCTOU window between this function's
 * verification and the caller's own read, on a path that remains writable by anything
 * else on the machine for as long as the process runs.
 */
export interface PinnedBaseline {
  snapshot: BaselineSnapshot;
  /** Absolute path to the validated expected image bytes. */
  imagePath: string;
  /** The exact bytes read from `imagePath` and verified against `snapshot.expected.image.digest` -- see this interface's own doc comment for why a caller should prefer this over re-reading `imagePath`. */
  imageBytes: Buffer;
  /** Absolute path to the validated expected style JSON, if the snapshot records one. */
  stylePath?: string;
  /** The exact bytes read from `stylePath` and verified against `snapshot.expected.style.digest`, mirroring `imageBytes`. Present iff `stylePath` is. */
  styleBytes?: Buffer;
}

function resolveSnapshotFile(
  root: string,
  snapshotDirectory: string,
  relativePath: string,
): string {
  const colocated = path.resolve(snapshotDirectory, relativePath);
  if (fs.existsSync(colocated)) return colocated;
  return path.resolve(root, relativePath);
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

  const imagePath = resolveSnapshotFile(root, snapshotDir, snapshot.expected.image.path);
  const imageBytes = readAndVerifyFileDigest(
    imagePath,
    snapshot.expected.image.digest,
    contract.id,
    "expected.image",
    snapshotPath,
  );

  let stylePath: string | undefined;
  let styleBytes: Buffer | undefined;
  if (snapshot.expected.style) {
    stylePath = resolveSnapshotFile(root, snapshotDir, snapshot.expected.style.path);
    styleBytes = readAndVerifyFileDigest(
      stylePath,
      snapshot.expected.style.digest,
      contract.id,
      "expected.style",
      snapshotPath,
    );
  }

  return stylePath === undefined
    ? { snapshot, imagePath, imageBytes }
    : { snapshot, imagePath, imageBytes, stylePath, styleBytes };
}

/**
 * Reads `filePath`'s bytes into memory exactly once and verifies their digest against
 * `expectedDigest`, returning the same buffer that was hashed -- never re-reading the
 * file to hand a caller its bytes. This is the single point where a shared baseline
 * file's bytes cross from disk into the process for the whole `readPinnedBaseline` call
 * chain; see `PinnedBaseline`'s own doc comment for why callers must reuse the returned
 * buffer instead of re-reading the path themselves.
 */
function readAndVerifyFileDigest(
  filePath: string,
  expectedDigest: string,
  contractId: string,
  field: string,
  snapshotPath: string,
): Buffer {
  if (!fs.existsSync(filePath)) {
    throw new AppError(
      "PINNED_BASELINE_MISSING",
      `Pinned baseline ${field} for contract "${contractId}" not found at ${filePath} (referenced from ${snapshotPath}).`,
    );
  }
  const bytes = fs.readFileSync(filePath);
  const actualDigest = `${SHA256_PREFIX}${sha256Hex(bytes)}`;
  if (actualDigest !== expectedDigest) {
    throw new AppError(
      "PINNED_BASELINE_DIGEST_MISMATCH",
      `Pinned baseline ${field} for contract "${contractId}" at ${filePath} does not match its recorded digest: expected ${expectedDigest}, recomputed ${actualDigest}.`,
    );
  }
  return bytes;
}
