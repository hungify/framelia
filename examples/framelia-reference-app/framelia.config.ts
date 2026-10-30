import { defineConfig } from "framelia";

export default defineConfig({
  envFile: ".env.e2e",
  storageStatePath: "playwright/.auth/user.json",
  playwright: { config: "playwright.config.ts", projects: ["unauthenticated", "authenticated"] },
  contracts: [".framelia/contracts/**/visual-contract.json"],
});
