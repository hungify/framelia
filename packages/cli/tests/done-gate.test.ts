import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  SIGNED_AUTHORITATIVE_REQUIREMENTS_FORMAT_VERSION,
  type AuthoritativeRunRequirements,
} from "@framelia/contracts/workflow";
import { canonicalJson, type CanonicalJsonValue } from "@framelia/verify";
import { evaluateAuthoritativeRun } from "@framelia/verify/run-bundle";
import { afterEach, describe, expect, it } from "vitest";

import {
  AUTHORITY_AUDIENCE_ENV,
  PROTECTED_JOB_IDENTITY_ENV,
  TRUSTED_REQUIREMENTS_PUBLIC_KEY_ENV,
} from "../src/cli-constants.ts";
import { doneGateCommand } from "../src/internal/done-gate.ts";
import {
  createSelectedRun,
  FIXTURE_AUDIENCE,
  FIXTURE_BUILD_DIGEST,
  FIXTURE_DIGEST,
  FIXTURE_JOB_IDENTITY,
  FIXTURE_SERVED_ORIGIN,
} from "./selected-run-fixture.ts";

function validAuthorityNow(): Date {
  return new Date("2026-09-21T12:02:00.000Z");
}

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function temporaryRoot(prefix = "framelia-authority-"): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(root);
  return root;
}

function runtime(root: string, env: NodeJS.ProcessEnv = {}) {
  return {
    cwd: () => root,
    env,
    stdout: { write: () => true },
    stderr: { write: () => true },
  } as never;
}

function signedRequirements(
  projectRoot: string,
  payload: AuthoritativeRunRequirements,
  options: { keyDirectory?: string } = {},
): { requirements: string; publicKey: string; privateKey: crypto.KeyObject } {
  const keyDirectory = options.keyDirectory ?? temporaryRoot("framelia-trust-root-");
  const pair = crypto.generateKeyPairSync("ed25519");
  const publicKey = path.join(keyDirectory, "authority-public.pem");
  fs.mkdirSync(keyDirectory, { recursive: true });
  fs.writeFileSync(publicKey, pair.publicKey.export({ type: "spki", format: "pem" }));
  const signature = crypto
    .sign(null, Buffer.from(canonicalJson(payload as CanonicalJsonValue)), pair.privateKey)
    .toString("base64url");
  const requirements = path.join(projectRoot, `signed-requirements-${crypto.randomUUID()}.json`);
  fs.writeFileSync(
    requirements,
    JSON.stringify({
      formatVersion: SIGNED_AUTHORITATIVE_REQUIREMENTS_FORMAT_VERSION,
      kind: "framelia.signed-authoritative-run-requirements",
      payload,
      signature,
    }),
  );
  return { requirements, publicKey, privateKey: pair.privateKey };
}

function keyEnv(publicKey: string, overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    [TRUSTED_REQUIREMENTS_PUBLIC_KEY_ENV]: publicKey,
    [PROTECTED_JOB_IDENTITY_ENV]: FIXTURE_JOB_IDENTITY,
    [AUTHORITY_AUDIENCE_ENV]: FIXTURE_AUDIENCE,
    ...overrides,
  };
}

function findRunFile(root: string, suffix: string): string {
  const runs = path.join(root, ".framelia", "runs");
  const relative = fs
    .readdirSync(runs, { recursive: true })
    .map(String)
    .find((entry) => entry.endsWith(suffix));
  if (!relative) throw new Error(`fixture file ending ${suffix} not found`);
  return path.join(runs, relative);
}

