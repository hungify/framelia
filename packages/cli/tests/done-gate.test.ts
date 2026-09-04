import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { VerificationArtifact, VerificationContract } from "@framelia/contracts";
import { SCHEMA_VERSION } from "@framelia/contracts";
import { afterAll, describe, expect, it, vi } from "vitest";

import { UsageError } from "../src/exit.ts";
import { doneGateCommand } from "../src/internal/done-gate.ts";
import type { CliRuntime } from "../src/runtime-types.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-cli-done-gate-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function fakeRuntime(overrides: Partial<CliRuntime> = {}): CliRuntime {
  return {
    cwd: () => tmp,
    env: {},
    stdin: process.stdin,
    stdout: { write: vi.fn<(text: string) => void>() },
    stderr: { write: vi.fn<(text: string) => void>() },
    exitCode: undefined,
    ...overrides,
  };
}

const target = { kind: "web" as const, url: "http://localhost:3000/login" };
const figmaBaseline = { kind: "figma" as const, fileKey: "file-key", nodeId: "153:5181" };

function writeFailingArtifact(projectRoot: string): string {
  const id = "contract-1";
  const contract: VerificationContract = {
    id,
    name: id,
    baseline: figmaBaseline,
    viewport: { preset: "desktop", width: 1440, height: 1024 },
    outDir: `.framelia/visual-verifications/${id}`,
    scope: { kind: "page", pageReason: "full page baseline" },
  };
  const artifact: VerificationArtifact = {
    schemaVersion: SCHEMA_VERSION,
    kind: "framelia.visual-verification",
    createdAt: new Date().toISOString(),
    projectRoot,
    request: { schemaVersion: SCHEMA_VERSION, target, contracts: [contract] },
    ok: false,
    allPassed: false,
    results: [{ id, ok: false, pass: false, outDir: contract.outDir }],
  };
  const artifactPath = path.join(projectRoot, "artifact.json");
  fs.writeFileSync(artifactPath, JSON.stringify(artifact));
  return artifactPath;
}

describe("doneGateCommand", () => {
  it("throws a wrapped, readable error for a missing artifact file (raw path in the message)", async () => {
    await expect(
      doneGateCommand(
        {
          artifact: "does-not-exist.json",
          projectRoot: undefined,
          maxScoreAgeMs: undefined,
          maxBaselineAgeMs: undefined,
          maxGoldAgeMs: undefined,
        },
        fakeRuntime(),
      ),
    ).rejects.toThrow(/Cannot read JSON does-not-exist\.json.*ENOENT/s);
  });

  it("throws a UsageError, not a generic Error, when maxScoreAgeMs is not positive", async () => {
    await expect(
      doneGateCommand(
        {
          artifact: "irrelevant.json",
          projectRoot: undefined,
          maxScoreAgeMs: -1,
          maxBaselineAgeMs: undefined,
          maxGoldAgeMs: undefined,
        },
        fakeRuntime(),
      ),
    ).rejects.toBeInstanceOf(UsageError);
  });

  it("resolves the artifact path against the injected runtime cwd and reports done: false when the artifact itself is not ok", async () => {
    const projectRoot = fs.mkdtempSync(path.join(tmp, "project-"));
    const artifactAbsolutePath = writeFailingArtifact(projectRoot);

    const result = await doneGateCommand(
      {
        artifact: "artifact.json",
        projectRoot,
        maxScoreAgeMs: undefined,
        maxBaselineAgeMs: undefined,
        maxGoldAgeMs: undefined,
      },
      fakeRuntime({ cwd: () => projectRoot }),
    );

    expect(result.body.artifactPath).toBe(artifactAbsolutePath);
    expect(result.body.done).toBe(false);
    expect(result.body.schemaVersion).toBe(SCHEMA_VERSION);
  });
});
