import type { Page } from "@playwright/test";

import { SELECTOR_TIMEOUT_MS } from "../constants.ts";
import type { RejectResult } from "../types.ts";
import { checkUniqueMatch } from "./domain/capture-rules.ts";
import { reject } from "./reject.ts";

export async function resolveSelector(page: Page, selector: string): Promise<RejectResult | null> {
  const locator = page.locator(selector);
  try {
    await locator.first().waitFor({ state: "attached", timeout: SELECTOR_TIMEOUT_MS });
  } catch {
    return reject(
      "SELECTOR_NOT_FOUND",
      `Selector matched 0 elements within ${SELECTOR_TIMEOUT_MS}ms.`,
    );
  }
  const matchCount = await locator.count();
  if (matchCount === 0)
    return reject("SELECTOR_NOT_FOUND", "Selector matched 0 elements in rendered page.");
  return checkUniqueMatch(
    matchCount,
    "SELECTOR_AMBIGUOUS",
    `Selector matched ${matchCount} elements; provide a unique selector or nth-match index.`,
  );
}
