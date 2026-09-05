import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { SCHEMA_VERSION, type VerificationArtifact } from "@framelia/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { overallStatus, projectArtifact, summarize } from "../src/model.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

const captureEvidence = {
  finalUrl: "https://actual.test",
  startedAt: "2026-08-08T00:00:00.000Z",
  capturedAt: "2026-08-08T00:00:01.000Z",
  finishedAt: "2026-08-08T00:00:02.000Z",
  viewport: { width: 320, height: 240 },
  readiness: { selector: "#app", matchCount: 1, status: "passed" },
  fonts: { supported: true, status: "loaded", failed: [] },
  scope: { kind: "page", fullPage: true },
  screenshotHashes: [`sha256:${"d".repeat(64)}`],
  warnings: [],
  actions: [],
  maskEvidence: null,
  elementRect: null,
};

async function fixture(): Promise<{ artifact: VerificationArtifact }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "framelia-dashboard-server-"));
  temporaryDirectories.push(root);
  const outDir = path.join(root, ".framelia/visual-verifications/home");
  await fs.mkdir(outDir, { recursive: true });
  const baselinePath = path.join(outDir, "web-baseline.png");
  const actualPath = path.join(outDir, "actual.png");
  const diffPath = path.join(outDir, "diff.png");
  await fs.writeFile(baselinePath, Buffer.from([1, 2, 3]));
  await fs.writeFile(actualPath, Buffer.from([4, 5, 6]));
  await fs.writeFile(diffPath, Buffer.from([7, 8, 9]));
  await fs.writeFile(
    path.join(outDir, "visual-score.json"),
    JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      ok: true,
      pass: true,
      matchRatio: 0.995,
      ssim: 0.98,
      avgDeltaE: 1.2,
      diffPixels: 10,
      baselineSize: { width: 320, height: 240 },
      actualSize: { width: 320, height: 240 },
      baseline: { kind: "web", path: baselinePath, url: "https://baseline.test", revision: "main" },
      target: { url: "https://actual.test" },
      selector: null,
      stability: "stable",
      evidenceHashes: {
        baseline: `sha256:${"a".repeat(64)}`,
        actual: `sha256:${"b".repeat(64)}`,
        diff: `sha256:${"c".repeat(64)}`,
      },
      artifacts: { baseline: baselinePath, actual: actualPath, diff: diffPath },
      captureEvidence,
    }),
  );
  const artifact: VerificationArtifact = {
    schemaVersion: SCHEMA_VERSION,
    kind: "framelia.visual-verification",
    createdAt: new Date().toISOString(),
    projectRoot: root,
    request: {
      schemaVersion: SCHEMA_VERSION,
      target: { kind: "web", url: "https://actual.test" },
      contracts: [
        {
          id: "home",
          baseline: { kind: "figma", fileKey: "abc123", nodeId: "1:2" },
          viewport: { name: "desktop", width: 320, height: 240 },
          outDir: ".framelia/visual-verifications/home",
          scope: { kind: "page", pageReason: "release page" },
        },
      ],
    },
    ok: true,
    allPassed: true,
    results: [{ id: "home", ok: true, pass: true, outDir }],
  };
  return { artifact };
}

