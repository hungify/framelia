import { describe, expect, it } from "vitest";

import {
  attemptRecordSchema,
  authoritativeRunRequirementsSchema,
  authoredContractSchema,
  baselineSnapshotSchema,
  collectionManifestSchema,
  commandOutcomeSchema,
  contractBindingSchema,
  runPlanSchema,
  runRecordSchema,
  runContextSchema,
  transportStatusSchema,
  testRegistrationSchema,
} from "../src/workflow-records.ts";

const A_DIGEST = `sha256:${"a".repeat(64)}`;
const B_DIGEST = `sha256:${"b".repeat(64)}`;

function contract(overrides: Record<string, unknown> = {}) {
  return {
    formatVersion: 1,
    kind: "framelia.contract",
    id: "login.desktop",
    name: "Login desktop",
    revision: 1,
    target: { path: "/login?mode=visual" },
    viewport: { preset: "desktop", width: 1196, height: 796 },
    scope: { kind: "page", pageReason: "The complete login state is reviewed." },
    baseline: { snapshotDigest: A_DIGEST },
    ...overrides,
  };
}

describe("authored contract records", () => {
  it("preserves authored identity and CSS viewport without an output directory", () => {
    const parsed = authoredContractSchema.parse(contract());

    expect(parsed).toMatchObject({
      id: "login.desktop",
      name: "Login desktop",
      target: { path: "/login?mode=visual" },
      viewport: { preset: "desktop", width: 1196, height: 796 },
      required: true,
    });
    expect(
      authoredContractSchema.safeParse(contract({ outDir: ".framelia/results" })).success,
    ).toBe(false);
  });

  it("rejects duplicate project names while accepting the unnamed Playwright project", () => {
    expect(authoredContractSchema.safeParse(contract({ projects: [""] })).success).toBe(true);
    expect(
      authoredContractSchema.safeParse(contract({ projects: ["chromium", "chromium"] })).success,
    ).toBe(false);
  });
});

describe("project-relative paths", () => {
  const binding = {
    formatVersion: 1,
    kind: "framelia.contract-binding",
    contractId: "login.desktop",
    contractFile: ".framelia/contracts/login.json",
    contractDigest: A_DIGEST,
  };

  it("accepts an ordinary project-relative path", () => {
    expect(contractBindingSchema.safeParse(binding).success).toBe(true);
  });

  it("rejects a POSIX-absolute path and a parent-traversal path", () => {
    expect(
      contractBindingSchema.safeParse({ ...binding, contractFile: "/etc/passwd" }).success,
    ).toBe(false);
    expect(
      contractBindingSchema.safeParse({ ...binding, contractFile: "../outside.json" }).success,
    ).toBe(false);
  });

  it("rejects a Windows drive-absolute path and a drive-relative path without a separator", () => {
    // "C:\\foo" is drive-absolute; "C:foo" (no separator after the drive letter) is
    // drive-relative -- it resolves against that drive's own current directory, which
    // could point anywhere, not necessarily inside the project root.
    expect(
      contractBindingSchema.safeParse({ ...binding, contractFile: "C:\\Windows\\login.json" })
        .success,
    ).toBe(false);
    expect(
      contractBindingSchema.safeParse({ ...binding, contractFile: "C:login.json" }).success,
    ).toBe(false);
  });
});

