import * as fs from "node:fs";
import type * as NodeFs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { authoredContractSchema, baselineSnapshotSchema } from "@framelia/contracts/workflow";
import { PNG } from "pngjs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { canonicalJsonDigest } from "../src/canonical-json.ts";
import { sha256Hex } from "../src/hash.ts";
import { readPinnedBaseline } from "../src/pinned-baseline.ts";
import { makeSolidPng } from "../src/testing.ts";
import { AppError } from "../src/types.ts";

// `import * as fs from "node:fs"` yields a non-configurable ESM namespace object --
// `vi.spyOn` can never redefine a property on it. `vi.mock` with `importOriginal`
// swaps the whole module binding instead, which every importer (including
// pinned-baseline.ts's own `import * as fs`) resolves through, letting a `vi.fn`
// wrapper around the real `readFileSync` count calls without changing behavior.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFs>();
  return { ...actual, readFileSync: vi.fn<typeof actual.readFileSync>(actual.readFileSync) };
});

const temporaryDirectories: string[] = [];

function temporaryRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-pinned-baseline-"));
  temporaryDirectories.push(root);
  return root;
}

function authoredContract(overrides: Record<string, unknown> = {}) {
  return authoredContractSchema.parse({
    formatVersion: 1,
    kind: "framelia.contract",
    id: "login.desktop",
    name: "Login · Desktop",
    revision: 1,
    target: { path: "/login" },
    viewport: { preset: "desktop", width: 2, height: 2 },
    scope: { kind: "page", pageReason: "full page review" },
    baseline: { snapshotDigest: `sha256:${"0".repeat(64)}` },
    ...overrides,
  });
}

/** Writes a valid pinned snapshot + backing image under `root`, wiring the contract's
 *  own `baseline.snapshotDigest` to the snapshot record's real recomputed digest so the
 *  pair is self-consistent -- mirrors what `framelia contract refresh-baseline` (WP7,
 *  out of scope) would produce on disk. */
