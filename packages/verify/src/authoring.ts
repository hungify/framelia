import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { ContractScope, FigmaBaselineSource } from "@framelia/contracts";
import {
  SNAPSHOT_FORMAT_VERSION,
  baselineSnapshotSchema,
  type AuthoredContract,
  type BaselineSnapshot,
} from "@framelia/contracts/workflow";
import { nanoid } from "nanoid";

import {
  fetchBaseline,
  type FetchBaselineOptions,
  type FetchBaselineOutcome,
} from "./baseline/figma-fetch.ts";
import { canonicalJson, canonicalJsonDigest, type CanonicalJsonValue } from "./canonical-json.ts";
import { parsePng } from "./compare/png.ts";
import { fsyncDirectory, writeFileAtomic } from "./fs-atomic.ts";
import { sha256Hex } from "./hash.ts";
import { readPinnedBaseline } from "./pinned-baseline.ts";
import { publishBundleUnit, type StagedFile } from "./run-bundle/staged-write.ts";
import { AppError } from "./types.ts";

const BASELINE_IMAGE_FILE = "expected.png";
const BASELINE_STYLE_FILE = "expected-style.json";
const SNAPSHOT_FILE = "snapshot.json";

export type FetchBaselineFn = (options: FetchBaselineOptions) => Promise<FetchBaselineOutcome>;

export interface StageFigmaBaselineOptions {
  source: FigmaBaselineSource;
  viewport: { preset: string; width: number; height: number };
  scope: ContractScope;
  token?: string;
  fetchBaseline?: FetchBaselineFn;
}

export interface StagedBaselineSnapshot {
  snapshot: BaselineSnapshot;
  snapshotDigest: `sha256:${string}`;
  imageBytes: Buffer;
  styleBytes?: Buffer;
  files: readonly StagedFile[];
}

/**
 * Acquires a complete Figma snapshot in a private temporary directory. Nothing below
 * the consumer project is touched until the returned bytes have passed PNG and schema
 * validation. The final image is read exactly once after fetchBaseline has completed
 * optional compositing, and those same bytes are hashed and later published.
 */
export async function stageFigmaBaseline(
  options: StageFigmaBaselineOptions,
): Promise<StagedBaselineSnapshot> {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-authoring-"));
  try {
    const imagePath = path.join(temporaryDirectory, BASELINE_IMAGE_FILE);
    const acquired = await (options.fetchBaseline ?? fetchBaseline)({
      fileKey: options.source.fileKey,
      nodeId: options.source.nodeId,
      outPath: imagePath,
      ...(options.source.scale === undefined ? {} : { scale: options.source.scale }),
      ...(options.source.canvasFill === undefined ? {} : { canvasFill: options.source.canvasFill }),
      ...(options.token === undefined ? {} : { token: options.token }),
    });
    if (!acquired.fetched) {
      throw new AppError(
        "BASELINE_ACQUISITION_FAILED",
        `Figma baseline acquisition failed: ${acquired.message}`,
      );
    }

    const imageBytes = fs.readFileSync(acquired.baselinePath);
    const image = parsePng(imageBytes);
    const imageDigest = `sha256:${sha256Hex(imageBytes)}` as const;
    const deviceScaleFactor = options.source.scale ?? 1;

    let styleBytes: Buffer | undefined;
    if (Object.keys(acquired.figmaStyle).length > 0) {
      styleBytes = Buffer.from(`${canonicalJson(acquired.figmaStyle as CanonicalJsonValue)}\n`);
    }
    const styleReference = styleBytes
      ? {
          path: BASELINE_STYLE_FILE,
          digest: `sha256:${sha256Hex(styleBytes)}` as const,
        }
      : undefined;
    const imageReference = {
      path: BASELINE_IMAGE_FILE,
      digest: imageDigest,
      width: image.width,
      height: image.height,
    };
    const expected =
      options.scope.kind === "page"
        ? {
            kind: "page" as const,
            image: imageReference,
            ...(styleReference ? { style: styleReference } : {}),
            ...(options.scope.styleChecks ? { styleChecks: options.scope.styleChecks } : {}),
          }
        : {
            kind: "region" as const,
            image: imageReference,
            ...(styleReference ? { style: styleReference } : {}),
            ...(options.scope.expectStyle ? { expectStyle: options.scope.expectStyle } : {}),
          };
    const snapshot = baselineSnapshotSchema.parse({
      formatVersion: SNAPSHOT_FORMAT_VERSION,
      kind: "framelia.baseline-snapshot",
      source: options.source,
      metadata: acquired.meta,
      rendering: { viewport: options.viewport, deviceScaleFactor },
      expected,
    });
    const snapshotDigest = canonicalJsonDigest(snapshot as CanonicalJsonValue);
    const files: StagedFile[] = [
      {
        relativePath: SNAPSHOT_FILE,
        content: `${canonicalJson(snapshot as CanonicalJsonValue)}\n`,
      },
      { relativePath: BASELINE_IMAGE_FILE, content: imageBytes },
    ];
    if (styleBytes) files.push({ relativePath: BASELINE_STYLE_FILE, content: styleBytes });
    return {
      snapshot,
      snapshotDigest,
      imageBytes,
      ...(styleBytes ? { styleBytes } : {}),
      files,
    };
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

export interface RawFileState {
  exists: boolean;
  digest?: `sha256:${string}`;
  bytes?: Buffer;
}

export function readRawFileState(filePath: string): RawFileState {
  if (!fs.existsSync(filePath)) return { exists: false };
  const bytes = fs.readFileSync(filePath);
  return { exists: true, digest: `sha256:${sha256Hex(bytes)}`, bytes };
}

export function assertRawFileState(filePath: string, expected: RawFileState): void {
  const actual = readRawFileState(filePath);
  if (actual.exists !== expected.exists || actual.digest !== expected.digest) {
    throw new AppError(
      "AUTHORING_CONFLICT",
      `${filePath} changed while baseline acquisition was in progress. No contract pointer was replaced; retry from the updated file.`,
    );
  }
}

interface AuthoringLockOwner {
  formatVersion: 1;
  pid: number;
  token: string;
  createdAt: string;
}

export interface AuthoringLockDependencies {
  /** Test seam for synchronizing reclaimers after they observe the same stale owner. */
  beforeReclaim?: (lockPath: string) => Promise<void> | void;
  isProcessAlive?: (pid: number) => boolean;
}

interface AcquiredAuthoringLock {
  descriptor: number;
  lockPath: string;
  owner: AuthoringLockOwner;
}

const AUTHORING_LOCK_ATTEMPTS = 32;
const AUTHORING_LOCK_RETRY_MS = 10;

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    if (code === "EPERM") return true;
    throw error;
  }
}

