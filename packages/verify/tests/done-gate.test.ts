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
  // Defaults to `overrides` so every existing caller keeps mirroring the same
  // profileOverrides into both files (matching report-projection.ts's real behavior);
  // pass a distinct object to isolate the run-meta-only comparison in a test.
  runMetaOverrides: Record<string, unknown> = overrides,
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
      // Mirrors report-projection.ts, which persists the same profileOverrides/gateEligible
      // into both run-meta.json and visual-score.json from a single matcher-time value.
      ...("profileOverrides" in runMetaOverrides
        ? { profileOverrides: runMetaOverrides.profileOverrides }
        : {}),
      ...("gateEligible" in runMetaOverrides
        ? { gateEligible: runMetaOverrides.gateEligible }
        : {}),
      ...("styleGateEligible" in runMetaOverrides
        ? { styleGateEligible: runMetaOverrides.styleGateEligible }
        : {}),
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
      {
        overrides: { schemaVersion: SCHEMA_VERSION - 1 },
        reason: new RegExp(`schemaVersion must be ${SCHEMA_VERSION}`),
      },
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

  it("rejects evidence captured under different profileOverrides than the contract declares", () => {
    // Regression guard: contractToDoneGate previously dropped contract.profileOverrides
    // entirely, so evidence captured under any (or no) threshold overrides silently
    // satisfied a contract that declared its own -- replayed verification could pass
    // under looser thresholds than the original Playwright comparison actually used.
    const contractOverride = { profileOverrides: { minMatch: 0.999 } };
    expect(gate(scoreDir(), figmaBaseline, contractOverride).done).toBe(false);
    expect(gate(scoreDir(figmaBaseline, contractOverride), figmaBaseline, {}).done).toBe(false);
    expect(
      gate(scoreDir(figmaBaseline, contractOverride), figmaBaseline, contractOverride).done,
    ).toBe(true);
  });

  it("rejects run-meta profileOverrides that diverge from an otherwise-matching visual-score.json", () => {
    // Regression guard: scoreDir mirrors profileOverrides into both files by default, so
    // no prior test exercised the run-meta comparison in isolation -- a regression that
    // broke only the runMetaReasons check (independent of the score-level check) could
    // slip through unnoticed.
    const contractOverride = { profileOverrides: { minMatch: 0.999 } };
    const divergedRunMeta = { profileOverrides: { minMatch: 0.995 } };
    const dir = scoreDir(figmaBaseline, contractOverride, divergedRunMeta);
    const result = gate(dir, figmaBaseline, contractOverride);
    expect(result.done).toBe(false);
    const reasons = result.viewports[0]?.reasons ?? [];
    expect(reasons).toContain("run-meta profileOverrides do not match contract.");
    expect(reasons).not.toContain("profileOverrides do not match contract.");
  });

  it("rejects evidence with maxDiffPixels: null against a contract without that override", () => {
    // Regression guard: sameProfileOverrides used to normalize `null` ("cap disabled")
    // and `undefined` ("not overridden, profile's own finite cap applies") to the same
    // "no value" via `?? undefined`, so evidence captured with the cap disabled silently
    // satisfied a contract that never asked for that.
    const nullCapOverride = { profileOverrides: { maxDiffPixels: null } };
    expect(gate(scoreDir(figmaBaseline, nullCapOverride), figmaBaseline, {}).done).toBe(false);
    expect(
      gate(scoreDir(figmaBaseline, nullCapOverride), figmaBaseline, nullCapOverride).done,
    ).toBe(true);
  });

  it("rejects evidence whose gateEligible flag diverges from the contract's (Issue #10)", () => {
    // Evidence recorded as gate-eligible must match what the contract actually declares --
    // same drift-protection reasoning as profileOverrides above, now for gateEligible.
    // gateEligible: false always fails the gate on its own (that's the flag's whole job), so
    // the "matches" case below uses an explicit `true` -- still redundant with component/strict's
    // own default, but proves the drift check itself doesn't spuriously reject on agreement.
    const notEligible = { gateEligible: false };
    expect(gate(scoreDir(figmaBaseline, notEligible), figmaBaseline, {}).done).toBe(false);
    expect(gate(scoreDir(), figmaBaseline, notEligible).done).toBe(false);
    const eligible = { gateEligible: true };
    expect(gate(scoreDir(figmaBaseline, eligible), figmaBaseline, eligible).done).toBe(true);
  });

  it("leaves style mismatches informational-only when styleGateEligible is unset (issue #39 default)", () => {
    // Default behavior (flag unset) must stay unchanged -- a style-color mismatch never
    // blocked the gate before this feature, and must not start blocking implicitly.
    expect(
      gate(
        scoreDir(figmaBaseline, {
          topIssues: [{ kind: "style-color", severity: "low", message: "color mismatch" }],
        }),
      ).done,
    ).toBe(true);
  });

  it("blocks the gate on a style mismatch once styleGateEligible is enabled (issue #39)", () => {
    const eligible = { styleGateEligible: true };
    const withMismatch = {
      ...eligible,
      topIssues: [{ kind: "style-color", severity: "low", message: "color mismatch" }],
    };
    const result = gate(scoreDir(figmaBaseline, withMismatch), figmaBaseline, eligible);
    expect(result.done).toBe(false);
    expect(result.viewports[0]?.reasons).toContain(
      "blocking style mismatch remains (styleGateEligible).",
    );
    // Same evidence, gate disabled -- must still pass (opt-in, not a global behavior change).
    expect(gate(scoreDir(figmaBaseline, { topIssues: withMismatch.topIssues })).done).toBe(true);
  });

  it("blocks the gate on a style-check-error capture failure once styleGateEligible is enabled (issue #39, depends on #35)", () => {
    // A broken/unresolvable style check (see #35's style-check-error diagnostic) must count
    // as blocking too, or an opt-in style gate could be silently defeated by a selector that
    // never produces comparable data in the first place.
    const eligible = { styleGateEligible: true };
    const withCaptureFailure = {
      ...eligible,
      topIssues: [
        { kind: "style-check-error", severity: "low", message: "style check could not run" },
      ],
    };
    const result = gate(scoreDir(figmaBaseline, withCaptureFailure), figmaBaseline, eligible);
    expect(result.done).toBe(false);
    expect(result.viewports[0]?.reasons).toContain(
      "blocking style mismatch remains (styleGateEligible).",
    );
  });

  it("rejects evidence whose styleGateEligible flag diverges from the contract's", () => {
    const notEligible = { styleGateEligible: false };
    const eligible = { styleGateEligible: true };
    expect(gate(scoreDir(figmaBaseline, eligible), figmaBaseline, notEligible).done).toBe(false);
    expect(gate(scoreDir(figmaBaseline, notEligible), figmaBaseline, eligible).done).toBe(false);
  });

  it("rejects run-meta styleGateEligible that diverges from an otherwise-matching visual-score.json", () => {
    const eligible = { styleGateEligible: true };
    const divergedRunMeta = { styleGateEligible: false };
    const dir = scoreDir(figmaBaseline, eligible, divergedRunMeta);
    const result = gate(dir, figmaBaseline, eligible);
    expect(result.done).toBe(false);
    const reasons = result.viewports[0]?.reasons ?? [];
    expect(reasons).toContain("run-meta styleGateEligible does not match contract.");
    expect(reasons).not.toContain("styleGateEligible does not match contract.");
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
