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

import {
  fetchBaseline,
  type FetchBaselineOptions,
  type FetchBaselineOutcome,
} from "./baseline/figma-fetch.ts";
import { canonicalJson, canonicalJsonDigest, type CanonicalJsonValue } from "./canonical-json.ts";
import { parsePng } from "./compare/png.ts";
import { writeFileAtomic } from "./fs-atomic.ts";
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

/** One project-wide lock serializes the global-ID check and the contract pointer CAS. */
export async function withAuthoringLock<T>(
  root: string,
  operation: () => Promise<T> | T,
): Promise<T> {
  const frameliaDirectory = path.join(root, ".framelia");
  const createdFrameliaDirectory = !fs.existsSync(frameliaDirectory);
  fs.mkdirSync(frameliaDirectory, { recursive: true });
  if (createdFrameliaDirectory) {
    const rootDescriptor = fs.openSync(root, "r");
    try {
      fs.fsyncSync(rootDescriptor);
    } finally {
      fs.closeSync(rootDescriptor);
    }
  }
  const lockPath = path.join(frameliaDirectory, "authoring.lock");
  let descriptor: number;
  try {
    descriptor = fs.openSync(lockPath, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    throw new AppError(
      "AUTHORING_LOCKED",
      `Authoring is already in progress for ${root}. Retry after the active create or refresh finishes.`,
    );
  }
  try {
    return await operation();
  } finally {
    fs.closeSync(descriptor);
    fs.rmSync(lockPath, { force: true });
    const directoryDescriptor = fs.openSync(frameliaDirectory, "r");
    try {
      fs.fsyncSync(directoryDescriptor);
    } finally {
      fs.closeSync(directoryDescriptor);
    }
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
