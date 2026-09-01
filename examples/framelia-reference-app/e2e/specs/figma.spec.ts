import { execSync } from "node:child_process";
import path from "node:path";

import {
  expect,
  isContractFresh,
  readContractEntry,
  writeContractFreshness,
} from "@framelia/playwright";
import { test } from "@playwright/test";

const contractPath = path.resolve(".framelia/visual-verifications/login/visual-contract.json");

/**
 * Whole-app fingerprint for the freshness-skip demo below: coarse (any commit touches it,
 * every contract re-verifies), but zero-config. A per-route fingerprint (e.g. a content
 * hash of the files behind /login) would skip more often at the cost of maintaining that
 * mapping yourself -- see @framelia/playwright's README ("Scaling to many pages").
 */
function resolveFingerprint(): string | undefined {
  try {
    return execSync("git rev-parse HEAD", { cwd: process.cwd() }).toString().trim();
  } catch {
    return undefined;
  }
}

const fingerprint = resolveFingerprint();

// Capture at 2x (see toMatchFigma's `scale` option) instead of the default one-PNG-
// pixel-per-CSS-px: sharper images, less anti-aliasing noise in the score. Paired below
// with a near-pixel-perfect profileOverrides (not profiles.ts's shared "page" defaults,
// which were only ever proven out at 1x) scoped to just this app's own login contracts --
// deliberately not loosened to whatever this page's current score happens to be, so a
// real regression still fails loudly instead of being grandfathered in as the new bar.
test.use({ deviceScaleFactor: 2 });

for (const contractId of ["login.desktop", "login.mobile"] as const) {
  const entry = readContractEntry(contractPath, contractId);

  test(`toMatchFigma compares login page with its ${contractId} visual contract`, async ({
    page,
  }) => {
    test.skip(
      !(entry.ok && process.env.FIGMA_ACCESS_TOKEN),
      entry.ok
        ? "Blocked: set FIGMA_ACCESS_TOKEN."
        : `Blocked: ${entry.message} Run pnpm cli:contract:login.`,
    );
    const { contract } = entry as Extract<typeof entry, { ok: true }>;

    test.skip(
      fingerprint !== undefined && isContractFresh(contract.outDir, fingerprint),
      `unchanged since the last passing check at this commit (${fingerprint}).`,
    );

    // Match the Figma frame's pixel dimensions so toMatchFigma compares like-for-like sizes.
    await page.setViewportSize(contract.viewport);
    await page.goto("/login");
    await expect(page).toMatchFigma(contract.baseline.nodeId, {
      contractId,
      fileKey: contract.baseline.fileKey,
      fullPage: true,
      animationPolicy: "freeze",
      devtoolsSelector: true,
      scale: true,
      // Near-pixel-perfect bar for this app's own login page -- see the comment above
      // this loop for why these live here instead of in profiles.ts's shared "page".
      profileOverrides: { minMatch: 0.999, minSSIM: 0.995 },
    });

    if (fingerprint !== undefined) {
      writeContractFreshness(contract.outDir, {
        fingerprint,
        pass: true,
        checkedAt: new Date().toISOString(),
      });
    }
  });
}
