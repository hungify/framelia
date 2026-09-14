import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "@playwright/test";

/**
 * Real-runner feasibility proof for framelia/#77 (WP4)'s own deliverable: "A real
 * Playwright run ... produces a real, valid, schema-passing run bundle on disk that a
 * fresh readRunBundle() call can read back successfully." Kept separate from the other
 * smoke configs (the matcher suite, defineFigmaTests's own suite) so this feature's
 * exercise doesn't multiply every other smoke spec across an extra project/retry.
 *
 * `projectRoot` is this package's own directory (not a temp dir): a case plan's
 * `specFile` is recorded project-relative to `projectRoot` (so finalization-time
 * reconciliation can relocate and re-hash it -- see @framelia/verify's reconcile.ts),
 * and the real spec file Playwright discovers under `testDir` below only resolves to a
 * project-relative path (no `..` segments) when `projectRoot` is an ancestor of it. The
 * generated `framelia.config.mjs` and pinned contracts/baselines therefore live under
 * this package's own tree too (`.framelia/*` is already repo-wide gitignored; the
 * top-level config file has its own package-local `.gitignore` entry).
 *
 * `runId` is derived from `FRAMELIA_SMOKE_NONCE` (set by
 * `scripts/verify-run-bundle-smoke.mjs`, which generates one nonce per invocation and
 * passes it to this config's child process; worker processes inherit it automatically)
 * so two concurrent smoke invocations never race on the same run bundle -- `projectRoot`
 * itself is now shared/persistent (not wiped per invocation): the config file and pinned
 * contracts/baselines are deterministic, idempotent content, so concurrent invocations
 * writing them simultaneously is harmless, and each invocation's own run state lives
 * under its own nonce-suffixed `.framelia/runs/<runId>` directory regardless.
 */
export const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const nonce = process.env.FRAMELIA_SMOKE_NONCE ?? "default";
export const runId = `smoke-run-${nonce}`;
if (process.env.TEST_WORKER_INDEX === undefined) {
  fs.writeFileSync(path.join(projectRoot, "framelia.config.mjs"), "export default {};\n");
}

export default defineConfig({
  testDir: "./tests-smoke-run-bundle",
  outputDir: path.join(os.tmpdir(), "framelia-run-bundle-smoke-results"),
  reporter: [["./src/reporter.ts", { projectRoot, port: 0, runId }], ["line"]],
  // The always-failing case gets a second, independently published attempt too --
  // proving a retried case's two attempts stay distinct without depending on any
  // flaky/timing-sensitive behavior (see run-bundle.spec.ts's own header comment).
  // scripts/verify-run-bundle-smoke.mjs asserts this explicitly after the run.
  retries: 1,
  timeout: 20_000,
  projects: [{ name: "desktop" }],
});
