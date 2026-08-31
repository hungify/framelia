import { defineConfig } from "framelia";

export default defineConfig({
  envFile: ".env.e2e",
  storageStatePath: ".framelia/auth/user.json",

  // Project-wide capture defaults:
  // stabilitySamples: 3,
  // timeoutMs: 60_000,
  // devtoolsSelector: true,
  // deviceScaleFactor: 1,
  // fontPolicy: "required",
  // animationPolicy: "freeze",
  // retry: { attempts: 2, delayMs: 1_000 },
  // maxMaskedAreaRatio: 0.15,
});
