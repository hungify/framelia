import type { KnipConfig } from "knip";

export default {
  ignore: [".agents/**"],
  ignoreExportsUsedInFile: true,
  // Internal exports kept for tests or future callers; cleanup is tracked separately, so they warn
  // instead of failing `pnpm knip` while unused files and dependencies stay errors.
  rules: {
    exports: "warn",
    types: "warn",
    duplicates: "warn",
  },
  workspaces: {
    ".": {
      entry: [
        // Run by Claude Code (.claude/settings.json, subagent frontmatter), not imported.
        ".claude/hooks/*.mjs",
        "scripts/*.mjs",
        // Copied into a throwaway consumer project by scripts/consumer-smoke.mjs.
        "scripts/consumer-smoke/**/*.{ts,js,mjs}",
        "stryker*.config.mjs",
      ],
      // Resolved inside the consumer project scripts/consumer-smoke.mjs installs, not from the root.
      ignoreDependencies: ["@playwright/test"],
    },
    "apps/dashboard": {
      // File-based routes are loaded by the vue-router Vite plugin, not imported.
      entry: ["pages/**/*.vue"],
    },
    "packages/playwright": {
      entry: ["playwright*.config.ts", "tests-smoke*/**/*.ts", "scripts/*.mjs"],
    },
    "packages/verify": {
      // Manual developer utilities (`tsx scripts/<name>.ts`).
      entry: ["scripts/*.ts"],
    },
  },
} satisfies KnipConfig;
