import type { MatcherReturnType, Page } from "@playwright/test";

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
