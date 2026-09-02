import type { MatcherReturnType, Page } from "@playwright/test";

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
