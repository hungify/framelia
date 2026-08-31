import { expect as baseExpect } from "@playwright/test";

import { toMatchFigma } from "./matchers/to-match-figma.ts";
import { toMatchPageBaseline } from "./matchers/to-match-page-baseline.ts";
import { toMatchPage } from "./matchers/to-match-page.ts";
import { toMatchUrl } from "./matchers/to-match-url.ts";

/**
 * Typed `expect` re-export: generic inference through `.extend()`'s
 * return type gives compile-time typing without the older
 * `global.d.ts { PlaywrightTest.Matchers<R,T> }` augmentation, which has a
 * documented breaking-change history (playwright/playwright#26658, #27113,
 * #27117).
 */
export const expect = baseExpect.extend({
  toMatchFigma,
  toMatchPage,
  toMatchPageBaseline,
  toMatchUrl,
});

export type { ToMatchFigmaOptions } from "./matchers/to-match-figma.ts";
export type { ToMatchPageOptions } from "./matchers/to-match-page.ts";
export type { ToMatchPageBaselineOptions } from "./matchers/to-match-page-baseline.ts";
export type { ToMatchUrlOptions } from "./matchers/to-match-url.ts";

// Re-exported so a spec only needs one import for "read a contract entry, decide
// whether it's stale, run the matcher" -- see README's "Scaling to many pages".
export {
  isContractFresh,
  readContractEntry,
  readContractFreshness,
  writeContractFreshness,
} from "@framelia/verify";
export type { ContractFreshnessReceipt, ReadContractEntryOutcome } from "@framelia/verify";
