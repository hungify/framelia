import { expect as baseExpect, test } from "@playwright/test";

import { createFrameliaMatchers } from "./create-matchers.ts";

/**
 * Typed `expect` re-export: generic inference through `.extend()`'s
 * return type gives compile-time typing without the older
 * `global.d.ts { PlaywrightTest.Matchers<R,T> }` augmentation, which has a
 * documented breaking-change history (playwright/playwright#26658, #27113,
 * #27117).
 *
 * Requires a real, module-scope `@playwright/test` import -- `expect.extend()` must
 * return a synchronously usable object (spec files call `expect(...)` inline), so this
 * zero-config entry point can't defer resolving `@playwright/test` the way
 * createFrameliaMatchers's factory does. See that function's doc comment for why that
 * makes this file one of exactly two still exposed to the "second instance" crash, and
 * the escape hatch for a consumer who hits it.
 */
export const expect = baseExpect.extend(createFrameliaMatchers(test));

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
