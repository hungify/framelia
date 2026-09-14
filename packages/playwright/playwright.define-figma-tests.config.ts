import * as os from "node:os";
import * as path from "node:path";

import { defineConfig } from "@playwright/test";

const projectRoot = os.tmpdir();

/**
 * Dedicated feasibility-proof config for `defineFigmaTests` (WP3, #76 acceptance
 * criterion 5): "parameterized registrations sharing a source line, extended fixtures,
 * multiple projects/dependencies and repeats on the minimum runner." Kept separate from
 * `playwright.config.ts` (the existing matcher smoke suite) so this feature's exercise
 * doesn't multiply every other smoke spec across two extra projects and a repeat.
 */
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
