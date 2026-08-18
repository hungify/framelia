import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type {
  BaselineSource,
  VerificationArtifact,
  VerificationContract,
} from "@framelia/contracts";
import { afterAll, describe, expect, it } from "vitest";

import { doneGateFromArtifact, SCHEMA_VERSION } from "../src/index.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fidelity-verify-artifact-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const target = { kind: "web" as const, url: "http://localhost:3000/login" };
const figmaBaseline: BaselineSource = { kind: "figma", fileKey: "file-key", nodeId: "153:5181" };

function fileHash(filePath: string): string {
  return `sha256:${crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")}`;
}

/** Writes a passing score directory (run-meta, punch-list, visual-score) that satisfies checkDoneGate. */
function passingScoreDir(outDir: string, contract: VerificationContract): void {
  fs.mkdirSync(outDir, { recursive: true });
  const timestamp = new Date().toISOString();
  const baselinePath = path.join(outDir, "figma-baseline.png");
  const metaPath = path.join(outDir, "figma-baseline.meta.json");
  for (const name of ["figma-baseline.png", "actual.png", "diff.png"])
    fs.writeFileSync(path.join(outDir, name), "fixture");
  const baselineEvidence = {
    kind: "figma",
    path: baselinePath,
    metaPath,
    fileKey: figmaBaseline.fileKey,
    nodeId: figmaBaseline.nodeId,
    fetchedAt: timestamp,
    lastModified: null,
  };
  fs.writeFileSync(
    metaPath,
    JSON.stringify({
      fileKey: figmaBaseline.fileKey,
      nodeId: figmaBaseline.nodeId,
      fetchedAt: timestamp,
    }),
  );
  const scope = contract.scope;
  const profile = scope.kind === "page" ? "page" : (contract.profile ?? "component/strict");
  fs.writeFileSync(
    path.join(outDir, "run-meta.json"),
    JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      target,
      baseline: baselineEvidence,
      viewport: contract.viewport.name,
      viewportSize: { width: contract.viewport.width, height: contract.viewport.height },
      profile,
      pageReason: scope.kind === "page" ? scope.pageReason : null,
      runType: "final",
    }),
  );
  fs.writeFileSync(
    path.join(outDir, "punch-list.json"),
    JSON.stringify({ schemaVersion: SCHEMA_VERSION, pass: true, items: [] }),
  );
  fs.writeFileSync(
    path.join(outDir, "visual-score.json"),
    JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      pass: true,
      runType: "final",
      capturedAt: timestamp,
      target,
      baseline: baselineEvidence,
      viewport: contract.viewport.name,
      profile,
      pageReason: scope.kind === "page" ? scope.pageReason : null,
      selector: scope.kind === "region" ? scope.selector : null,
      expectSize: scope.kind === "region" ? scope.expectSize : null,
      stability: "stable",
      outDir,
      evidenceHashes: {
        baseline: fileHash(baselinePath),
        baselineMeta: fileHash(metaPath),
        actual: fileHash(path.join(outDir, "actual.png")),
        diff: fileHash(path.join(outDir, "diff.png")),
      },
    }),
  );
}

let n = 0;
function makeArtifact(options: {
  projectRoot: string;
  scope: VerificationContract["scope"];
  ok?: boolean;
  allPassed?: boolean;
  resultPass?: boolean;
}): VerificationArtifact {
  const id = `contract-${n++}`;
  const outDir = `.framelia/visual-verifications/${id}`;
  const contract: VerificationContract = {
    id,
    baseline: figmaBaseline,
    viewport: { name: "desktop", width: 1440, height: 1024 },
    outDir,
    scope: options.scope,
    profile: options.scope.kind === "region" ? "component/strict" : undefined,
  };
  passingScoreDir(path.join(options.projectRoot, outDir), contract);
  const ok = options.ok ?? true;
  const allPassed = options.allPassed ?? true;
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: "framelia.visual-verification",
    createdAt: new Date().toISOString(),
    projectRoot: options.projectRoot,
    request: { schemaVersion: SCHEMA_VERSION, target, contracts: [contract] },
    ok,
    allPassed,
    results: [
      {
        id,
        ok,
        pass: options.resultPass ?? allPassed,
        outDir,
      },
    ],
  };
}

describe("doneGateFromArtifact", () => {
  it("passes when the artifact and every viewport's score gate pass (page scope)", () => {
    const projectRoot = fs.mkdtempSync(path.join(tmp, "page-"));
    const artifact = makeArtifact({
      projectRoot,
      scope: { kind: "page", pageReason: "full page baseline" },
    });
    const verdict = doneGateFromArtifact(artifact);
    expect(verdict.done).toBe(true);
  });

  it("passes when the artifact and every viewport's score gate pass (region scope)", () => {
    const projectRoot = fs.mkdtempSync(path.join(tmp, "region-"));
    const artifact = makeArtifact({
      projectRoot,
      scope: {
        kind: "region",
        selector: '[data-testid="auth.login"]',
        expectSize: { width: 544, height: 464 },
      },
    });
    const verdict = doneGateFromArtifact(artifact);
    expect(verdict.done).toBe(true);
    expect(verdict.viewports[0]?.viewport).toBe("desktop");
  });

  it("fails every viewport when the artifact itself is not ok, even if each score gate passes", () => {
    const projectRoot = fs.mkdtempSync(path.join(tmp, "artifact-not-ok-"));
    const artifact = makeArtifact({
      projectRoot,
      scope: { kind: "page", pageReason: "full page baseline" },
      ok: false,
      allPassed: false,
      resultPass: false,
    });
    const verdict = doneGateFromArtifact(artifact);
    expect(verdict.done).toBe(false);
  });

  it("fails every viewport when allPassed is false, even if ok is true", () => {
    const projectRoot = fs.mkdtempSync(path.join(tmp, "not-all-passed-"));
    const artifact = makeArtifact({
      projectRoot,
      scope: { kind: "page", pageReason: "full page baseline" },
      ok: true,
      allPassed: false,
      resultPass: false,
    });
    const verdict = doneGateFromArtifact(artifact);
    expect(verdict.done).toBe(false);
  });

  it("marks a single viewport not done when its own result did not pass, without touching artifact-level ok", () => {
    const projectRoot = fs.mkdtempSync(path.join(tmp, "result-not-pass-"));
    const artifact = makeArtifact({
      projectRoot,
      scope: { kind: "page", pageReason: "full page baseline" },
      ok: true,
      allPassed: false,
      resultPass: false,
    });
    const verdict = doneGateFromArtifact(artifact);
    expect(verdict.viewports[0]?.reasons).toContain("verification artifact result is not passing.");
    expect(verdict.viewports[0]?.done).toBe(false);
  });
});
