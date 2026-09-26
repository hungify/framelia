import { defineFigmaTests } from "@framelia/playwright";
import { test } from "@playwright/test";

// Contract-driven flow: `.framelia/contracts/login.*/visual-contract.json` (authored via
// `pnpm cli:contract:migrate` / `framelia contract create`) is the source of truth for
// route, Figma baseline, viewport, scale, and comparison thresholds. defineFigmaTests
// registers one Playwright test per contract file, fans it across every configured
// project, reconciles viewport/deviceScaleFactor, and compares against an already-pinned,
// offline baseline snapshot -- no Figma credentials or network reachable at test-run time.
defineFigmaTests(test, {
  contracts: [
    new URL("../../.framelia/contracts/login.desktop/visual-contract.json", import.meta.url),
    new URL("../../.framelia/contracts/login.mobile/visual-contract.json", import.meta.url),
  ],
  specUrl: new URL(import.meta.url),
  animationPolicy: "freeze",
  devtoolsSelector: true,
  prepare: async ({ page }, { target }) => {
    await page.goto(target.path);
  },
});
