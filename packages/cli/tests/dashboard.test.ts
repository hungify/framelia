import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { SCHEMA_VERSION, type VerificationArtifact } from "@framelia/contracts";
import { projectArtifact, startDashboardServer } from "@framelia/dashboard-server";
import { afterEach, describe, expect, it } from "vitest";

import {
  aggregateDashboardSource,
  archivedDashboardSource,
  exportDashboardReport,
} from "../src/dashboard/report.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

async function fixture(): Promise<{
  artifact: VerificationArtifact;
  clientRoot: string;
  root: string;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "framelia-dashboard-"));
  temporaryDirectories.push(root);
  const outDir = path.join(root, ".framelia/visual-verifications/home");
  const clientRoot = path.join(root, "client");
  await fs.mkdir(outDir, { recursive: true });
  await fs.mkdir(clientRoot);
  await fs.writeFile(path.join(clientRoot, "index.html"), "<main>Framelia</main>");
  await writeScore(outDir);
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
    allPassed: false,
    results: [{ id: "home", ok: true, pass: false, outDir }],
  };
  return { artifact, clientRoot, root };
}

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

async function writeScore(outDir: string, overrides: Record<string, unknown> = {}): Promise<void> {
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
      pass: false,
      matchRatio: 0.98,
      ssim: 0.97,
      avgDeltaE: 2.4,
      diffPixels: 120,
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
      ...overrides,
    }),
  );
}

