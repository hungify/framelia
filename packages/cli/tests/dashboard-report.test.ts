import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { VerificationArtifact, VerificationContract } from "@framelia/contracts";
import { SCHEMA_VERSION } from "@framelia/contracts";
import { afterAll, describe, expect, it } from "vitest";

import {
  aggregateDashboardSource,
  exportDashboardReport,
  readVerificationArtifact,
} from "../src/dashboard/report.ts";
import { reportCommand } from "../src/internal/dashboard-report.ts";
import { openProject } from "../src/internal/project.ts";
import { createFakeProcess } from "./fake-process.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-cli-dashboard-report-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function writeMinimalArtifact(fileName: string): string {
  const id = "contract-1";
  const contract: VerificationContract = {
    id,
    name: id,
    baseline: { kind: "figma", fileKey: "file-key", nodeId: "153:5181" },
    viewport: { preset: "desktop", width: 1440, height: 1024 },
    outDir: `.framelia/visual-verifications/${id}`,
    scope: { kind: "page", pageReason: "full page baseline" },
  };
  const artifact: VerificationArtifact = {
    schemaVersion: SCHEMA_VERSION,
    kind: "framelia.visual-verification",
    createdAt: new Date().toISOString(),
    projectRoot: tmp,
    request: {
      schemaVersion: SCHEMA_VERSION,
      target: { kind: "web", url: "http://localhost:3000/" },
      contracts: [contract],
    },
    ok: true,
    allPassed: true,
    results: [{ id, ok: true, pass: true, outDir: path.join(tmp, contract.outDir) }],
  };
  const artifactPath = path.join(tmp, fileName);
  fs.writeFileSync(artifactPath, JSON.stringify(artifact));
  return artifactPath;
}

describe("internal/dashboard-report.ts: reportCommand", () => {
  it("resolves artifact/output paths from the injected runtime cwd and returns {artifactPath, reportPath}", async () => {
    const artifactPath = writeMinimalArtifact("report-artifact.json");
    const outputDirectory = path.join(tmp, "report-out");
    const runtime = { ...createFakeProcess(), cwd: () => tmp };

    const result = await reportCommand(
      { artifact: "report-artifact.json", output: "report-out" },
      runtime,
    );

    expect(result.body.artifactPath).toBe(artifactPath);
    expect(result.body.reportPath).toBe(path.join(outputDirectory, "index.html"));
    expect(fs.existsSync(result.body.reportPath)).toBe(true);
  });

  it("propagates a clear, ENOENT-mentioning error for a missing artifact file", async () => {
    const runtime = { ...createFakeProcess(), cwd: () => tmp };
    await expect(
      reportCommand({ artifact: "does-not-exist.json", output: "report-out-2" }, runtime),
    ).rejects.toThrow(/Cannot read verification artifact/);
  });
});

describe("report preservation and aggregation", () => {
  it("preserves unrelated files when the output is not a previous report", async () => {
    const artifact = await readVerificationArtifact(writeMinimalArtifact("guard-artifact.json"));
    const outputDirectory = path.join(tmp, "unrelated");
    fs.mkdirSync(outputDirectory);
    const sentinel = path.join(outputDirectory, "user-data.txt");
    fs.writeFileSync(sentinel, "keep");
    await expect(exportDashboardReport({ artifact, outputDirectory })).rejects.toThrow(
      /not a previous Framelia report/,
    );
    expect(fs.readFileSync(sentinel, "utf8")).toBe("keep");
  });

  it("refuses report output inside an artifact directory without deleting evidence", async () => {
    const artifact = await readVerificationArtifact(writeMinimalArtifact("nested-artifact.json"));
    const outputDirectory = path.join(artifact.results[0]!.outDir, "report");
    fs.mkdirSync(outputDirectory, { recursive: true });
    const sentinel = path.join(outputDirectory, "evidence.png");
    fs.writeFileSync(sentinel, "evidence");
    await expect(exportDashboardReport({ artifact, outputDirectory })).rejects.toThrow(
      /inside contract artifact directory/,
    );
    expect(fs.readFileSync(sentinel, "utf8")).toBe("evidence");
  });

  it("replaces a marked report with a new exported run", async () => {
    const artifact = await readVerificationArtifact(writeMinimalArtifact("repeat-artifact.json"));
    const outputDirectory = path.join(tmp, "repeat-report");
    await exportDashboardReport({ artifact, outputDirectory, suiteName: "before" });
    await exportDashboardReport({ artifact, outputDirectory, suiteName: "after" });
    const run = JSON.parse(
      fs.readFileSync(path.join(outputDirectory, "data", "visual-verification.json"), "utf8"),
    );
    expect(run.suiteName).toBe("after");
    expect(run.contracts[0].id).toBe("contract-1");
  });

  it("namespaces duplicate ids from separate features and ignores exported report data", async () => {
    const root = path.join(tmp, "aggregate");
    const artifact = await readVerificationArtifact(
      writeMinimalArtifact("aggregate-artifact.json"),
    );
    const featureRoots = ["login", "checkout", "login/report/data"];
    for (const feature of featureRoots) {
      const directory = path.join(root, ".framelia/visual-verifications", feature);
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, "visual-verification.json"), JSON.stringify(artifact));
    }
    const source = await aggregateDashboardSource(openProject(root, createFakeProcess()));
    const snapshot = await source.snapshot();
    expect(snapshot.contracts.map((contract) => contract.id).toSorted()).toEqual([
      "checkout.contract-1",
      "login.contract-1",
    ]);
  });
});
