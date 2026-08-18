import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { BaselineSource } from "@framelia/contracts";
import { afterAll, describe, expect, it } from "vitest";

import { checkDoneGate, SCHEMA_VERSION } from "../src/index.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fidelity-donegate-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const target = { kind: "web" as const, url: "http://localhost:3000/login" };
const figmaBaseline = { kind: "figma" as const, fileKey: "file-key", nodeId: "153:5181" };
const baseContract = {
  viewport: "desktop",
  outDir: "",
  baseline: figmaBaseline as BaselineSource,
  target,
  profile: "component/strict" as const,
  selector: '[data-testid="auth.login"]',
  expectSize: { width: 544, height: 464 },
};

let n = 0;
function scoreDir(
  baseline: BaselineSource = figmaBaseline,
  overrides: Record<string, unknown> = {},
): string {
  const dir = path.join(tmp, `vp-${n++}`);
  fs.mkdirSync(dir, { recursive: true });
  const timestamp = new Date().toISOString();
  const names = { image: "figma-baseline.png", meta: "figma-baseline.meta.json" };
  const baselinePath = path.join(dir, names.image);
  const metaPath = path.join(dir, names.meta);
  for (const name of [names.image, "actual.png", "diff.png"])
    fs.writeFileSync(path.join(dir, name), "fixture");
  const baselineEvidence = {
    kind: "figma",
    path: baselinePath,
    metaPath,
    fileKey: baseline.fileKey,
    nodeId: baseline.nodeId,
    fetchedAt: timestamp,
    lastModified: null,
  };
  const baselineMeta = { fileKey: baseline.fileKey, nodeId: baseline.nodeId, fetchedAt: timestamp };
  fs.writeFileSync(metaPath, JSON.stringify(baselineMeta));
  fs.writeFileSync(
    path.join(dir, "run-meta.json"),
    JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      target,
      baseline: baselineEvidence,
      viewport: "desktop",
      viewportSize: { width: 1440, height: 1024 },
      profile: "component/strict",
      pageReason: null,
      runType: "final",
    }),
  );
  fs.writeFileSync(
    path.join(dir, "punch-list.json"),
    JSON.stringify({ schemaVersion: SCHEMA_VERSION, pass: true, items: [] }),
  );
  const score = {
    schemaVersion: SCHEMA_VERSION,
    pass: true,
    runType: "final",
    capturedAt: timestamp,
    target,
    baseline: baselineEvidence,
    viewport: "desktop",
    profile: "component/strict",
    pageReason: null,
    selector: baseContract.selector,
    expectSize: baseContract.expectSize,
    stability: "stable",
    outDir: dir,
    evidenceHashes: {
      baseline: fileHash(baselinePath),
      baselineMeta: fileHash(metaPath),
      actual: fileHash(path.join(dir, "actual.png")),
      diff: fileHash(path.join(dir, "diff.png")),
    },
    ...overrides,
  };
  fs.writeFileSync(path.join(dir, "visual-score.json"), JSON.stringify(score));
  return dir;
}

function fileHash(filePath: string): string {
  return `sha256:${crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")}`;
}

function gate(
  outDir: string,
  baseline: BaselineSource = figmaBaseline,
  overrides: Record<string, unknown> = {},
) {
  return checkDoneGate({ viewports: [{ ...baseContract, baseline, outDir, ...overrides }] });
}

describe("done gate schema v4", () => {
  it("accepts fresh Figma baseline evidence", () => {
    expect(gate(scoreDir()).done).toBe(true);
  });

  it("rejects missing, stale, future, dev, failing, and unstable evidence", () => {
    const empty = path.join(tmp, `vp-${n++}`);
    fs.mkdirSync(empty, { recursive: true });
    expect(gate(empty).done).toBe(false);
    const old = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const future = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    for (const testCase of [
      { overrides: { schemaVersion: 3 }, reason: /schemaVersion must be 4/ },
      { overrides: { runType: "dev" }, reason: /runType must be "final"/ },
      { overrides: { pass: false }, reason: /pass is not true/ },
      { overrides: { capturedAt: old }, reason: /capturedAt older than/ },
      { overrides: { capturedAt: future }, reason: /capturedAt is in future/ },
      { overrides: { stability: "borderline" }, reason: /stability must be "stable"/ },
    ]) {
      const result = gate(scoreDir(figmaBaseline, testCase.overrides));
      expect(result.done).toBe(false);
      expect(result.viewports[0]?.reasons.some((reason) => testCase.reason.test(reason))).toBe(
        true,
      );
    }
  });

  it("rejects contract and baseline identity mismatches", () => {
    expect(gate(scoreDir(), figmaBaseline, { profile: "component/dev" }).done).toBe(false);
    expect(gate(scoreDir(), figmaBaseline, { selector: "[data-testid=other]" }).done).toBe(false);
    expect(gate(scoreDir(), { ...figmaBaseline, nodeId: "153:2364" }).done).toBe(false);
  });

  it("rejects copied, incomplete, tampered, and residual-blocked artifacts", () => {
    expect(gate(scoreDir(figmaBaseline, { outDir: path.join(tmp, "other") })).done).toBe(false);
    const incomplete = scoreDir();
    fs.unlinkSync(path.join(incomplete, "diff.png"));
    expect(gate(incomplete).done).toBe(false);
    const tampered = scoreDir();
    fs.writeFileSync(path.join(tampered, "actual.png"), "tampered");
    expect(gate(tampered).done).toBe(false);
    expect(
      gate(
        scoreDir(figmaBaseline, {
          topIssues: [{ kind: "residual", severity: "medium", message: "cluster" }],
        }),
      ).done,
    ).toBe(false);
  });

  it("resolves relative outDir against cwd", () => {
    const dir = scoreDir();
    const relative = path.relative(tmp, dir);
    const scorePath = path.join(dir, "visual-score.json");
    const score = JSON.parse(fs.readFileSync(scorePath, "utf8"));
    score.outDir = relative;
    fs.writeFileSync(scorePath, JSON.stringify(score));
    expect(
      checkDoneGate({ cwd: tmp, viewports: [{ ...baseContract, outDir: relative }] }).done,
    ).toBe(true);
  });
});