function readLockOwner(lockPath: string): AuthoringLockOwner | undefined {
  let value: unknown;
  try {
    value = JSON.parse(fs.readFileSync(lockPath, "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new AppError(
      "AUTHORING_LOCKED",
      `Cannot safely reclaim malformed authoring lock ${lockPath}. Remove it manually only after verifying no authoring process is active.`,
    );
  }
  if (
    !value ||
    typeof value !== "object" ||
    (value as Partial<AuthoringLockOwner>).formatVersion !== 1 ||
    !Number.isSafeInteger((value as Partial<AuthoringLockOwner>).pid) ||
    (value as Partial<AuthoringLockOwner>).pid! <= 0 ||
    typeof (value as Partial<AuthoringLockOwner>).token !== "string" ||
    !(value as Partial<AuthoringLockOwner>).token ||
    typeof (value as Partial<AuthoringLockOwner>).createdAt !== "string" ||
    !Number.isFinite(Date.parse((value as Partial<AuthoringLockOwner>).createdAt!))
  ) {
    throw new AppError(
      "AUTHORING_LOCKED",
      `Cannot safely reclaim malformed authoring lock ${lockPath}. Remove it manually only after verifying no authoring process is active.`,
    );
  }
  return value as AuthoringLockOwner;
}

function removeOwnedLock(lock: AcquiredAuthoringLock): void {
  fs.closeSync(lock.descriptor);
  const current = readLockOwner(lock.lockPath);
  if (current?.token !== lock.owner.token) return;
  try {
    fs.unlinkSync(lock.lockPath);
    fsyncDirectory(path.dirname(lock.lockPath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function createLock(lockPath: string): AcquiredAuthoringLock | undefined {
  let descriptor: number;
  try {
    descriptor = fs.openSync(lockPath, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return undefined;
    throw error;
  }
  const owner: AuthoringLockOwner = {
    formatVersion: 1,
    pid: process.pid,
    token: nanoid(),
    createdAt: new Date().toISOString(),
  };
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(owner)}\n`);
    fs.fsyncSync(descriptor);
    fsyncDirectory(path.dirname(lockPath));
    return { descriptor, lockPath, owner };
  } catch (error) {
    fs.closeSync(descriptor);
    fs.rmSync(lockPath, { force: true });
    throw error;
  }
}

function authoringLockRetryDelay(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, AUTHORING_LOCK_RETRY_MS);
  return promise;
}

async function acquireAuthoringLock(
  lockPath: string,
  dependencies: AuthoringLockDependencies,
): Promise<AcquiredAuthoringLock> {
  const reclaimPath = `${lockPath}.reclaim`;
  const isProcessAlive = dependencies.isProcessAlive ?? processIsAlive;
  for (let attempt = 0; attempt < AUTHORING_LOCK_ATTEMPTS; attempt += 1) {
    if (fs.existsSync(reclaimPath)) {
      await authoringLockRetryDelay();
      continue;
    }

    const acquired = createLock(lockPath);
    if (acquired) {
      // A stale-lock reclaimer may have linked its claim between our initial check
      // and the exclusive create. Relinquish before running user work; the claimant
      // compares tokens and therefore cannot mistake this live replacement for stale.
      if (!fs.existsSync(reclaimPath)) return acquired;
      removeOwnedLock(acquired);
      await authoringLockRetryDelay();
      continue;
    }

    const observed = readLockOwner(lockPath);
    if (!observed) continue;
    if (isProcessAlive(observed.pid)) {
      throw new AppError(
        "AUTHORING_LOCKED",
        `Authoring lock ${lockPath} is owned by live PID ${observed.pid}. Retry after that create or refresh finishes.`,
      );
    }
    await dependencies.beforeReclaim?.(lockPath);

    // The fixed hard-link claim elects one reclaimer and gates new owners. A
    // contender that observed the same stale file either loses this link race or
    // links a later owner whose token will not match; neither may rename that owner.
    try {
      fs.linkSync(lockPath, reclaimPath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "EEXIST") {
        await authoringLockRetryDelay();
        continue;
      }
      throw error;
    }

    try {
      const claimed = readLockOwner(reclaimPath);
      if (!claimed || claimed.token !== observed.token) continue;
      const quarantinePath = `${lockPath}.stale.${process.pid}.${nanoid()}`;
      try {
        fs.renameSync(lockPath, quarantinePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      const quarantined = readLockOwner(quarantinePath);
      if (!quarantined || quarantined.token !== observed.token) {
        throw new AppError(
          "AUTHORING_LOCKED",
          `Refusing to delete unexpected authoring lock quarantined at ${quarantinePath}. Inspect it manually.`,
        );
      }
      fs.unlinkSync(quarantinePath);
    } finally {
      fs.rmSync(reclaimPath, { force: true });
      fsyncDirectory(path.dirname(lockPath));
    }
  }
  throw new AppError(
    "AUTHORING_LOCKED",
    `Could not acquire authoring lock ${lockPath} after ${AUTHORING_LOCK_ATTEMPTS} bounded attempts. Inspect the lock and reclaim marker manually.`,
  );
}

/** One project-wide lock serializes the global-ID check and the contract pointer CAS. */
export async function withAuthoringLock<T>(
  root: string,
  operation: () => Promise<T> | T,
  dependencies: AuthoringLockDependencies = {},
): Promise<T> {
  const absoluteRoot = path.resolve(root);
  const frameliaDirectory = path.join(absoluteRoot, ".framelia");
  const createdFrameliaDirectory = !fs.existsSync(frameliaDirectory);
  fs.mkdirSync(frameliaDirectory, { recursive: true });
  if (createdFrameliaDirectory) fsyncDirectory(absoluteRoot);
  const lock = await acquireAuthoringLock(
    path.join(frameliaDirectory, "authoring.lock"),
    dependencies,
  );
  try {
    return await operation();
  } finally {
    removeOwnedLock(lock);
  }
}

/** Publish the immutable snapshot before the mutable contract pointer. */
export async function publishBaselineSnapshot(
  root: string,
  contract: AuthoredContract,
  staged: StagedBaselineSnapshot,
): Promise<void> {
  const targetDirectory = path.join(
    root,
    ".framelia",
    "baselines",
    staged.snapshotDigest.slice("sha256:".length),
  );
  if (!fs.existsSync(targetDirectory)) {
    publishBundleUnit(targetDirectory, staged.files);
  }

  const pinned = await readPinnedBaseline(root, contract);
  if (
    !pinned.imageBytes.equals(staged.imageBytes) ||
    (pinned.styleBytes === undefined) !== (staged.styleBytes === undefined) ||
    (pinned.styleBytes !== undefined && !pinned.styleBytes.equals(staged.styleBytes!))
  ) {
    throw new AppError(
      "PINNED_BASELINE_DIGEST_MISMATCH",
      `Existing immutable snapshot ${staged.snapshotDigest} does not contain the acquired bytes.`,
    );
  }
}

export function writeAuthoredContract(filePath: string, contract: AuthoredContract): void {
  writeFileAtomic(filePath, `${JSON.stringify(contract, null, 2)}\n`);
}
