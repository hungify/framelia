import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "@playwright/test";

/**
 * Dedicated feasibility-proof config for `defineFigmaTests` (WP3, #76 acceptance
 * criterion 5): "parameterized registrations sharing a source line, extended fixtures,
 * multiple projects/dependencies and repeats on the minimum runner." Kept separate from
 * `playwright.config.ts` (the existing matcher smoke suite) so this feature's exercise
 * doesn't multiply every other smoke spec across two extra projects and a repeat.
 *
 * `projectRoot` is this package's own directory (not a temp dir), the same convention
 * `playwright.run-bundle.config.ts` uses and documents: a registered test's `specFile`
 * (framelia/#77's registration-time spec-digest fix) is recorded project-relative to
 * `projectRoot`, and only resolves to a project-relative path (no `..` segments) when
 * `projectRoot` is an ancestor of the real spec file Playwright discovers under
 * `testDir` below. Each spec file's own pinned contracts/baselines therefore live under
 * this package's own tree too (`.framelia/smoke-contracts/`, `.framelia/baselines/`,
 * deterministic/idempotent content, no per-invocation cleanup needed -- the same
 * convention `playwright.run-bundle.config.ts`'s own spec file already established)
 * rather than the OS temp dir. `.framelia/*` and the generated top-level config file
 * are gitignored (see `.gitignore`'s own entries, shared with
 * `playwright.run-bundle.config.ts`'s).
 */
export const projectRoot = path.dirname(fileURLToPath(import.meta.url));
if (process.env.TEST_WORKER_INDEX === undefined) {
  fs.writeFileSync(path.join(projectRoot, "framelia.config.mjs"), "export default {};\n");
}

export default defineConfig({
  testDir: "./tests-smoke-figma-contracts",
  outputDir: path.join(os.tmpdir(), "framelia-define-figma-tests-smoke-results"),
  reporter: [["./src/reporter.ts", { projectRoot, port: 0 }], ["line"]],
  repeatEach: 2,
  timeout: 20_000,
  projects: [
    { name: "desktop" },
    // Depends on "desktop": proves defineFigmaTests's single registration participates
    // correctly in Playwright's own project dependency graph, not just a flat project list.
    { name: "mobile", dependencies: ["desktop"] },
  ],
});
