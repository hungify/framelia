import { expect as baseExpect } from "@playwright/test";

import { toMatchFigma } from "./matchers/to-match-figma.ts";
import { toMatchPage } from "./matchers/to-match-page.ts";
import { toMatchUrl } from "./matchers/to-match-url.ts";

/**
 * Typed `expect` re-export: generic inference through `.extend()`'s
 * return type gives compile-time typing without the older
 * `global.d.ts { PlaywrightTest.Matchers<R,T> }` augmentation, which has a
 * documented breaking-change history (playwright/playwright#26658, #27113,
 * #27117).
 */
export const expect = baseExpect.extend({ toMatchFigma, toMatchPage, toMatchUrl });

export type { ToMatchFigmaOptions } from "./matchers/to-match-figma.ts";
export type { ToMatchPageOptions } from "./matchers/to-match-page.ts";
export type { ToMatchUrlOptions } from "./matchers/to-match-url.ts";
