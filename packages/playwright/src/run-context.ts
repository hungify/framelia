import * as fs from "node:fs";
import * as path from "node:path";

import {
  casePlanSchema,
  collectionManifestSchema,
  runContextSchema,
  transportStatusSchema,
  TRANSPORT_STATUS_FORMAT_VERSION,
  type CollectionManifest,
  type RunContext,
  type TestRegistration,
  type TransportStatus,
} from "@framelia/contracts/workflow";
import { canonicalJsonDigest } from "@framelia/verify";
import { fileHash } from "@framelia/verify/project-policy";
import {
  casePlanPath,
  casePlansDir,
  computeCaseId,
  computeExecutionGraphDigest,
  readRunPlan,
  runPlanPath,
} from "@framelia/verify/run-bundle";
import type { TestInfo } from "@playwright/test";

import { computeProjectRuntimeDigest } from "./collection.ts";

export const RUN_CONTEXT_ENV = "FRAMELIA_RUN_CONTEXT";
const WRITER_VERSION = "@framelia/playwright@0.0.5";

function readJson(filePath: string, label: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`framelia reporter: cannot read ${label} at ${filePath}.`, { cause: error });
  }
}

function assertContextPaths(contextPath: string, context: RunContext): void {
  if (path.resolve(context.projectRoot) !== context.projectRoot) {
    throw new Error("framelia reporter: run context projectRoot is not normalized.");
  }
  const transportDir = path.dirname(contextPath);
  for (const [label, filePath] of [
    ["manifestPath", context.manifestPath],
    ["statusPath", context.statusPath],
  ] as const) {
    if (path.dirname(filePath) !== transportDir) {
      throw new Error(`framelia reporter: run context ${label} must share its private directory.`);
    }
  }
  if (context.mode === "execute") {
    if (context.planPath !== runPlanPath(context.projectRoot, context.runId)) {
      throw new Error(
        "framelia reporter: execute context planPath does not match root/run identity.",
      );
    }
    if (context.casePlansPath !== casePlansDir(context.projectRoot, context.runId)) {
      throw new Error(
        "framelia reporter: execute context casePlansPath does not match root/run identity.",
      );
    }
  }
}

export function readRunContext(env: NodeJS.ProcessEnv = process.env): RunContext | undefined {
  const contextPath = env[RUN_CONTEXT_ENV];
  if (contextPath === undefined) return undefined;
  if (!path.isAbsolute(contextPath)) {
    throw new Error(`framelia reporter: ${RUN_CONTEXT_ENV} must name an absolute context file.`);
  }
  const parsed = runContextSchema.safeParse(readJson(contextPath, "run context"));
  if (!parsed.success) {
    throw new Error(`framelia reporter: incompatible run context: ${parsed.error.message}`);
  }
  assertContextPaths(contextPath, parsed.data);
  return parsed.data;
}

function writeAtomic0600(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.dirname(filePath), 0o700);
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
  fs.chmodSync(filePath, 0o600);
}

export function writeCollectionManifest(context: RunContext, manifest: CollectionManifest): void {
  const validated = collectionManifestSchema.parse(manifest);
  if (
    validated.runId !== context.runId ||
    validated.projectRoot !== context.projectRoot ||
    validated.policyDigest !== context.policyDigest
  ) {
    throw new Error("framelia reporter: collection manifest identity does not match run context.");
  }
  writeAtomic0600(context.manifestPath, validated);
}

export function writeTransportStatus(
  context: RunContext,
  state: TransportStatus["state"],
  diagnostics: TransportStatus["diagnostics"] = [],
  execution?: TransportStatus["execution"],
): void {
  const status = transportStatusSchema.parse({
    formatVersion: TRANSPORT_STATUS_FORMAT_VERSION,
    kind: "framelia.transport-status",
    writerVersion: WRITER_VERSION,
    phase: context.mode === "collect" ? "collection" : "execution-reconciliation",
    mode: context.mode,
    projectRoot: context.projectRoot,
    runId: context.runId,
    state,
    diagnostics,
    ...(execution ? { execution } : {}),
  });
  writeAtomic0600(context.statusPath, status);
}

export function readTransportStatus(context: RunContext): TransportStatus {
  const parsed = transportStatusSchema.safeParse(readJson(context.statusPath, "transport status"));
  if (!parsed.success) {
    throw new Error(`framelia reporter: incompatible transport status: ${parsed.error.message}`);
  }
  const status = parsed.data;
  if (
    status.mode !== context.mode ||
    status.projectRoot !== context.projectRoot ||
    status.runId !== context.runId ||
    status.phase !== (context.mode === "collect" ? "collection" : "execution-reconciliation")
  ) {
    throw new Error("framelia reporter: transport status identity does not match run context.");
  }
  return status;
}

