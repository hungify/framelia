import { existsSync } from "node:fs";
import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

if (existsSync(".env.playwright")) process.loadEnvFile(".env.playwright");

const PORT = process.env.PORT ?? "3000";
const baseURL = `http://localhost:${PORT}`;

const authFile = path.resolve("playwright/.auth/user.json");

export default defineConfig({
  testDir: ".",
  outputDir: ".cache/playwright",
  fullyParallel: false,
  reporter: [["@framelia/playwright/reporter"], ["line"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "setup",
      testMatch: /e2e\/fixtures\/auth\.setup\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "unauthenticated",
      testMatch: /e2e\/specs\/(?:public|web-to-web.*|figma)\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "authenticated",
      testMatch: /e2e\/specs\/authenticated\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], storageState: authFile },
    },
  ],
  webServer: {
    command: "vp run build && vp run start",
    env: {
      ...process.env,
      PORT,
    },
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
