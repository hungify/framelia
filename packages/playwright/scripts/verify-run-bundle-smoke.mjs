#!/usr/bin/env node
import { execFileSync } from "node:child_process";
// Runs the run-bundle smoke config as a real `playwright test` CLI invocation, then reads
// the resulting bundle back with `readRunBundle` and asserts on it explicitly -- proving
// framelia/#77 (WP4)'s own deliverable end to end, not just "the command exited 1",
// which a future regression (e.g. `smoke.failing` accidentally starting to pass) could
// satisfy without ever exercising retry publication.
import * as crypto from "node:crypto";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { readRunBundle } from "@framelia/verify/run-bundle";

const packageDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// One nonce per invocation, passed to the child `playwright test` process (and inherited
// by its own worker subprocesses) so two concurrent smoke runs never race on the same
// fixed projectRoot/runId -- see playwright.run-bundle.config.ts's own doc comment.
const nonce = crypto.randomUUID();
const projectRoot = path.join(os.tmpdir(), `framelia-run-bundle-smoke-project-${nonce}`);
const runId = `smoke-run-${nonce}`;

function fail(message) {
  console.error(`verify-run-bundle-smoke: ${message}`);
  process.exit(1);
}

let exitCode = 0;
try {
  execFileSync("playwright", ["test", "--config", "playwright.run-bundle.config.ts"], {
    cwd: packageDir,
    stdio: "inherit",
    env: { ...process.env, FRAMELIA_SMOKE_NONCE: nonce },
  });
} catch (error) {
  exitCode = typeof error.status === "number" ? error.status : 1;
}

// `smoke.failing` is designed to fail deterministically on every attempt -- exit code 1
// is the expected outcome of this smoke run, not a smoke-test failure in itself. Any
// other exit code (crash, usage error, everything unexpectedly passing) is unexpected.
if (exitCode !== 1) {
  fail(`playwright test exited ${exitCode}, expected 1 (one deterministically failing case).`);
}

const bundle = readRunBundle(projectRoot, runId);

if (bundle.record.status !== "finalized") {
  fail(`run record status is "${bundle.record.status}", expected "finalized".`);
}

const passingCase = bundle.plan.selectedCases.find((entry) =>
  entry.caseId.startsWith("smoke.passing@"),
);
const failingCase = bundle.plan.selectedCases.find((entry) =>
  entry.caseId.startsWith("smoke.failing@"),
);
if (!passingCase || !failingCase) {
  fail(
    `expected both smoke.passing and smoke.failing cases in the frozen plan, got: ${bundle.plan.selectedCases.map((c) => c.caseId).join(", ")}`,
  );
}

const passingRecord = bundle.record.cases.find((entry) => entry.caseId === passingCase.caseId);
if (!passingRecord || passingRecord.attemptIds.length !== 1) {
  fail(`smoke.passing: expected exactly 1 attempt, got ${passingRecord?.attemptIds.length ?? 0}.`);
}
const passingAttempt = bundle.attempts.get(passingRecord.attemptIds[0]);
if (passingAttempt?.visualVerdict !== "passed") {
  fail(
    `smoke.passing's attempt: expected visualVerdict "passed", got "${passingAttempt?.visualVerdict}".`,
  );
}

const failingRecord = bundle.record.cases.find((entry) => entry.caseId === failingCase.caseId);
if (!failingRecord || failingRecord.attemptIds.length !== 2) {
  fail(
    `smoke.failing: expected exactly 2 distinct attempts (retries: 1), got ${failingRecord?.attemptIds.length ?? 0}.`,
  );
}
const failingAttempts = failingRecord.attemptIds.map((id) => bundle.attempts.get(id));
if (!failingAttempts.every((attempt) => attempt?.visualVerdict === "mismatched")) {
  fail(
    `smoke.failing: expected both attempts to have visualVerdict "mismatched", got: ${failingAttempts.map((a) => a?.visualVerdict).join(", ")}.`,
  );
}
const retryIndexes = failingAttempts.map((attempt) => attempt?.retryIndex).toSorted();
if (retryIndexes[0] !== 0 || retryIndexes[1] !== 1) {
  fail(`smoke.failing: expected attempts at retryIndex 0 and 1, got: ${retryIndexes.join(", ")}.`);
}

console.log(
  `verify-run-bundle-smoke: OK -- run "${runId}" finalized with 1 passing attempt and 2 distinct failing attempts.`,
);
