import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  BINDING_FORMAT_VERSION,
  RUN_CONTEXT_FORMAT_VERSION,
  TEST_REGISTRATION_FORMAT_VERSION,
  type RunContext,
  type TestRegistration,
} from "@framelia/contracts/workflow";
import { casePlansDir, runPlanPath } from "@framelia/verify/run-bundle";
import type { TestInfo } from "@playwright/test";
import { afterEach, describe, expect, it } from "vitest";

import {
  RUN_CONTEXT_ENV,
  assertExecuteCaseReady,
  writeTransportStatus,
} from "../src/run-context.ts";

const roots: string[] = [];
const DIGEST = `sha256:${"a".repeat(64)}` as const;

afterEach(() => {
  delete process.env[RUN_CONTEXT_ENV];
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture(mode: RunContext["mode"]): {
  root: string;
  context: RunContext;
  registration: TestRegistration;
  testInfo: TestInfo;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-run-context-"));
  roots.push(root);
  const transport = path.join(root, "transport");
  fs.mkdirSync(transport, { recursive: true });
  const runId = "execute-guard";
  const context: RunContext = {
    formatVersion: RUN_CONTEXT_FORMAT_VERSION,
    kind: "framelia.run-context",
    mode,
    projectRoot: root,
    runId,
    policyDigest: DIGEST,
    selectedProjects: ["chromium"],
    manifestPath: path.join(transport, "manifest.json"),
    statusPath: path.join(transport, "status.json"),
    ...(mode === "execute"
      ? { planPath: runPlanPath(root, runId), casePlansPath: casePlansDir(root, runId) }
      : {}),
  };
  const contextPath = path.join(transport, "context.json");
  fs.writeFileSync(contextPath, JSON.stringify(context));
  process.env[RUN_CONTEXT_ENV] = contextPath;
  const registration: TestRegistration = {
    formatVersion: TEST_REGISTRATION_FORMAT_VERSION,
    kind: "framelia.test-registration",
    binding: {
      formatVersion: BINDING_FORMAT_VERSION,
      kind: "framelia.contract-binding",
      contractId: "home.visual",
      contractFile: "contracts/home.json",
      contractDigest: DIGEST,
    },
    specFile: "tests/visual.spec.ts",
    specDigest: DIGEST,
  };
  const testInfo = {
    project: {
      name: "chromium",
      testDir: path.join(root, "tests"),
      dependencies: [],
      repeatEach: 1,
      retries: 0,
      use: { viewport: { width: 100, height: 100 }, browserName: "chromium" },
    },
    repeatEachIndex: 0,
    titlePath: ["visual.spec.ts", "case"],
  } as unknown as TestInfo;
  return { root, context, registration, testInfo };
}

describe("assertExecuteCaseReady", () => {
  it("leaves ordinary direct Playwright runs unchanged when no coordinator context exists", () => {
    const { root, registration, testInfo } = fixture("execute");
    delete process.env[RUN_CONTEXT_ENV];
    expect(() => assertExecuteCaseReady(testInfo, registration, root)).not.toThrow();
  });

  it("refuses visual test bodies in collection mode before any test work can start", () => {
    const { root, registration, testInfo } = fixture("collect");
    expect(() => assertExecuteCaseReady(testInfo, registration, root)).toThrow(
      /cannot run in collection mode/,
    );
  });

  it("re-reads execute status on every body entry and never accepts a stale blocked gate", () => {
    const { root, context, registration, testInfo } = fixture("execute");
    writeTransportStatus(context, "blocked", [
      { code: "FRAMELIA_EXECUTION_RECONCILIATION", message: "setup graph changed" },
    ]);

    expect(() => assertExecuteCaseReady(testInfo, registration, root)).toThrow(
      /execute reconciliation is blocked: setup graph changed/,
    );

    writeTransportStatus(context, "ready");
    expect(() => assertExecuteCaseReady(testInfo, registration, root)).toThrow(
      /No frozen run plan|cannot read/i,
    );
  });
});