describe("dashboard projection", () => {
  it("blocks missing capture evidence instead of projecting a pass", async () => {
    const { artifact } = await fixture();
    const scorePath = path.join(artifact.results[0]!.outDir, "visual-score.json");
    const score = JSON.parse(await fs.readFile(scorePath, "utf8")) as Record<string, unknown>;
    delete score.captureEvidence;
    score.pass = true;
    await fs.writeFile(scorePath, JSON.stringify(score));

    const projection = await projectArtifact({
      ...artifact,
      allPassed: true,
      results: [{ ...artifact.results[0]!, pass: true }],
    });
    expect(projection.run.contracts[0]).toMatchObject({
      status: "blocked",
      diagnostics: [expect.objectContaining({ code: "CAPTURE_EVIDENCE_MISSING", blocking: true })],
    });
  });

  it("preserves final URL, readiness, font and action retry evidence", async () => {
    const { artifact } = await fixture();
    const scorePath = path.join(artifact.results[0]!.outDir, "visual-score.json");
    const score = JSON.parse(await fs.readFile(scorePath, "utf8")) as Record<string, any>;
    score.captureEvidence.finalUrl = "https://actual.test/redirected";
    score.captureEvidence.fonts = { supported: true, status: "loading", failed: ["Inter"] };
    score.captureEvidence.readiness = { event: "framelia:ready", status: "passed" };
    score.captureEvidence.actions = [
      {
        index: 0,
        kind: "click",
        status: "failed",
        attempts: 3,
        startedAt: "2026-08-08T00:00:00.000Z",
        finishedAt: "2026-08-08T00:00:01.000Z",
        selector: "#save",
        error: "timeout",
      },
    ];
    await fs.writeFile(scorePath, JSON.stringify(score));

    const projection = await projectArtifact(artifact);
    expect(projection.run.contracts[0]).toMatchObject({
      status: "blocked",
      captureEvidence: {
        finalUrl: "https://actual.test/redirected",
        readiness: { event: "framelia:ready" },
        fonts: { failed: ["Inter"] },
        actions: [expect.objectContaining({ attempts: 3, status: "failed" })],
      },
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ kind: "font-fallback", blocking: false }),
        expect.objectContaining({ code: "REDIRECT_MISMATCH", blocking: true }),
        expect.objectContaining({ code: "NAVIGATION_ACTION_FAILED", blocking: true }),
      ]),
    });
  });

  it("includes deviceScaleFactor and virtual artifactPaths in projected capture evidence", async () => {
    const { artifact } = await fixture();

    const projection = await projectArtifact(artifact, undefined, { deviceScaleFactor: 2 });
    expect(projection.run.contracts[0]?.captureEvidence).toMatchObject({
      viewport: { deviceScaleFactor: 2 },
      artifactPaths: {
        score: "contracts/home/visual-score.json",
        baseline: "contracts/home/figma-baseline.png",
        actual: "contracts/home/actual.png",
        diff: "contracts/home/diff.png",
      },
    });
  });

  it("does not flag REDIRECT_MISMATCH when query parameters are reordered", async () => {
    const { artifact } = await fixture();
    const scorePath = path.join(artifact.results[0]!.outDir, "visual-score.json");
    const score = JSON.parse(await fs.readFile(scorePath, "utf8")) as Record<string, any>;
    score.pass = true;
    score.captureEvidence.finalUrl = "https://actual.test/?locale=en&theme=dark";
    await fs.writeFile(scorePath, JSON.stringify(score));
    artifact.request.target.url = "https://actual.test/?theme=dark&locale=en";

    const projection = await projectArtifact({
      ...artifact,
      allPassed: true,
      results: [{ ...artifact.results[0]!, pass: true, outDir: artifact.results[0]!.outDir }],
    });
    expect(projection.run.contracts[0]).toMatchObject({
      status: "passed",
      captureEvidence: { expectedUrl: "https://actual.test/?theme=dark&locale=en" },
    });
    expect(projection.run.contracts[0]?.diagnostics ?? []).not.toContainEqual(
      expect.objectContaining({ code: "REDIRECT_MISMATCH" }),
    );
  });

  it("keeps masked-pass contracts out of the clean passed count", async () => {
    const { artifact } = await fixture();
    const scorePath = path.join(artifact.results[0]!.outDir, "visual-score.json");
    const score = JSON.parse(await fs.readFile(scorePath, "utf8")) as Record<string, any>;
    score.pass = true;
    score.diagnostics = [
      {
        kind: "masked-pass",
        code: "MASKED_PASS",
        message: "2 declared mask region(s), area ratio 0.0250.",
        blocking: false,
      },
    ];
    score.captureEvidence.maskEvidence = {
      requested: [
        { selector: ".ad-banner", reason: "external ad", maxMatches: 1, matchedCount: 1 },
      ],
      matchedCount: 1,
      bounds: [{ x: 0, y: 0, width: 320, height: 40 }],
      unionMaskedArea: 12800,
      maskedAreaRatio: 12800 / (320 * 240),
      maskColor: "#FF00FF",
      status: "applied",
    };
    await fs.writeFile(scorePath, JSON.stringify(score));

    const projection = await projectArtifact({
      ...artifact,
      allPassed: true,
      results: [{ ...artifact.results[0]!, pass: true }],
    });
    expect(projection.run.status).toBe("masked-pass");
    expect(projection.run.summary).toMatchObject({
      total: 1,
      passed: 0,
      "masked-pass": 1,
      failed: 0,
      blocked: 0,
    });
    expect(projection.run.contracts[0]).toMatchObject({
      status: "masked-pass",
      maskEvidence: { status: "applied", matchedCount: 1 },
      diagnostics: [expect.objectContaining({ kind: "masked-pass", blocking: false })],
    });
  });

  it("blocks skipped evidence and preserves diagnostic notes", async () => {
    const { artifact } = await fixture();
    const scorePath = path.join(artifact.results[0]!.outDir, "visual-score.json");
    const score = JSON.parse(await fs.readFile(scorePath, "utf8")) as Record<string, unknown>;
    score.diagnostics = [
      {
        kind: "skipped",
        code: "GATE_SKIPPED",
        message: "style-gate skipped: no comparable style data.",
        blocking: true,
      },
    ];
    await fs.writeFile(scorePath, JSON.stringify(score));

    const projection = await projectArtifact(artifact);
    expect(projection.run.status).toBe("blocked");
    expect(projection.run.contracts[0]?.diagnostics).toEqual([
      expect.objectContaining({ kind: "skipped", blocking: true }),
    ]);
  });

  it("adapts canonical verification evidence without changing engine artifact", async () => {
    const { artifact } = await fixture();
    const projection = await projectArtifact(artifact);
    expect(projection.run).toMatchObject({
      status: "failed",
      summary: { total: 1, failed: 1 },
      contracts: [
        {
          id: "home",
          baselineKind: "figma",
          capture: { kind: "viewport", viewport: { width: 320, height: 240 } },
          comparison: { matchRatio: 0.98, ssim: 0.97, diffPixels: 120 },
        },
      ],
    });
    expect(projection.files.size).toBe(4);
  });

  it("degrades one contract instead of failing the whole projection on malformed score evidence", async () => {
    const { artifact } = await fixture();
    await fs.writeFile(
      path.join(artifact.results[0]!.outDir, "visual-score.json"),
      JSON.stringify({ pass: false }),
    );
    // A corrupted visual-score.json for one contract must not reject the whole
    // Promise.all -- it degrades that contract to "blocked" via the same
    // CAPTURE_EVIDENCE_MISSING diagnostic path a missing score file already uses.
    const projection = await projectArtifact(artifact);
    expect(projection.run.contracts[0]).toMatchObject({ status: "blocked" });
    expect(
      (projection.run.contracts[0]?.diagnostics ?? []).map((diagnostic) => diagnostic.code),
    ).toContain("CAPTURE_EVIDENCE_MISSING");
  });

  it("does not flag REDIRECT_MISMATCH for URL canonicalization differences", async () => {
    const { artifact } = await fixture();
    const scorePath = path.join(artifact.results[0]!.outDir, "visual-score.json");
    const score = JSON.parse(await fs.readFile(scorePath, "utf8")) as Record<string, any>;
    score.pass = true;
    score.captureEvidence.finalUrl = "https://actual.test/";
    await fs.writeFile(scorePath, JSON.stringify(score));

    const projection = await projectArtifact({
      ...artifact,
      allPassed: true,
      results: [{ ...artifact.results[0]!, pass: true }],
    });
    expect(projection.run.contracts[0]).toMatchObject({ status: "passed" });
    expect(
      (projection.run.contracts[0]?.diagnostics ?? []).map((diagnostic) => diagnostic.code),
    ).not.toContain("REDIRECT_MISMATCH");
  });

  it("does not duplicate font-fallback diagnostics that the engine already reported", async () => {
    const { artifact } = await fixture();
    const scorePath = path.join(artifact.results[0]!.outDir, "visual-score.json");
    const score = JSON.parse(await fs.readFile(scorePath, "utf8")) as Record<string, any>;
    score.pass = true;
    score.captureEvidence.fonts = { supported: true, status: "loading", failed: ["Inter"] };
    score.diagnostics = [
      {
        kind: "font-fallback",
        code: "FONT_FALLBACK_OR_LOAD_FAILURE",
        message: "font fallback while loading Inter",
        blocking: false,
      },
    ];
    await fs.writeFile(scorePath, JSON.stringify(score));

    const projection = await projectArtifact({
      ...artifact,
      allPassed: true,
      results: [{ ...artifact.results[0]!, pass: true }],
    });
    const diagnostics = projection.run.contracts[0]?.diagnostics ?? [];
    expect(
      diagnostics.filter((diagnostic) => diagnostic.code === "FONT_FALLBACK_OR_LOAD_FAILURE"),
    ).toHaveLength(1);
  });

  it("treats skipped masks as non-blocking evidence", async () => {
    const { artifact } = await fixture();
    const scorePath = path.join(artifact.results[0]!.outDir, "visual-score.json");
    const score = JSON.parse(await fs.readFile(scorePath, "utf8")) as Record<string, any>;
    score.pass = true;
    score.captureEvidence.maskEvidence = {
      requested: [{ selector: ".ad-banner", reason: "external ad", maxMatches: 1 }],
      matchedCount: 0,
      bounds: [],
      unionMaskedArea: 0,
      maskedAreaRatio: 0,
      maskColor: "#FF00FF",
      status: "skipped",
    };
    await fs.writeFile(scorePath, JSON.stringify(score));

    const projection = await projectArtifact({
      ...artifact,
      allPassed: true,
      results: [{ ...artifact.results[0]!, pass: true }],
    });
    expect(projection.run.contracts[0]).toMatchObject({ status: "passed" });
    expect(projection.run.contracts[0]?.diagnostics).toContainEqual(
      expect.objectContaining({ code: "MASK_EVIDENCE_INCOMPLETE", blocking: false }),
    );
  });

  it("does not blame missing capture evidence when the engine already failed", async () => {
    const { artifact } = await fixture();
    const outDir = artifact.results[0]!.outDir;
    await fs.rm(path.join(outDir, "visual-score.json"));

    const projection = await projectArtifact({
      ...artifact,
      ok: false,
      allPassed: false,
      results: [
        {
          id: "home",
          ok: false,
          pass: false,
          error: "CAPTURE_NAVIGATION_FAILED",
          message: "Target navigation failed.",
          outDir,
        },
      ],
    });
    const contract = projection.run.contracts[0]!;
    expect(contract.diagnostics ?? []).not.toContainEqual(
      expect.objectContaining({ code: "CAPTURE_EVIDENCE_MISSING" }),
    );
    expect(contract.blockers).toEqual([
      { code: "CAPTURE_NAVIGATION_FAILED", message: "Target navigation failed." },
    ]);
    expect(contract.status).toBe("blocked");
  });

  it("serves archived run and only allowlisted evidence files", async () => {
    const { artifact, clientRoot } = await fixture();
    const server = await startDashboardServer({
      source: await archivedDashboardSource(artifact),
      clientRoot,
    });
    try {
      expect(await (await fetch(`${server.url}/api/run`)).json()).toMatchObject({
        status: "failed",
      });
      expect((await fetch(`${server.url}/artifacts/contracts/home/actual.png`)).status).toBe(200);
      expect((await fetch(`${server.url}/artifacts/not-allowlisted.png`)).status).toBe(404);
      expect(await (await fetch(`${server.url}/contracts/home`)).text()).toContain("Framelia");
    } finally {
      await server.close();
    }
  });

  it("exports portable report into empty directory", async () => {
    const { artifact, clientRoot, root } = await fixture();
    const outputDirectory = path.join(root, "report");
    const indexPath = await exportDashboardReport({ artifact, outputDirectory, clientRoot });
    expect(await fs.readFile(indexPath, "utf8")).toContain("Framelia");
    expect(
      JSON.parse(
        await fs.readFile(path.join(outputDirectory, "data/visual-verification.json"), "utf8"),
      ),
    ).toMatchObject({ summary: { failed: 1 } });
    await expect(
      fs.access(path.join(outputDirectory, "data/contracts/home/diff.png")),
    ).resolves.toBeUndefined();
  });

  it("refuses to clear a non-empty output directory that isn't a previous Framelia report", async () => {
    const { artifact, clientRoot, root } = await fixture();
    const outputDirectory = path.join(root, "report");
    await fs.mkdir(outputDirectory, { recursive: true });
    await fs.writeFile(path.join(outputDirectory, "unrelated.txt"), "not ours");

    await expect(exportDashboardReport({ artifact, outputDirectory, clientRoot })).rejects.toThrow(
      /not empty and is not a previous Framelia report/,
    );
    await expect(fs.access(path.join(outputDirectory, "unrelated.txt"))).resolves.toBeUndefined();
  });

  it("re-exports over its own previous report output without a caller-side rm", async () => {
    const { artifact, clientRoot, root } = await fixture();
    const outputDirectory = path.join(root, "report");
    await exportDashboardReport({ artifact, outputDirectory, clientRoot });
    await fs.writeFile(path.join(outputDirectory, "stale-asset.png"), "old");

    await exportDashboardReport({ artifact, outputDirectory, clientRoot });

    await expect(fs.access(path.join(outputDirectory, "stale-asset.png"))).rejects.toThrow(
      /ENOENT/,
    );
    await expect(
      fs.access(path.join(outputDirectory, "data/contracts/home/diff.png")),
    ).resolves.toBeUndefined();
  });
});