describe("projectArtifact (relocated to @framelia/dashboard-server, U5)", () => {
  it("projects a clean pass with resolved comparison evidence", async () => {
    const { artifact } = await fixture();
    const projection = await projectArtifact(artifact);
    expect(projection.run).toMatchObject({
      status: "passed",
      summary: { total: 1, passed: 1 },
      contracts: [
        {
          id: "home",
          status: "passed",
          comparison: { matchRatio: 0.995, ssim: 0.98 },
        },
      ],
    });
    expect(projection.files.size).toBe(4);
  });

  it("blocks missing capture evidence instead of projecting a pass", async () => {
    const { artifact } = await fixture();
    const scorePath = path.join(artifact.results[0]!.outDir, "visual-score.json");
    const score = JSON.parse(await fs.readFile(scorePath, "utf8")) as Record<string, unknown>;
    delete score.captureEvidence;
    await fs.writeFile(scorePath, JSON.stringify(score));

    const projection = await projectArtifact(artifact);
    expect(projection.run.contracts[0]).toMatchObject({
      status: "blocked",
      diagnostics: [expect.objectContaining({ code: "CAPTURE_EVIDENCE_MISSING", blocking: true })],
    });
  });

  it("projects style-comparison topIssues onto the contract result", async () => {
    const { artifact } = await fixture();
    const scorePath = path.join(artifact.results[0]!.outDir, "visual-score.json");
    const score = JSON.parse(await fs.readFile(scorePath, "utf8")) as Record<string, unknown>;
    score.topIssues = [
      {
        severity: "low",
        kind: "style-color",
        message: "style mismatch on color: expected #000000ff, actual #111111ff",
        hint: "Check the rendered element's CSS against the Figma node's style.",
        repairCandidate: true,
        blocking: false,
      },
    ];
    await fs.writeFile(scorePath, JSON.stringify(score));

    const projection = await projectArtifact(artifact);
    expect(projection.run.contracts[0]).toMatchObject({
      status: "passed",
      topIssues: [expect.objectContaining({ kind: "style-color" })],
    });
  });

  it("carries each style issue's originating check-point selector through the projection", async () => {
    const { artifact } = await fixture();
    const scorePath = path.join(artifact.results[0]!.outDir, "visual-score.json");
    const score = JSON.parse(await fs.readFile(scorePath, "utf8")) as Record<string, unknown>;
    score.topIssues = [
      {
        severity: "low",
        kind: "style-color",
        message: "style mismatch on color: expected #000000ff, actual #111111ff",
        repairCandidate: true,
        blocking: false,
        selector: "header",
      },
      {
        severity: "low",
        kind: "style-typography",
        message: "style mismatch on font-size: expected 16px, actual 14px",
        repairCandidate: true,
        blocking: false,
        selector: ".hero",
      },
    ];
    await fs.writeFile(scorePath, JSON.stringify(score));

    const projection = await projectArtifact(artifact);
    expect(projection.run.contracts[0]?.topIssues).toEqual([
      expect.objectContaining({ kind: "style-color", selector: "header" }),
      expect.objectContaining({ kind: "style-typography", selector: ".hero" }),
    ]);
  });

  it("omits topIssues from the contract result when the score has none", async () => {
    const { artifact } = await fixture();
    const projection = await projectArtifact(artifact);
    expect(projection.run.contracts[0]?.topIssues).toBeUndefined();
  });

  it("derives resolvedThreshold from the persisted profile/clusterCheck (#8)", async () => {
    const { artifact } = await fixture();
    const scorePath = path.join(artifact.results[0]!.outDir, "visual-score.json");
    const score = JSON.parse(await fs.readFile(scorePath, "utf8")) as Record<string, unknown>;
    score.profile = "component/strict";
    score.clusterCheck = true;
    await fs.writeFile(scorePath, JSON.stringify(score));

    const projection = await projectArtifact(artifact);
    expect(projection.run.contracts[0]).toMatchObject({
      resolvedThreshold: {
        name: "component/strict",
        minMatch: 0.995,
        maxDiffPixels: 500,
        minSSIM: 0.985,
        maxAvgDeltaE: 3.0,
        cluster: true,
      },
    });
  });

  it("keeps masked-pass contracts out of the clean passed count", async () => {
    const { artifact } = await fixture();
    const scorePath = path.join(artifact.results[0]!.outDir, "visual-score.json");
    const score = JSON.parse(await fs.readFile(scorePath, "utf8")) as Record<string, any>;
    score.diagnostics = [
      {
        kind: "masked-pass",
        code: "MASKED_PASS",
        message: "1 declared mask region(s).",
        blocking: false,
      },
    ];
    await fs.writeFile(scorePath, JSON.stringify(score));

    const projection = await projectArtifact(artifact);
    expect(projection.run.status).toBe("masked-pass");
    expect(projection.run.summary).toMatchObject({ passed: 0, "masked-pass": 1 });
  });
});

describe("summarize / overallStatus", () => {
  it("prioritizes running over queued over blocked over failed over masked-pass", () => {
    const base = {
      id: "a",
      name: "a",
      tags: [],
      phase: "complete" as const,
      baselineKind: "figma" as const,
      capture: { kind: "viewport" as const, viewport: { width: 1, height: 1 } },
      blockers: [],
    };
    const summary = summarize([
      { ...base, status: "running" },
      { ...base, status: "queued" },
      { ...base, status: "blocked" },
      { ...base, status: "failed" },
      { ...base, status: "masked-pass" },
    ]);
    expect(summary).toMatchObject({
      total: 5,
      running: 1,
      queued: 1,
      blocked: 1,
      failed: 1,
      "masked-pass": 1,
    });
    expect(overallStatus(summary)).toBe("running");
  });

  it("reports passed when every contract passed cleanly", () => {
    const summary = summarize([]);
    expect(overallStatus(summary)).toBe("passed");
  });
});