describe("testRegistrationSchema (the framelia.contract annotation payload)", () => {
  const binding = {
    formatVersion: 1,
    kind: "framelia.contract-binding",
    contractId: "login.desktop",
    contractFile: ".framelia/contracts/login.json",
    contractDigest: A_DIGEST,
  };
  const registration = {
    formatVersion: 1,
    kind: "framelia.test-registration",
    binding,
    specFile: "login.spec.ts",
    specDigest: B_DIGEST,
  };

  it("accepts a binding plus a registration-time spec digest", () => {
    expect(testRegistrationSchema.safeParse(registration).success).toBe(true);
  });

  it("keeps specDigest independent of the nested binding's own contractDigest", () => {
    const parsed = testRegistrationSchema.parse(registration);
    expect(parsed.specDigest).toBe(B_DIGEST);
    expect(parsed.binding.contractDigest).toBe(A_DIGEST);
  });

  it("rejects a malformed specDigest", () => {
    expect(
      testRegistrationSchema.safeParse({ ...registration, specDigest: "not-a-digest" }).success,
    ).toBe(false);
  });

  it("rejects a POSIX-absolute specFile", () => {
    expect(
      testRegistrationSchema.safeParse({ ...registration, specFile: "/etc/passwd" }).success,
    ).toBe(false);
  });

  it("rejects an invalid nested binding", () => {
    expect(
      testRegistrationSchema.safeParse({
        ...registration,
        binding: { ...binding, contractFile: "/etc/passwd" },
      }).success,
    ).toBe(false);
  });

  it("rejects an unknown top-level field", () => {
    expect(testRegistrationSchema.safeParse({ ...registration, extra: "unexpected" }).success).toBe(
      false,
    );
  });
});