export function readCollectionManifest(context: RunContext): CollectionManifest {
  const parsed = collectionManifestSchema.safeParse(
    readJson(context.manifestPath, "collection manifest"),
  );
  if (!parsed.success) {
    throw new Error(`framelia reporter: incompatible collection manifest: ${parsed.error.message}`);
  }
  if (
    parsed.data.runId !== context.runId ||
    parsed.data.projectRoot !== context.projectRoot ||
    parsed.data.policyDigest !== context.policyDigest
  ) {
    throw new Error("framelia reporter: collection manifest identity does not match run context.");
  }
  return parsed.data;
}

/**
 * Execute-mode guard called at the first line of every registered visual body. It refuses to let
 * preparation or capture start until reporter reconciliation publishes a matching ready status.
 */
export function assertExecuteCaseReady(
  testInfo: TestInfo,
  registration: TestRegistration,
  projectRoot: string,
): void {
  const context = readRunContext();
  if (!context) return;
  if (context.mode !== "execute") {
    throw new Error("defineFigmaTests: a visual test body cannot run in collection mode.");
  }
  if (context.projectRoot !== projectRoot) {
    throw new Error("defineFigmaTests: run context project root does not match registration root.");
  }
  const status = readTransportStatus(context);
  if (status.state !== "ready") {
    throw new Error(
      `defineFigmaTests: execute reconciliation is blocked: ${status.diagnostics.map((item) => item.message).join("; ") || "unknown transport error"}.`,
    );
  }

  const runPlan = readRunPlan(projectRoot, context.runId);
  const caseId = computeCaseId({
    contractId: registration.binding.contractId,
    projectName: testInfo.project.name,
    repeatIndex: testInfo.repeatEachIndex,
  });
  const selected = runPlan.selectedCases.find((entry) => entry.caseId === caseId);
  if (!selected) {
    throw new Error(`defineFigmaTests: case ${caseId} is not in the frozen selected plan.`);
  }
  const result = casePlanSchema.safeParse(
    readJson(casePlanPath(projectRoot, context.runId, caseId), `case plan ${caseId}`),
  );
  if (!result.success) {
    throw new Error(
      `defineFigmaTests: incompatible frozen case plan for ${caseId}: ${result.error.message}`,
    );
  }
  const casePlan = result.data;
  const testListFile = testInfo.titlePath[0];
  const absoluteSpec = testListFile
    ? path.resolve(testInfo.project.testDir, testListFile)
    : undefined;
  const liveSpecFile = absoluteSpec
    ? path.relative(projectRoot, absoluteSpec).split(path.sep).join("/")
    : undefined;
  const liveSpecDigest = absoluteSpec ? fileHash(absoluteSpec) : undefined;
  let testTitlePath = [...testInfo.titlePath];
  if (testTitlePath[0] === testInfo.project.name) testTitlePath = testTitlePath.slice(1);
  if (testTitlePath[0] === testListFile) testTitlePath = testTitlePath.slice(1);
  const runtimeDigest = computeProjectRuntimeDigest(testInfo.project);
  if (
    canonicalJsonDigest(casePlan) !== selected.casePlanDigest ||
    casePlan.binding.contractDigest !== registration.binding.contractDigest ||
    casePlan.binding.contractFile !== registration.binding.contractFile ||
    casePlan.specFile !== registration.specFile ||
    casePlan.specFile !== liveSpecFile ||
    casePlan.specFileDigest !== registration.specDigest ||
    liveSpecDigest !== casePlan.specFileDigest ||
    casePlan.project.runtimeDigest !== runtimeDigest ||
    JSON.stringify(casePlan.registration.titlePath) !== JSON.stringify(testTitlePath)
  ) {
    throw new Error(
      `defineFigmaTests: case ${caseId} no longer matches its frozen binding/spec/title/project identity.`,
    );
  }

  const executeManifest = readCollectionManifest(context);
  for (const setupCase of executeManifest.setupCases) {
    if (fileHash(path.resolve(projectRoot, setupCase.specFile)) !== setupCase.specFileDigest) {
      throw new Error(
        `defineFigmaTests: ${setupCase.graphRole} spec ${setupCase.specFile} changed after execution reconciliation.`,
      );
    }
  }
  if (computeExecutionGraphDigest(executeManifest) !== runPlan.executionGraphDigest) {
    throw new Error(
      "defineFigmaTests: execution project/setup/selected-visual graph no longer matches the frozen plan.",
    );
  }
}