function writePinnedSnapshot(root: string) {
  const imageBytes = PNG.sync.write(makeSolidPng(2, 2, [10, 20, 30, 255]));
  const imageDigest = `sha256:${sha256Hex(imageBytes)}` as const;

  const snapshot = baselineSnapshotSchema.parse({
    formatVersion: 1,
    kind: "framelia.baseline-snapshot",
    source: { kind: "figma", fileKey: "file-key", nodeId: "1:2" },
    rendering: { viewport: { preset: "desktop", width: 2, height: 2 }, deviceScaleFactor: 1 },
    expected: {
      kind: "page",
      image: { path: "image.png", digest: imageDigest, width: 2, height: 2 },
    },
  });
  const snapshotDigest = canonicalJsonDigest(snapshot);
  const digestHex = snapshotDigest.slice(7);

  const snapshotDir = path.join(root, ".framelia", "baselines", digestHex);
  fs.mkdirSync(snapshotDir, { recursive: true });
  const snapshotPath = path.join(snapshotDir, "snapshot.json");
  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot));
  const imagePath = path.join(root, "image.png");
  fs.writeFileSync(imagePath, imageBytes);

  const contract = authoredContract({ baseline: { snapshotDigest } });
  return { contract, imagePath, snapshotDir, snapshotPath };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("readPinnedBaseline", () => {
  it("resolves the validated snapshot and image path for a self-consistent pinned baseline", async () => {
    const root = temporaryRoot();
    const { contract, imagePath } = writePinnedSnapshot(root);

    const result = await readPinnedBaseline(root, contract);

    expect(result.imagePath).toBe(imagePath);
    expect(result.stylePath).toBeUndefined();
    expect(result.snapshot.expected.kind).toBe("page");
  });

  it("returns the exact image bytes it verified against the recorded digest, not a fresh read", async () => {
    const root = temporaryRoot();
    const { contract, imagePath } = writePinnedSnapshot(root);
    const onDiskBytes = fs.readFileSync(imagePath);

    const readFileSyncMock = vi.mocked(fs.readFileSync);
    readFileSyncMock.mockClear();
    const result = await readPinnedBaseline(root, contract);
    const imageReads = readFileSyncMock.mock.calls.filter((call) => call[0] === imagePath);

    // Exactly one read of the shared image file's bytes, ever, inside readPinnedBaseline.
    expect(imageReads).toHaveLength(1);
    expect(result.imageBytes.equals(onDiskBytes)).toBe(true);
    expect(`sha256:${sha256Hex(result.imageBytes)}`).toBe(result.snapshot.expected.image.digest);
  });

  it("exposes bytes unaffected by mutating the shared file immediately after resolution -- proving there is no lazy second read", async () => {
    const root = temporaryRoot();
    const { contract, imagePath } = writePinnedSnapshot(root);

    const result = await readPinnedBaseline(root, contract);
    const verifiedBytes = Buffer.from(result.imageBytes);

    // Race the mutation as tightly against the read as real Node allows: the very next
    // statement after readPinnedBaseline resolves swaps the shared file's bytes.
    fs.writeFileSync(imagePath, PNG.sync.write(makeSolidPng(2, 2, [200, 0, 0, 255])));

    // A caller holding onto result.imageBytes (e.g. to fs.writeFileSync it into a
    // private path) sees the bytes verified before the mutation, never the swapped
    // ones -- there is no code path left that re-reads imagePath to produce them.
    expect(result.imageBytes.equals(verifiedBytes)).toBe(true);
    expect(result.imageBytes.equals(fs.readFileSync(imagePath))).toBe(false);
  });

  it("never calls fetch -- pinned checks are structurally incapable of a network call", async () => {
    const root = temporaryRoot();
    const { contract } = writePinnedSnapshot(root);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error("readPinnedBaseline must never call fetch");
    }) as typeof fetch;

    try {
      await expect(readPinnedBaseline(root, contract)).resolves.toBeDefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects when no snapshot directory exists for the contract's digest", async () => {
    const root = temporaryRoot();
    const contract = authoredContract();

    await expect(readPinnedBaseline(root, contract)).rejects.toMatchObject({
      code: "PINNED_BASELINE_MISSING",
    });
  });

  it("rejects malformed snapshot JSON", async () => {
    const root = temporaryRoot();
    const contract = authoredContract();
    const digestHex = contract.baseline.snapshotDigest.slice(7);
    const snapshotDir = path.join(root, ".framelia", "baselines", digestHex);
    fs.mkdirSync(snapshotDir, { recursive: true });
    fs.writeFileSync(path.join(snapshotDir, "snapshot.json"), "{not json");

    await expect(readPinnedBaseline(root, contract)).rejects.toMatchObject({
      code: "PINNED_BASELINE_INVALID",
    });
  });

  it("rejects a snapshot record that fails schema validation", async () => {
    const root = temporaryRoot();
    const contract = authoredContract();
    const digestHex = contract.baseline.snapshotDigest.slice(7);
    const snapshotDir = path.join(root, ".framelia", "baselines", digestHex);
    fs.mkdirSync(snapshotDir, { recursive: true });
    fs.writeFileSync(
      path.join(snapshotDir, "snapshot.json"),
      JSON.stringify({ not: "a snapshot" }),
    );

    await expect(readPinnedBaseline(root, contract)).rejects.toMatchObject({
      code: "PINNED_BASELINE_INVALID",
    });
  });

  it("rejects when the snapshot record on disk has been hand-edited after being pinned (digest no longer matches)", async () => {
    const root = temporaryRoot();
    const { contract, snapshotPath } = writePinnedSnapshot(root);
    const tampered = JSON.parse(fs.readFileSync(snapshotPath, "utf8")) as Record<string, unknown>;
    (tampered.source as Record<string, unknown>).nodeId = "9:9";
    fs.writeFileSync(snapshotPath, JSON.stringify(tampered));

    await expect(readPinnedBaseline(root, contract)).rejects.toThrow(AppError);
    await expect(readPinnedBaseline(root, contract)).rejects.toMatchObject({
      code: "PINNED_BASELINE_DIGEST_MISMATCH",
    });
  });

  it("rejects when the snapshot's expected.kind disagrees with the contract's own scope.kind", async () => {
    const root = temporaryRoot();
    const { contract } = writePinnedSnapshot(root);
    const regionContract = authoredContract({
      baseline: contract.baseline,
      scope: { kind: "region", selector: "#card" },
    });

    await expect(readPinnedBaseline(root, regionContract)).rejects.toMatchObject({
      code: "PINNED_BASELINE_INVALID",
    });
  });

  it("rejects when the referenced image file is missing", async () => {
    const root = temporaryRoot();
    const { contract, imagePath } = writePinnedSnapshot(root);
    fs.rmSync(imagePath);

    await expect(readPinnedBaseline(root, contract)).rejects.toMatchObject({
      code: "PINNED_BASELINE_MISSING",
    });
  });

  it("rejects when the image bytes on disk have been tampered with (digest no longer matches)", async () => {
    const root = temporaryRoot();
    const { contract, imagePath } = writePinnedSnapshot(root);
    fs.writeFileSync(imagePath, PNG.sync.write(makeSolidPng(2, 2, [200, 0, 0, 255])));

    await expect(readPinnedBaseline(root, contract)).rejects.toMatchObject({
      code: "PINNED_BASELINE_DIGEST_MISMATCH",
    });
  });

  it("validates and resolves an optional style snapshot file alongside the image", async () => {
    const root = temporaryRoot();
    const imageBytes = PNG.sync.write(makeSolidPng(2, 2, [1, 2, 3, 255]));
    const imageDigest = `sha256:${sha256Hex(imageBytes)}` as const;
    const styleBytes = Buffer.from(JSON.stringify({ color: "#010203ff" }));
    const styleDigest = `sha256:${sha256Hex(styleBytes)}` as const;

    const snapshot = baselineSnapshotSchema.parse({
      formatVersion: 1,
      kind: "framelia.baseline-snapshot",
      source: { kind: "figma", fileKey: "file-key", nodeId: "1:2" },
      rendering: { viewport: { preset: "desktop", width: 2, height: 2 }, deviceScaleFactor: 1 },
      expected: {
        kind: "region",
        image: { path: "image.png", digest: imageDigest, width: 2, height: 2 },
        style: { path: "style.json", digest: styleDigest },
      },
    });
    const snapshotDigest = canonicalJsonDigest(snapshot);
    const snapshotDir = path.join(root, ".framelia", "baselines", snapshotDigest.slice(7));
    fs.mkdirSync(snapshotDir, { recursive: true });
    fs.writeFileSync(path.join(snapshotDir, "snapshot.json"), JSON.stringify(snapshot));
    fs.writeFileSync(path.join(root, "image.png"), imageBytes);
    fs.writeFileSync(path.join(root, "style.json"), styleBytes);

    const contract = authoredContract({
      scope: { kind: "region", selector: "#card" },
      baseline: { snapshotDigest },
    });

    const result = await readPinnedBaseline(root, contract);
    expect(result.stylePath).toBe(path.join(root, "style.json"));
    expect(result.styleBytes?.equals(styleBytes)).toBe(true);
    expect(result.imageBytes.equals(imageBytes)).toBe(true);
  });

  it("rejects when the style file's bytes disagree with its recorded digest", async () => {
    const root = temporaryRoot();
    const imageBytes = PNG.sync.write(makeSolidPng(2, 2, [1, 2, 3, 255]));
    const imageDigest = `sha256:${sha256Hex(imageBytes)}` as const;
    const styleDigest = `sha256:${sha256Hex(Buffer.from("{}"))}` as const;

    const snapshot = baselineSnapshotSchema.parse({
      formatVersion: 1,
      kind: "framelia.baseline-snapshot",
      source: { kind: "figma", fileKey: "file-key", nodeId: "1:2" },
      rendering: { viewport: { preset: "desktop", width: 2, height: 2 }, deviceScaleFactor: 1 },
      expected: {
        kind: "region",
        image: { path: "image.png", digest: imageDigest, width: 2, height: 2 },
        style: { path: "style.json", digest: styleDigest },
      },
    });
    const snapshotDigest = canonicalJsonDigest(snapshot);
    const snapshotDir = path.join(root, ".framelia", "baselines", snapshotDigest.slice(7));
    fs.mkdirSync(snapshotDir, { recursive: true });
    fs.writeFileSync(path.join(snapshotDir, "snapshot.json"), JSON.stringify(snapshot));
    fs.writeFileSync(path.join(root, "image.png"), imageBytes);
    fs.writeFileSync(path.join(root, "style.json"), Buffer.from('{"tampered":true}'));

    const contract = authoredContract({
      scope: { kind: "region", selector: "#card" },
      baseline: { snapshotDigest },
    });

    await expect(readPinnedBaseline(root, contract)).rejects.toMatchObject({
      code: "PINNED_BASELINE_DIGEST_MISMATCH",
    });
  });
});