describe("snapshot and execution units", () => {
  it("keeps CSS viewport and screenshot pixels distinct", () => {
    const snapshot = {
      formatVersion: 1,
      kind: "framelia.baseline-snapshot",
      source: { kind: "figma", fileKey: "file", nodeId: "1:2" },
      rendering: {
        viewport: { preset: "custom", width: 600, height: 400 },
        deviceScaleFactor: 2,
      },
      expected: {
        kind: "page",
        image: {
          path: "expected.png",
          digest: A_DIGEST,
          width: 1200,
          height: 800,
        },
      },
    };

    expect(baselineSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(
      baselineSnapshotSchema.safeParse({
        ...snapshot,
        expected: { image: { ...snapshot.expected.image, width: 600 } },
      }).success,
    ).toBe(false);
  });

  it("accepts a region snapshot image sized to its element, not the viewport", () => {
    // A region capture is bounded by whatever element the contract's own selector
    // resolves to, unrelated to the viewport -- unlike a page snapshot, its expected
    // image is never required to equal viewport × deviceScaleFactor.
    const regionSnapshot = {
      formatVersion: 1,
      kind: "framelia.baseline-snapshot",
      source: { kind: "figma", fileKey: "file", nodeId: "1:2" },
      rendering: {
        viewport: { preset: "desktop", width: 1200, height: 800 },
        deviceScaleFactor: 1,
      },
      expected: {
        kind: "region",
        image: { path: "card.png", digest: A_DIGEST, width: 240, height: 96 },
      },
    };

    expect(baselineSnapshotSchema.safeParse(regionSnapshot).success).toBe(true);
  });

  it("keeps collection transport versioned while leaving selected-binding policy to the parent", () => {
    const collected = {
      formatVersion: 1,
      kind: "framelia.collected-case",
      binding: {
        formatVersion: 1,
        kind: "framelia.contract-binding",
        contractId: "login.desktop",
        contractFile: ".framelia/contracts/login.json",
        contractDigest: A_DIGEST,
      },
      project: "chromium",
      projectRuntimeDigest: A_DIGEST,
      specFile: "tests/e2e/login.spec.ts",
      testListFile: "e2e/login.spec.ts",
      specFileDigest: B_DIGEST,
      location: { line: 20, column: 4 },
      testTitlePath: ["login", "desktop"],
      repeatIndex: 0,
    };
    const manifest = {
      formatVersion: 2,
      kind: "framelia.collection",
      runId: "run-1",
      projectRoot: "/project",
      policyDigest: A_DIGEST,
      projects: [
        {
          name: "chromium",
          runtimeDigest: A_DIGEST,
          dependencies: ["setup"],
          teardown: "teardown",
          repeatEach: 1,
          retries: 2,
          testDir: "tests",
        },
      ],
      visualCases: [collected, { ...collected, testTitlePath: ["login", "duplicate"] }],
      setupCases: [],
    };

    expect(collectionManifestSchema.safeParse(manifest).success).toBe(true);
    expect(collectionManifestSchema.safeParse({ ...manifest, formatVersion: 1 }).success).toBe(
      false,
    );
  });

  it("preserves nonblank title bytes in collected identity instead of normalizing them", () => {
    const parsed = collectionManifestSchema.parse({
      formatVersion: 2,
      kind: "framelia.collection",
      runId: "run-title-bytes",
      projectRoot: "/project",
      policyDigest: A_DIGEST,
      projects: [
        {
          name: "",
          runtimeDigest: A_DIGEST,
          dependencies: [],
          repeatEach: 1,
          retries: 0,
          testDir: "tests",
        },
      ],
      visualCases: [
        {
          formatVersion: 1,
          kind: "framelia.collected-case",
          binding: {
            formatVersion: 1,
            kind: "framelia.contract-binding",
            contractId: "login.desktop",
            contractFile: "contracts/login.json",
            contractDigest: A_DIGEST,
          },
          project: "",
          projectRuntimeDigest: A_DIGEST,
          specFile: "tests/login.spec.ts",
          testListFile: "login.spec.ts",
          specFileDigest: B_DIGEST,
          location: { line: 1, column: 0 },
          testTitlePath: [" Group ", "  Case  "],
          repeatIndex: 0,
        },
      ],
      setupCases: [],
    });

    expect(parsed.visualCases[0]?.testTitlePath).toEqual([" Group ", "  Case  "]);
  });

  it("distinguishes synchronous execute readiness from the completed lifecycle summary", () => {
    const base = {
      formatVersion: 1,
      kind: "framelia.transport-status",
      writerVersion: "@framelia/playwright@test",
      phase: "execution-reconciliation",
      mode: "execute",
      projectRoot: "/project",
      runId: "run-transport",
      diagnostics: [],
    };
    expect(transportStatusSchema.safeParse({ ...base, state: "ready" }).success).toBe(true);
    expect(transportStatusSchema.safeParse({ ...base, state: "completed" }).success).toBe(false);
    expect(
      transportStatusSchema.safeParse({
        ...base,
        state: "completed",
        execution: {
          resultStatus: "failed",
          setupFailures: ["unnamed setup"],
          teardownFailures: [],
          globalErrors: [],
        },
      }).success,
    ).toBe(true);
  });

  it("requires frozen plan paths only for execute contexts", () => {
    const base = {
      formatVersion: 1,
      kind: "framelia.run-context",
      projectRoot: "/project",
      runId: "run-context",
      policyDigest: A_DIGEST,
      selectedProjects: [""],
      manifestPath: "/private/manifest.json",
      statusPath: "/private/status.json",
    };
    expect(runContextSchema.safeParse({ ...base, mode: "collect" }).success).toBe(true);
    expect(runContextSchema.safeParse({ ...base, mode: "execute" }).success).toBe(false);
    expect(
      runContextSchema.safeParse({
        ...base,
        mode: "execute",
        planPath: "/project/.framelia/runs/run-context/plan/plan.json",
        casePlansPath: "/project/.framelia/runs/run-context/plan/case-plans",
      }).success,
    ).toBe(true);
  });

  it("does not let an all run omit a required case or change its digest", () => {
    const requiredCases = [
      { caseId: "login.desktop/chromium/0", casePlanDigest: A_DIGEST },
      { caseId: "login.mobile/chromium/0", casePlanDigest: B_DIGEST },
    ];
    const matrix = [
      {
        contractId: "login.desktop",
        contractFile: "contracts/login.desktop.json",
        contractDigest: A_DIGEST,
        project: "chromium",
        required: true,
      },
      {
        contractId: "login.mobile",
        contractFile: "contracts/login.mobile.json",
        contractDigest: B_DIGEST,
        project: "chromium",
        required: true,
      },
    ];
    const plan = {
      formatVersion: 2,
      kind: "framelia.run-plan",
      runId: "run-1",
      policyDigest: A_DIGEST,
      executionGraphDigest: A_DIGEST,
      retryAcceptance: "require-first-attempt",
      selection: { mode: "all", contracts: ["login.desktop", "login.mobile"] },
      availableMatrix: matrix,
      requiredMatrix: matrix,
      availableCases: requiredCases,
      requiredCases,
      selectedCases: requiredCases.slice(0, 1),
    };

    expect(runPlanSchema.safeParse(plan).success).toBe(false);
    expect(runPlanSchema.safeParse({ ...plan, selectedCases: requiredCases }).success).toBe(true);
  });

  it("finalizes only with explicit time and an attempt belonging to each case", () => {
    const run = {
      formatVersion: 2,
      kind: "framelia.run",
      runId: "run-1",
      planDigest: A_DIGEST,
      status: "finalized",
      createdAt: "2026-09-14T12:00:00.000Z",
      diagnostics: [],
      cases: [
        {
          caseId: "login.desktop/chromium/0",
          attemptIds: ["attempt-1"],
          selectedAttemptId: "attempt-2",
        },
      ],
    };

    expect(runRecordSchema.safeParse(run).success).toBe(false);
    expect(
      runRecordSchema.safeParse({
        ...run,
        finalizedAt: "2026-09-14T12:00:01.000Z",
        cases: [{ ...run.cases[0], selectedAttemptId: "attempt-1" }],
      }).success,
    ).toBe(true);
  });

  it("keeps execution state separate from visual verdict and enforces exit precedence", () => {
    const blockedMismatch = {
      formatVersion: 1,
      kind: "framelia.command-outcome",
      command: "check",
      executionState: "blocked",
      visualVerdict: "mismatched",
      exitCode: 2,
      diagnostics: [{ code: "BASELINE_MISSING", stage: "preflight", message: "Missing snapshot" }],
    };
    expect(commandOutcomeSchema.safeParse(blockedMismatch).success).toBe(true);
    expect(commandOutcomeSchema.safeParse({ ...blockedMismatch, exitCode: 1 }).success).toBe(false);

    const attempt = attemptRecordSchema.parse({
      formatVersion: 2,
      kind: "framelia.attempt",
      attemptId: "attempt-2",
      runId: "run-1",
      caseId: "login.desktop/chromium/0",
      casePlanDigest: A_DIGEST,
      retryIndex: 1,
      executionState: "completed",
      visualVerdict: "passed",
      startedAt: "2026-09-14T12:00:00.000Z",
      completedAt: "2026-09-14T12:00:01.000Z",
      diagnostics: [],
      evidence: {},
    });
    expect(attempt.retryIndex).toBe(1);
  });
});

describe("authoritative run requirements", () => {
  const requirements = {
    formatVersion: 2,
    kind: "framelia.authoritative-run-requirements",
    runId: "run-authoritative",
    issuedAt: "2026-09-21T00:00:00.000Z",
    expiresAt: "2026-09-21T00:05:00.000Z",
    jobIdentity: "protected-job",
    audience: "framelia-done-gate",
    requiredCases: [
      {
        caseId: "login.desktop@chromium#0",
        contractId: "login.desktop",
        projectName: "chromium",
        repeatIndex: 0,
        casePlanDigest: A_DIGEST,
        contractDigest: A_DIGEST,
        bindingDigest: B_DIGEST,
        specFile: "login.spec.ts",
        specFileDigest: B_DIGEST,
        titlePath: ["chromium", "login"],
      },
    ],
    policyDigest: A_DIGEST,
    source: { sourceDigest: A_DIGEST, buildDigest: B_DIGEST, dirty: false },
    servedBuild: {
      mode: "ci-owned",
      observedBuildDigest: B_DIGEST,
      observedOrigin: "https://preview.example.test",
      freshServerOwnedByJob: true,
    },
    retryAcceptance: "require-first-attempt",
  };

  it("requires a normalized HTTP(S) origin and an ordered validity window", () => {
    expect(authoritativeRunRequirementsSchema.safeParse(requirements).success).toBe(true);
    expect(
      authoritativeRunRequirementsSchema.safeParse({ ...requirements, formatVersion: 1 }).success,
    ).toBe(false);
    for (const observedOrigin of [
      "https://preview.example.test/path",
      "https://user:secret@preview.example.test",
      "file:///tmp/build",
    ]) {
      expect(
        authoritativeRunRequirementsSchema.safeParse({
          ...requirements,
          servedBuild: { ...requirements.servedBuild, observedOrigin },
        }).success,
      ).toBe(false);
    }
    expect(
      authoritativeRunRequirementsSchema.safeParse({
        ...requirements,
        expiresAt: requirements.issuedAt,
      }).success,
    ).toBe(false);
  });
});
