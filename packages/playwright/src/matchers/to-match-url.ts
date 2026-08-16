import type { ExpectMatcherState, MatcherReturnType, Page } from "@playwright/test";
import { test } from "@playwright/test";
import { nanoid } from "nanoid";

import { sanitizeAttachmentBaseName } from "../attach.ts";
import type { ComparePagesContext, ComparePagesOptions } from "../compare-pages.ts";
import { runComparePages } from "../compare-pages.ts";

export type ToMatchUrlOptions = ComparePagesOptions;

/**
 * Runner-agnostic core (see to-match-figma.ts's doc comment for why this
 * split exists). Sugar over the same diff tail as toMatchPage: opens a
 * page in the received page's own browser context and navigates it to `url`
 * — sharing the context means the new page inherits the caller's
 * cookies/session, so no separate login is needed for a same-origin URL.
 */
export async function runToMatchUrl(
  received: Page,
  url: string,
  baseName: string,
  options: ToMatchUrlOptions,
  context: ComparePagesContext,
): Promise<MatcherReturnType> {
  const pageB = await received.context().newPage();
  try {
    try {
      await pageB.goto(url, { timeout: context.timeoutMs });
    } catch (error) {
      return {
        pass: false,
        message: () =>
          `toMatchUrl: navigation to ${url} failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    return await runComparePages("toMatchUrl", received, pageB, baseName, options, context);
  } finally {
    await pageB.close();
  }
}

/** The registered matcher: thin Playwright-runner glue around {@link runToMatchUrl}. */
export async function toMatchUrl(
  this: ExpectMatcherState,
  received: Page,
  url: string,
  options: ToMatchUrlOptions = {},
): Promise<MatcherReturnType> {
  const testInfo = test.info();
  // oxlint-disable-next-line no-this-in-exported-function -- Playwright's own expect.extend() contract.
  const timeoutMs = this.timeout;
  const baseName = sanitizeAttachmentBaseName(`url-${nanoid(8)}`);
  return runToMatchUrl(received, url, baseName, options, {
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
