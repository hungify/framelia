import { defineConfig } from "framelia";

export default defineConfig({
  envFile: ".env.playwright",
  storageStatePath: ".framelia/auth/user.json",
});
