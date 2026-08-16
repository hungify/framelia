import type { ExpectMatcherState, MatcherReturnType, Page } from "@playwright/test";
import { test } from "@playwright/test";
import { nanoid } from "nanoid";

import { sanitizeAttachmentBaseName } from "../attach.ts";
import type { ComparePagesContext, ComparePagesOptions } from "../compare-pages.ts";
import { runComparePages } from "../compare-pages.ts";

export type ToMatchPageOptions = ComparePagesOptions;

/**
 * Runner-agnostic core (see to-match-figma.ts's doc comment for why this
 * split exists — testable under Vitest without a live Playwright
 * test context).
 */
export async function runToMatchPage(
  received: Page,
  pageB: Page,
  baseName: string,
  options: ToMatchPageOptions,
  context: ComparePagesContext,
): Promise<MatcherReturnType> {
  return runComparePages("toMatchPage", received, pageB, baseName, options, context);
}

/** The registered matcher: thin Playwright-runner glue around {@link runToMatchPage}. */
export async function toMatchPage(
  this: ExpectMatcherState,
  received: Page,
  pageB: Page,
  options: ToMatchPageOptions = {},
): Promise<MatcherReturnType> {
  const testInfo = test.info();
  // oxlint-disable-next-line no-this-in-exported-function -- Playwright's own expect.extend() contract.
  const timeoutMs = this.timeout;
  const baseName = sanitizeAttachmentBaseName(`page-${nanoid(8)}`);
  return runToMatchPage(received, pageB, baseName, options, {
    timeoutMs,
    workDir: testInfo.outputPath(baseName),
    attach: (name, path) =>
      testInfo.attach(name, { path, contentType: "image/png" }).then(() => undefined),
    attachJson: (name, data) =>
      testInfo
        .attach(name, { body: JSON.stringify(data), contentType: "application/json" })
        .then(() => undefined),
  });
}