const masks = [
  { selector: ".ad-banner", reason: "external ad", maxMatches: 1 },
] satisfies import("@framelia/contracts").VisualMask[];

const maskEvidence = {
  requested: [{ selector: ".ad-banner", reason: "external ad", maxMatches: 1, matchedCount: 1 }],
  matchedCount: 1,
  bounds: [{ x: 0, y: 0, width: 320, height: 40 }],
  unionMaskedArea: 12_800,
  maskedAreaRatio: 12_800 / (320 * 240),
  maskColor: "#FF00FF",
  status: "applied",
  resolvedAt: "2024-01-01T00:00:00.000Z",
};

function maskScoreDir(
  overrides: Record<string, unknown> = {},
  runMetaOverrides: Record<string, unknown> = {},
) {
  const dir = scoreDir(figmaBaseline, overrides);
  const runMetaPath = path.join(dir, "run-meta.json");
  const runMeta = JSON.parse(fs.readFileSync(runMetaPath, "utf8")) as Record<string, unknown>;
  fs.writeFileSync(
    runMetaPath,
    JSON.stringify({
      ...runMeta,
      masks,
      maxMaskedAreaRatio: 0.15,
      captureEvidence: { maskEvidence: maskEvidence },
      ...runMetaOverrides,
    }),
  );
  const scorePath = path.join(dir, "visual-score.json");
  const score = JSON.parse(fs.readFileSync(scorePath, "utf8")) as Record<string, unknown>;
  fs.writeFileSync(
    scorePath,
    JSON.stringify({
      ...score,
      captureEvidence: { maskEvidence: maskEvidence },
    }),
  );
  return dir;
}

describe("done gate mask evidence", () => {
  const maskContract = { masks, maxMaskedAreaRatio: 0.15 };

  it("accepts complete mask evidence for figma baselines", () => {
    const result = gate(maskScoreDir(), figmaBaseline, maskContract);
    expect(result.done).toBe(true);
    expect(result.viewports[0]?.reasons).toEqual([]);
  });

  it("rejects a masked pass without complete mask evidence", () => {
    const dir = scoreDir(figmaBaseline);
    const runMetaPath = path.join(dir, "run-meta.json");
    const runMeta = JSON.parse(fs.readFileSync(runMetaPath, "utf8")) as Record<string, unknown>;
    fs.writeFileSync(
      runMetaPath,
      JSON.stringify({
        ...runMeta,
        masks,
        maxMaskedAreaRatio: 0.15,
        captureEvidence: {},
      }),
    );
    const result = gate(dir, figmaBaseline, maskContract);
    expect(result.done).toBe(false);
    expect(result.viewports[0]?.reasons.join("\n")).toMatch(/complete mask evidence required/);
  });

  it("rejects a status that is not applied", () => {
    const dir = maskScoreDir(
      {},
      {
        captureEvidence: { maskEvidence: { ...maskEvidence, status: "failed" } },
      },
    );
    const result = gate(dir, figmaBaseline, maskContract);
    expect(result.done).toBe(false);
    expect(result.viewports[0]?.reasons.join("\n")).toMatch(/complete mask evidence/);
  });

  it("rejects a maxMaskedAreaRatio that does not match the contract", () => {
    const dir = maskScoreDir();
    const runMetaPath = path.join(dir, "run-meta.json");
    const runMeta = JSON.parse(fs.readFileSync(runMetaPath, "utf8")) as Record<string, unknown>;
    fs.writeFileSync(runMetaPath, JSON.stringify({ ...runMeta, maxMaskedAreaRatio: 0.05 }));
    const result = gate(dir, figmaBaseline, maskContract);
    expect(result.done).toBe(false);
    expect(result.viewports[0]?.reasons.join("\n")).toMatch(/maxMaskedAreaRatio/);
  });

  it("rejects mismatched mask declarations in run-meta", () => {
    const dir = maskScoreDir({}, { masks: [{ selector: ".other", reason: "x", maxMatches: 1 }] });
    const result = gate(dir, figmaBaseline, maskContract);
    expect(result.done).toBe(false);
    expect(result.viewports[0]?.reasons.join("\n")).toMatch(/masks do not match contract/);
  });
});