function mutateScore(root: string, mutate: (score: Record<string, unknown>) => void): void {
  const scorePath = findRunFile(root, "score.json");
  const score = JSON.parse(fs.readFileSync(scorePath, "utf8")) as Record<string, unknown>;
  mutate(score);
  const bytes = Buffer.from(JSON.stringify(score));
  fs.writeFileSync(scorePath, bytes);
  const attemptPath = findRunFile(root, "attempt.json");
  const attempt = JSON.parse(fs.readFileSync(attemptPath, "utf8")) as {
    evidence: { score: { digest: string } };
  };
  attempt.evidence.score.digest = `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
  fs.writeFileSync(attemptPath, JSON.stringify(attempt));
}

describe("bundle-native authoritative evaluation", () => {
  it("passes a complete reconciled run and preserves served-build provenance", async () => {
    const root = temporaryRoot();
    const fixture = await createSelectedRun(root);
    expect(evaluateAuthoritativeRun(root, "run-selected", fixture.requirements)).toMatchObject({
      exitCode: 0,
      executionState: "completed",
      visualVerdict: "passed",
      servedBuild: { mode: "ci-owned", freshServerOwnedByJob: true },
    });
  });

  it.each([
    [
      "contradictory pass metrics",
      (score: Record<string, unknown>) => {
        score.matchRatio = 0;
      },
    ],
    [
      "unstable capture",
      (score: Record<string, unknown>) => {
        score.stability = "borderline";
      },
    ],
    [
      "short stability evidence",
      (score: Record<string, unknown>) => {
        const capture = score.captureEvidence as { screenshotHashes: string[] };
        capture.screenshotHashes = capture.screenshotHashes.slice(0, 1);
      },
    ],
    [
      "baseline remap",
      (score: Record<string, unknown>) => {
        score.baseline = {
          snapshotDigest: FIXTURE_DIGEST,
          kind: "figma",
          fileKey: "other",
          nodeId: "1:2",
        };
      },
    ],
    [
      "scope remap",
      (score: Record<string, unknown>) => {
        score.scope = { kind: "region", selector: "#other" };
      },
    ],
    [
      "served origin remap",
      (score: Record<string, unknown>) => {
        score.targetUrl = "https://evil.example/login";
      },
    ],
    [
      "captured final origin remap",
      (score: Record<string, unknown>) => {
        const capture = score.captureEvidence as { finalUrl: string };
        capture.finalUrl = "https://evil.example/login";
      },
    ],
    [
      "blocking capture diagnostic",
      (score: Record<string, unknown>) => {
        score.diagnostics = [
          { kind: "warning", code: "READINESS_FAILED", message: "not ready", blocking: true },
        ];
      },
    ],
    [
      "blocking style issue",
      (score: Record<string, unknown>) => {
        score.topIssues = [
          {
            severity: "high",
            kind: "style-color",
            message: "wrong",
            repairCandidate: true,
            blocking: true,
          },
        ];
      },
    ],
  ])("treats %s in a pass score as invalid authority", async (_label, mutate) => {
    const root = temporaryRoot();
    const fixture = await createSelectedRun(root);
    mutateScore(root, mutate);
    const verdict = evaluateAuthoritativeRun(root, "run-selected", fixture.requirements);
    expect(verdict.exitCode).toBe(2);
    expect(verdict.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "attempt-authority-invalid" })]),
    );
  });

  it("rejects a changed third sample even when a producer claims stability", async () => {
    const root = temporaryRoot();
    const fixture = await createSelectedRun(root, {
      stabilitySamples: 3,
      unstableLastSample: true,
    });
    const verdict = evaluateAuthoritativeRun(root, "run-selected", fixture.requirements);
    expect(verdict.exitCode).toBe(2);
    expect(verdict.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "attempt-authority-invalid",
          message: "capture stability does not match the frozen sample count",
        }),
      ]),
    );
  });

  it("does not accept a finalized case whose reconciled selected attempt is absent", async () => {
    const root = temporaryRoot();
    const fixture = await createSelectedRun(root);
    const runPath = findRunFile(root, "run.json");
    const record = JSON.parse(fs.readFileSync(runPath, "utf8"));
    delete record.cases[0].selectedAttemptId;
    fs.writeFileSync(runPath, JSON.stringify(record));
    const verdict = evaluateAuthoritativeRun(root, "run-selected", fixture.requirements);
    expect(verdict.exitCode).toBe(2);
    expect(verdict.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "selected-attempt-missing" })]),
    );
  });

  it("blocks a production-shaped low-severity style mismatch when the frozen style gate is enabled", async () => {
    const root = temporaryRoot();
    const fixture = await createSelectedRun(root, { styleGateEligible: true });
    const verdict = evaluateAuthoritativeRun(root, "run-selected", fixture.requirements);
    expect(verdict.exitCode).toBe(2);
    expect(verdict.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "attempt-authority-invalid",
          message: "score contains a style-gate blocking issue",
        }),
      ]),
    );
  });

  it("binds trusted retry acceptance to the frozen run and case policy", async () => {
    const root = temporaryRoot();
    const fixture = await createSelectedRun(root, { attempts: [false, true] });
    const changed = evaluateAuthoritativeRun(root, "run-selected", {
      ...fixture.requirements,
      retryAcceptance: "allow-passed-after-retry",
    });
    expect(changed.exitCode).toBe(2);
    expect(changed.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "retry-policy-mismatch" })]),
    );
  });

  it("keeps mismatch history when lost evidence makes authority incomplete", async () => {
    const root = temporaryRoot();
    const fixture = await createSelectedRun(root, { runId: "run-lost", attempts: [false] });
    fs.rmSync(findRunFile(root, "expected.png"));
    const verdict = evaluateAuthoritativeRun(root, "run-lost", fixture.requirements);
    expect(verdict).toMatchObject({ exitCode: 2, visualVerdict: "mismatched" });
    expect(verdict.cases[0]?.attempts[0]).toMatchObject({ visualVerdict: "mismatched" });
    expect(verdict.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "evidence-missing" })]),
    );
  });

  it("accepts complete deployment-attested provenance only when its observed digest matches", async () => {
    const root = temporaryRoot();
    const fixture = await createSelectedRun(root);
    const valid = {
      ...fixture.requirements,
      servedBuild: {
        mode: "deployment-attested" as const,
        attestation: {
          observedBuildDigest: FIXTURE_BUILD_DIGEST,
          observedOrigin: FIXTURE_SERVED_ORIGIN,
          issuer: "deployment-control-plane",
          subject: "production/login",
          proofDigest: FIXTURE_DIGEST,
          verifiedBy: "protected-deployment-verifier",
        },
      },
    };
    expect(evaluateAuthoritativeRun(root, "run-selected", valid)).toMatchObject({ exitCode: 0 });
    expect(
      evaluateAuthoritativeRun(root, "run-selected", {
        ...valid,
        servedBuild: {
          ...valid.servedBuild,
          attestation: {
            ...valid.servedBuild.attestation,
            observedBuildDigest: `sha256:${"e".repeat(64)}`,
          },
        },
      }),
    ).toMatchObject({ exitCode: 2 });
  });
});

describe("signed done-gate authority boundary", () => {
  it.each(["ci-owned", "deployment-attested"] as const)(
    "verifies a protected Ed25519-signed %s assertion",
    async (mode) => {
      const root = temporaryRoot();
      const fixture = await createSelectedRun(root);
      const payload: AuthoritativeRunRequirements =
        mode === "ci-owned"
          ? fixture.requirements
          : {
              ...fixture.requirements,
              servedBuild: {
                mode,
                attestation: {
                  observedBuildDigest: FIXTURE_BUILD_DIGEST,
                  observedOrigin: FIXTURE_SERVED_ORIGIN,
                  issuer: "deployment-control-plane",
                  subject: "production/login",
                  proofDigest: FIXTURE_DIGEST,
                  verifiedBy: "protected-deployment-verifier",
                },
              },
            };
      const signed = signedRequirements(root, payload);
      const result = await doneGateCommand(
        {
          artifact: undefined,
          run: "run-selected",
          requirements: signed.requirements,
          projectRoot: root,
        },
        runtime(root, keyEnv(signed.publicKey)),
      );
      expect(result.exitCode).toBe(0);
      expect(result.body).toMatchObject({
        exitCode: 0,
        requirements: {
          role: "protected-signed-envelope",
          runId: payload.runId,
          issuedAt: payload.issuedAt,
          expiresAt: payload.expiresAt,
          jobIdentity: FIXTURE_JOB_IDENTITY,
          audience: FIXTURE_AUDIENCE,
        },
        authority: {
          runId: payload.runId,
          jobIdentity: FIXTURE_JOB_IDENTITY,
          audience: FIXTURE_AUDIENCE,
        },
        verifier: {
          algorithm: "Ed25519",
          trustRoot: "external-to-project",
          keyFingerprint: expect.stringMatching(/^sha256:/),
        },
      });
      const output = JSON.stringify(result);
      expect(output).not.toContain(root);
      expect(output).not.toContain(signed.requirements);
      expect(output).not.toContain(signed.publicKey);
    },
  );

  it("binds signed requirements to run, validity window, protected job, and audience", async () => {
    const root = temporaryRoot();
    const fixture = await createSelectedRun(root, {
      issuedAt: "2026-09-21T12:00:00.000Z",
      expiresAt: "2026-09-21T12:05:00.000Z",
    });
    const signed = signedRequirements(root, fixture.requirements);
    const options = {
      artifact: undefined,
      run: "run-selected",
      requirements: signed.requirements,
      projectRoot: root,
    };

    const anotherRun = signedRequirements(root, {
      ...fixture.requirements,
      runId: "run-other",
    });
    await expect(
      doneGateCommand(
        { ...options, requirements: anotherRun.requirements },
        runtime(root, keyEnv(anotherRun.publicKey)),
        validAuthorityNow,
      ),
    ).resolves.toMatchObject({
      exitCode: 2,
      body: { issues: [{ code: "SIGNED_REQUIREMENTS_RUN_MISMATCH" }] },
    });
    await expect(
      doneGateCommand(
        options,
        runtime(root, keyEnv(signed.publicKey)),
        () => new Date("2026-09-21T11:59:59.000Z"),
      ),
    ).resolves.toMatchObject({
      exitCode: 2,
      body: { issues: [{ code: "SIGNED_REQUIREMENTS_NOT_YET_VALID" }] },
    });
    const longWindow = signedRequirements(root, {
      ...fixture.requirements,
      expiresAt: "2026-09-21T12:20:00.000Z",
    });
    await expect(
      doneGateCommand(
        { ...options, requirements: longWindow.requirements },
        runtime(root, keyEnv(longWindow.publicKey)),
        validAuthorityNow,
      ),
    ).resolves.toMatchObject({
      exitCode: 2,
      body: { issues: [{ code: "SIGNED_REQUIREMENTS_WINDOW_TOO_LARGE" }] },
    });
    await expect(
      doneGateCommand(
        options,
        runtime(root, keyEnv(signed.publicKey)),
        () => new Date("2026-09-21T12:05:00.000Z"),
      ),
    ).resolves.toMatchObject({
      exitCode: 2,
      body: { issues: [{ code: "SIGNED_REQUIREMENTS_EXPIRED" }] },
    });
    await expect(
      doneGateCommand(
        options,
        runtime(root, keyEnv(signed.publicKey, { [PROTECTED_JOB_IDENTITY_ENV]: "other-job" })),
        validAuthorityNow,
      ),
    ).resolves.toMatchObject({
      exitCode: 2,
      body: { issues: [{ code: "PROTECTED_JOB_IDENTITY_MISMATCH" }] },
    });
    await expect(
      doneGateCommand(
        options,
        runtime(root, keyEnv(signed.publicKey, { [AUTHORITY_AUDIENCE_ENV]: "other-audience" })),
        validAuthorityNow,
      ),
    ).resolves.toMatchObject({
      exitCode: 2,
      body: { issues: [{ code: "PROTECTED_AUTHORITY_AUDIENCE_MISMATCH" }] },
    });
  });

  it("rejects a payload modified after signing", async () => {
    const root = temporaryRoot();
    const fixture = await createSelectedRun(root);
    const signed = signedRequirements(root, fixture.requirements);
    const envelope = JSON.parse(fs.readFileSync(signed.requirements, "utf8"));
    envelope.payload.policyDigest = `sha256:${"d".repeat(64)}`;
    fs.writeFileSync(signed.requirements, JSON.stringify(envelope));
    const result = await doneGateCommand(
      {
        artifact: undefined,
        run: "run-selected",
        requirements: signed.requirements,
        projectRoot: root,
      },
      runtime(root, keyEnv(signed.publicKey)),
    );
    expect(result).toMatchObject({
      exitCode: 2,
      body: { issues: [{ code: "SIGNED_REQUIREMENTS_SIGNATURE_INVALID" }] },
    });
  });

  it("rejects an unsigned payload, an untrusted key, and a public key inside the checkout", async () => {
    const root = temporaryRoot();
    const fixture = await createSelectedRun(root);
    const unsigned = path.join(root, "unsigned.json");
    fs.writeFileSync(unsigned, JSON.stringify(fixture.requirements));
    const trusted = signedRequirements(root, fixture.requirements);
    const unsignedResult = await doneGateCommand(
      { artifact: undefined, run: "run-selected", requirements: unsigned, projectRoot: root },
      runtime(root, keyEnv(trusted.publicKey)),
    );
    expect(unsignedResult).toMatchObject({
      exitCode: 2,
      body: { issues: [{ code: "SIGNED_REQUIREMENTS_INVALID" }] },
    });

    const wrong = signedRequirements(root, fixture.requirements);
    const wrongKeyResult = await doneGateCommand(
      {
        artifact: undefined,
        run: "run-selected",
        requirements: trusted.requirements,
        projectRoot: root,
      },
      runtime(root, keyEnv(wrong.publicKey)),
    );
    expect(wrongKeyResult).toMatchObject({
      exitCode: 2,
      body: { issues: [{ code: "SIGNED_REQUIREMENTS_SIGNATURE_INVALID" }] },
    });

    const inside = signedRequirements(root, fixture.requirements, { keyDirectory: root });
    const insideResult = await doneGateCommand(
      {
        artifact: undefined,
        run: "run-selected",
        requirements: inside.requirements,
        projectRoot: root,
      },
      runtime(root, keyEnv(inside.publicKey)),
    );
    expect(insideResult).toMatchObject({
      exitCode: 2,
      body: { issues: [{ code: "TRUST_ROOT_INSIDE_PROJECT" }] },
    });
  });

  it("returns structured exit 2 for missing trust root and structural partial publication", async () => {
    const root = temporaryRoot();
    const fixture = await createSelectedRun(root);
    const signed = signedRequirements(root, fixture.requirements);
    const missingKey = await doneGateCommand(
      {
        artifact: undefined,
        run: "run-selected",
        requirements: signed.requirements,
        projectRoot: root,
      },
      runtime(root),
    );
    expect(missingKey).toMatchObject({
      exitCode: 2,
      body: { issues: [{ code: "TRUST_ROOT_MISSING" }] },
    });

    const attemptsDirectory = path.dirname(path.dirname(findRunFile(root, "attempt.json")));
    fs.mkdirSync(path.join(attemptsDirectory, "partial-attempt"));
    const partial = await doneGateCommand(
      {
        artifact: undefined,
        run: "run-selected",
        requirements: signed.requirements,
        projectRoot: root,
      },
      runtime(root, keyEnv(signed.publicKey)),
    );
    expect(partial).toMatchObject({
      exitCode: 2,
      body: {
        issues: expect.arrayContaining([
          expect.objectContaining({ code: "attempt-publication-partial" }),
        ]),
      },
    });
  });
  it("retains an unaffected mismatch when another selected attempt record is malformed", async () => {
    const root = temporaryRoot();
    const fixture = await createSelectedRun(root, {
      attempts: [false],
      secondCase: { pass: true },
    });
    const secondCaseId = fixture.plan.selectedCases[1]!.caseId;
    const attempts = path.join(root, ".framelia", "runs");
    const secondAttemptFile = fs
      .readdirSync(attempts, { recursive: true })
      .map(String)
      .filter((entry) => entry.endsWith("attempt.json"))
      .map((entry) => path.join(attempts, entry))
      .find((attemptFile) => {
        const record = JSON.parse(fs.readFileSync(attemptFile, "utf8")) as { caseId?: unknown };
        return record.caseId === secondCaseId;
      });
    if (!secondAttemptFile) throw new Error(`attempt for ${secondCaseId} not found`);
    fs.writeFileSync(secondAttemptFile, "{");

    const signed = signedRequirements(root, fixture.requirements);
    const result = await doneGateCommand(
      {
        artifact: undefined,
        run: "run-selected",
        requirements: signed.requirements,
        projectRoot: root,
      },
      runtime(root, keyEnv(signed.publicKey)),
    );

    expect(result).toMatchObject({
      exitCode: 2,
      body: {
        visualVerdict: "mismatched",
        issues: expect.arrayContaining([
          expect.objectContaining({ code: "visual-mismatch" }),
          expect.objectContaining({ code: "attempt-record-invalid" }),
        ]),
      },
    });
  });

  it("returns structured legacy rejection and rerun guidance", async () => {
    const root = temporaryRoot();
    const artifact = path.join(root, "visual-verification.json");
    fs.writeFileSync(artifact, JSON.stringify({ kind: "framelia.visual-verification" }));
    const result = await doneGateCommand(
      { artifact, run: undefined, requirements: undefined, projectRoot: root },
      runtime(root),
    );
    expect(result).toMatchObject({
      exitCode: 2,
      body: {
        issues: [{ code: "LEGACY_ARTIFACT_UNSUPPORTED" }],
        next: { command: "pnpm", argv: ["exec", "playwright", "test"] },
      },
    });
  });
});
