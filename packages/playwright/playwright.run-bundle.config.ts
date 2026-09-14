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
 * `projectRoot` is a fixed (not `mkdtemp`'d) directory so a caller can inspect
 * `.framelia/runs/<runId>` after the CLI run completes without capturing a randomly
 * generated path -- cleared at config-load time so repeated manual runs never see stale
 * state from a previous invocation. This config module is reloaded by every worker
 * process, not just the main/orchestrator one (`process.env.TEST_WORKER_INDEX` is unset
 * only in the latter) -- the wipe is gated on that so a worker starting up well after
 * the Reporter's own `onBegin` has already frozen the run plan never deletes it out from
 * under an in-progress run.
 */
export const projectRoot = path.join(os.tmpdir(), "framelia-run-bundle-smoke-project");
if (process.env.TEST_WORKER_INDEX === undefined) {
  fs.rmSync(projectRoot, { recursive: true, force: true });
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(path.join(projectRoot, "framelia.config.mjs"), "export default {};\n");
}

export default defineConfig({
  testDir: "./tests-smoke-run-bundle",
  outputDir: path.join(os.tmpdir(), "framelia-run-bundle-smoke-results"),
  reporter: [["./src/reporter.ts", { projectRoot, port: 0, runId: "smoke-run" }], ["line"]],
  // The always-failing case gets a second, independently published attempt too --
  // proving a retried case's two attempts stay distinct without depending on any
  // flaky/timing-sensitive behavior (see run-bundle.spec.ts's own header comment).
  retries: 1,
  timeout: 20_000,
  projects: [{ name: "desktop" }],
});
