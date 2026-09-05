import { chromium } from "@playwright/test";

import { settle } from "./capture/settle.ts";
import { DEFAULT_CAPTURE_TIMEOUT_MS } from "./constants.ts";
import { suggestMasks, type MaskSuggestion, type MaskSuggestionHeuristic } from "./mask-suggest.ts";

export interface SuggestMasksForUrlOptions {
  url: string;
  viewport?: { width: number; height: number };
  /** Playwright storage-state file for an authenticated scan (see `framelia auth`). */
  storageStatePath?: string;
  headless?: boolean;
  timeoutMs?: number;
  animationPolicy?: "freeze" | "allow";
  heuristics?: readonly MaskSuggestionHeuristic[];
}

export type SuggestMasksForUrlOutcome =
  | { ok: true; url: string; suggestions: MaskSuggestion[] }
  | { ok: false; error: string; message: string };

/**
 * The CLI-facing entry for `framelia contract suggest-masks` (#42). Owns
 * launching its own browser (mirrors promote-page-baseline.ts's
 * captureAndPromotePageBaseline) so the command doesn't need a Playwright test
 * runner just to scan one page. Reuses capture/settle.ts's settle() -- the same
 * readiness pipeline captureReadyPage runs before every toMatchFigma/toMatchPage
 * capture -- so suggestions reflect the DOM a real capture would actually see
 * (fonts loaded, animations frozen), not a premature mid-render snapshot; see
 * suggestMasks in mask-suggest.ts for the scan itself. Suggestions are always
 * proposals only -- this never writes to a contract.
 */
export async function suggestMasksForUrl(
  options: SuggestMasksForUrlOptions,
): Promise<SuggestMasksForUrlOutcome> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_CAPTURE_TIMEOUT_MS;
  const browser = await chromium.launch({ headless: options.headless ?? true });
  try {
    const context = await browser.newContext({
      viewport: options.viewport ?? null,
      ...(options.storageStatePath ? { storageState: options.storageStatePath } : {}),
    });
    const page = await context.newPage();
    try {
      await page.goto(options.url, { timeout: timeoutMs, waitUntil: "load" });
    } catch (error) {
      return {
        ok: false,
        error: "CAPTURE_NAVIGATION_FAILED",
        message: `navigation to ${options.url} failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    const warnings: string[] = [];
    await settle(page, warnings, undefined, options.animationPolicy ?? "freeze", timeoutMs);
    const suggestions = await suggestMasks(page, options.heuristics);
    return { ok: true, url: page.url(), suggestions };
  } finally {
    await browser.close();
  }
}
