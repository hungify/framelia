import type { ExpectMatcherState, MatcherReturnType, Page, TestInfo } from "@playwright/test";
import { nanoid } from "nanoid";

import { buildAttachContext, sanitizeAttachmentBaseName } from "./attach.ts";
import { runToMatchFigma, type ToMatchFigmaOptions } from "./matchers/to-match-figma.ts";
import {
  runToMatchPageBaseline,
  type ToMatchPageBaselineOptions,
} from "./matchers/to-match-page-baseline.ts";
import { runToMatchPage, type ToMatchPageOptions } from "./matchers/to-match-page.ts";
import { runToMatchUrl, type ToMatchUrlOptions } from "./matchers/to-match-url.ts";

/**
 * The minimal shape this factory needs from an already-resolved `@playwright/test`
 * `test` export -- structurally compatible with the real `test` (and with a fake for
 * tests), but declared locally so this file's only Playwright dependency is a
 * `type`-only import of `TestInfo`, erased at compile time and never touching module
 * resolution. `ExpectMatcherState` has no `testInfo` field (verified against
 * Playwright's own shipped .d.ts), so `test.info()` is the only way to reach it --
 * see index.ts/register.ts for why *they* still need a real `@playwright/test`
 * import: `expect.extend()` must return a synchronously usable object, so those
 * zero-config entry points can't defer resolving it the way this factory does.
 */
export interface PlaywrightTestHandle {
  info(): TestInfo;
}

export interface FrameliaMatchers {
  toMatchFigma(
    this: ExpectMatcherState,
    received: Page,
    nodeId: string,
    options?: ToMatchFigmaOptions,
  ): Promise<MatcherReturnType>;
  toMatchPage(
    this: ExpectMatcherState,
    received: Page,
    pageB: Page,
    options?: ToMatchPageOptions,
  ): Promise<MatcherReturnType>;
  toMatchPageBaseline(
    this: ExpectMatcherState,
    received: Page,
    key: string,
    options?: ToMatchPageBaselineOptions,
  ): Promise<MatcherReturnType>;
  toMatchUrl(
    this: ExpectMatcherState,
    received: Page,
    url: string,
    options?: ToMatchUrlOptions,
  ): Promise<MatcherReturnType>;
  // Index signature so this interface is directly assignable to expect.extend()'s
  // `Record<string, ...>`-constrained parameter type, without a `Record<string, ...>`
  // umbrella type erasing each matcher's own specific parameter types above.
  // oxlint-disable-next-line no-explicit-any -- must match expect.extend()'s own
  // MoreMatchers constraint signature exactly (see its .d.ts).
  [matcherName: string]: (
    this: ExpectMatcherState,
    receiver: any,
    ...args: any[]
  ) => MatcherReturnType | Promise<MatcherReturnType>;
}

/**
 * Builds the four registered-matcher wrappers -- thin Playwright-runner glue around
 * this package's runner-agnostic cores (runToMatchFigma etc., see their own doc
 * comments) -- wired to a caller-supplied `test` handle instead of importing
 * `@playwright/test`'s own `test` export at module scope.
 *
 * This is the structural fix for Playwright's hard "second @playwright/test
 * instance" crash: an external consumer outside this repo's exact pnpm-workspace
 * topology (where a prior fix, #60, only worked by folding one internal example into
 * the root workspace so pnpm dedupes the install) can now wire their own
 * already-loaded `test` in directly --
 *
 * ```ts
 * import { expect as baseExpect, test } from "@playwright/test";
 * import { createFrameliaMatchers } from "@framelia/playwright/create-matchers";
 *
 * export const expect = baseExpect.extend(createFrameliaMatchers(test));
 * ```
 *
 * -- which structurally removes the second-resolution path, rather than depending on
 * workspace topology. This narrows this package's real `@playwright/test` import
 * surface from six files (all four matcher files plus index.ts/register.ts) to two
 * (index.ts/register.ts only, which the zero-config entry points genuinely can't
 * avoid -- see PlaywrightTestHandle's doc comment). A rejected alternative
 * (inspecting `require.cache` to detect/reuse an already-loaded instance) was
 * considered and is deliberately not implemented here -- it would violate this
 * codebase's own "no internal APIs" principle and be fragile across Playwright
 * versions.
 */
export function createFrameliaMatchers(test: PlaywrightTestHandle): FrameliaMatchers {
  return {
    async toMatchFigma(received, nodeId, options = {}) {
      const testInfo = test.info();
      // oxlint-disable-next-line no-this-in-exported-function -- Playwright's own expect.extend() contract.
      const timeoutMs = this.timeout;
      return runToMatchFigma(received, nodeId, options, {
        timeoutMs,
        workDir: testInfo.outputPath(sanitizeAttachmentBaseName(nodeId)),
        ...buildAttachContext(testInfo),
      });
    },

    async toMatchPage(received, pageB, options = {}) {
      const testInfo = test.info();
      // oxlint-disable-next-line no-this-in-exported-function -- Playwright's own expect.extend() contract.
      const timeoutMs = this.timeout;
      const baseName = sanitizeAttachmentBaseName(`page-${nanoid(8)}`);
      return runToMatchPage(received, pageB, baseName, options, {
        timeoutMs,
        workDir: testInfo.outputPath(baseName),
        ...buildAttachContext(testInfo),
      });
    },

    async toMatchPageBaseline(received, key, options = {}) {
      const testInfo = test.info();
      // oxlint-disable-next-line no-this-in-exported-function -- Playwright's own expect.extend() contract.
      const timeoutMs = this.timeout;
      const baseName = sanitizeAttachmentBaseName(`page-baseline-${key}`);
      return runToMatchPageBaseline(received, key, options, {
        timeoutMs,
        workDir: testInfo.outputPath(baseName),
        ...buildAttachContext(testInfo),
      });
    },

    async toMatchUrl(received, url, options = {}) {
      const testInfo = test.info();
      // oxlint-disable-next-line no-this-in-exported-function -- Playwright's own expect.extend() contract.
      const timeoutMs = this.timeout;
      const baseName = sanitizeAttachmentBaseName(`url-${nanoid(8)}`);
      return runToMatchUrl(received, url, baseName, options, {
        timeoutMs,
        workDir: testInfo.outputPath(baseName),
        ...buildAttachContext(testInfo),
      });
    },
  };
}
