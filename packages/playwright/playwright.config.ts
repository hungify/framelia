import * as os from "node:os";
import * as path from "node:path";

import { defineConfig } from "@playwright/test";

const projectRoot = os.tmpdir();

export default defineConfig({
  testDir: "./tests-smoke",
  outputDir: path.join(os.tmpdir(), "framelia-playwright-smoke-results"),
  reporter: [["./src/reporter.ts", { projectRoot, port: 0 }], ["line"]],
  use: {
    viewport: { width: 100, height: 80 },
  },
  timeout: 15_000,
});
