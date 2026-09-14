import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { defineConfig } from "@playwright/test";

/**
 * Real-runner feasibility proof for framelia/#77 (WP4)'s own deliverable: "A real
 * Playwright run ... produces a real, valid, schema-passing run bundle on disk that a
 * fresh readRunBundle() call can read back successfully." Kept separate from the other
 * smoke configs (the matcher suite, defineFigmaTests's own suite) so this feature's
 * exercise doesn't multiply every other smoke spec across an extra project/retry.
 *
 * `projectRoot`/`runId` are derived from `FRAMELIA_SMOKE_NONCE` (set by
 * `scripts/verify-run-bundle-smoke.mjs`, which generates one nonce per invocation and
 * passes it to this config's child process; worker processes inherit it automatically)
 * so two concurrent smoke invocations never race on the same fixed directory -- without
 * this, one invocation's own project-root wipe (below) could delete another's
 * in-progress plan/attempts. Falling back to a fixed literal when the env var is unset
 * (e.g. a bare `playwright test --config=playwright.run-bundle.config.ts` invocation
 * outside the verify script) keeps that direct invocation path usable too, just without
 * the isolation guarantee -- run it once at a time in that mode.
 */
const nonce = process.env.FRAMELIA_SMOKE_NONCE ?? "default";
export const projectRoot = path.join(os.tmpdir(), `framelia-run-bundle-smoke-project-${nonce}`);
export const runId = `smoke-run-${nonce}`;
if (process.env.TEST_WORKER_INDEX === undefined) {
  fs.rmSync(projectRoot, { recursive: true, force: true });
  fs.mkdirSync(projectRoot, { recursive: true });
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