describe("aggregateDashboardSource", () => {
  it("merges every visual-verification.json under .framelia/, tagging contracts with their feature", async () => {
    const { artifact, root } = await fixture();
    await fs.writeFile(
      path.join(root, ".framelia/visual-verifications/home/visual-verification.json"),
      JSON.stringify(artifact),
    );

    const loginArtifact: VerificationArtifact = {
      schemaVersion: SCHEMA_VERSION,
      kind: "framelia.visual-verification",
      createdAt: new Date().toISOString(),
      projectRoot: root,
      request: {
        schemaVersion: SCHEMA_VERSION,
        target: { kind: "web", url: "https://actual.test/login" },
        contracts: [
          {
            id: "desktop",
            baseline: { kind: "figma", fileKey: "abc123", nodeId: "1:2" },
            viewport: { name: "desktop", width: 1440, height: 1024 },
            outDir: ".framelia/visual-verifications/login/run-2026-08-04/desktop",
            scope: { kind: "page", pageReason: "release page" },
          },
        ],
      },
      ok: true,
      allPassed: true,
      results: [
        {
          id: "desktop",
          ok: true,
          pass: true,
          outDir: path.join(root, ".framelia/visual-verifications/login/run-2026-08-04/desktop"),
        },
      ],
    };
    await fs.mkdir(path.join(root, ".framelia/visual-verifications/login/run-2026-08-04"), {
      recursive: true,
    });
    await fs.mkdir(loginArtifact.results[0]!.outDir, { recursive: true });
    await writeScore(loginArtifact.results[0]!.outDir, {
      pass: true,
      target: { url: "https://actual.test/login" },
      captureEvidence: { ...captureEvidence, finalUrl: "https://actual.test/login" },
    });
    await fs.writeFile(
      path.join(
        root,
        ".framelia/visual-verifications/login/run-2026-08-04/visual-verification.json",
      ),
      JSON.stringify(loginArtifact),
    );

    const source = await aggregateDashboardSource(root);
    const run = await source.snapshot();
    expect(run.summary.total).toBe(2);
    const ids = run.contracts.map((contract) => contract.id).toSorted();
    // "home"'s contract.id already equals its feature key -- prefixing would double it.
    expect(ids).toEqual(["home", "login.desktop"]);
    expect(run.contracts.find((contract) => contract.id === "login.desktop")).toMatchObject({
      feature: "login",
      status: "passed",
    });
    expect(run.contracts.find((contract) => contract.id === "home")).toMatchObject({
      feature: "home",
    });

    const files = await source.files();
    expect(files.has("home/contracts/home/actual.png")).toBe(true);
  });

  it("keeps host/port in the feature key (unlighthouse-style nesting) so envs don't collide", async () => {
    const { artifact, root } = await fixture();
    const dir = path.join(root, ".framelia/visual-verifications/127.0.0.1/3000/login");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "visual-verification.json"), JSON.stringify(artifact));

    const source = await aggregateDashboardSource(root);
    const run = await source.snapshot();
    expect(run.contracts[0]).toMatchObject({
      feature: "127.0.0.1/3000/login",
      id: "127.0.0.1/3000/login.home",
    });
  });

  it("returns an empty run instead of throwing when .framelia/ has no verifications", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "framelia-dashboard-empty-"));
    temporaryDirectories.push(root);
    const source = await aggregateDashboardSource(root);
    const run = await source.snapshot();
    expect(run.contracts).toEqual([]);
    expect(run.summary.total).toBe(0);
    expect(run.status).toBe("passed");
  });

  it("ignores portable report data under report/data/ when aggregating", async () => {
    const { artifact, root } = await fixture();
    const artifactDir = path.join(root, ".framelia/visual-verifications/home");
    await fs.writeFile(
      path.join(artifactDir, "visual-verification.json"),
      JSON.stringify(artifact),
    );
    // Simulate a verify --output sibling report that stores DashboardRun JSON under report/data/.
    const reportDataDir = path.join(artifactDir, "report", "data");
    await fs.mkdir(reportDataDir, { recursive: true });
    await fs.writeFile(
      path.join(reportDataDir, "visual-verification.json"),
      JSON.stringify({
        schemaVersion: 1,
        runId: "report-run",
        status: "failed",
        summary: { total: 1, passed: 0, failed: 1, blocked: 0, running: 0, queued: 0 },
        contracts: [],
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    );

    const source = await aggregateDashboardSource(root);
    const run = await source.snapshot();
    expect(run.summary.total).toBe(1);
    expect(run.contracts[0]?.id).toBe("home");
  });
});
