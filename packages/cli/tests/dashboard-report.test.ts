import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { VerificationArtifact, VerificationContract } from "@framelia/contracts";
import { SCHEMA_VERSION } from "@framelia/contracts";
import { afterAll, describe, expect, it } from "vitest";

import { reportCommand } from "../src/internal/dashboard-report.ts";
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

    expect(result.artifactPath).toBe(artifactPath);
    expect(result.reportPath).toBe(path.join(outputDirectory, "index.html"));
    expect(fs.existsSync(result.reportPath)).toBe(true);
  });

  it("propagates a clear, ENOENT-mentioning error for a missing artifact file", async () => {
    const runtime = { ...createFakeProcess(), cwd: () => tmp };
    await expect(
      reportCommand({ artifact: "does-not-exist.json", output: "report-out-2" }, runtime),
    ).rejects.toThrow(/Cannot read verification artifact/);
  });
});
