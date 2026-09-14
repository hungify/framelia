import type { ContractFreshnessReceipt, ReadContractEntryOutcome } from "@framelia/verify";
import { describe, expect, it } from "vitest";

import * as createMatchersApi from "../src/create-matchers.ts";
import type { FrameliaMatchers, PlaywrightTestHandle } from "../src/create-matchers.ts";
// Type-only half of index.ts's surface: importing these here means `tsc --noEmit`
// fails immediately if any is ever renamed or removed -- these have no runtime
// presence, so the Object.keys() snapshot below can't see them.
import type {
  DefineFigmaTestsOptions,
  FigmaContractOutcome,
  FigmaContractTarget,
  FigmaContractTestContext,
  ToMatchFigmaOptions,
  ToMatchPageBaselineOptions,
  ToMatchPageOptions,
  ToMatchUrlOptions,
} from "../src/index.ts";
import * as registerApi from "../src/register.ts";
import * as reporterApi from "../src/reporter.ts";

/** Referenced only so the type-only imports above aren't dead code and every
 *  name is provably still resolvable by the type checker. Never constructed. */
export type PublicTypeSurface = [
  ToMatchFigmaOptions,
  ToMatchPageOptions,
  ToMatchPageBaselineOptions,
  ToMatchUrlOptions,
  ContractFreshnessReceipt,
  ReadContractEntryOutcome,
  PlaywrightTestHandle,
  FrameliaMatchers,
  DefineFigmaTestsOptions,
  FigmaContractOutcome,
  FigmaContractTarget,
  FigmaContractTestContext,
];

/** register.ts is a pure side-effect module (extends @playwright/test's own
 *  `expect` singleton) -- it has never had any runtime exports of its own. */
const EXPECTED_REGISTER_EXPORTS: string[] = [];

/** reporter.ts exports FrameliaReporter as a default export only. */
const EXPECTED_REPORTER_EXPORTS = ["default"];

/**
 * `./create-matchers` is a new, additive entry point (not frozen by phase 0 --
 * it didn't exist yet): the escape hatch for consumers hitting Playwright's
 * "second @playwright/test instance" crash, who wire their own already-loaded
 * `test` in directly via `createFrameliaMatchers(test)` instead of importing
 * `.`/`./register`.
 */
const EXPECTED_CREATE_MATCHERS_EXPORTS = ["createFrameliaMatchers"];

describe("public API surface", () => {
  it("'./register' (src/register.ts) matches the exact expected runtime export-name set", () => {
    expect(Object.keys(registerApi).toSorted()).toEqual(EXPECTED_REGISTER_EXPORTS);
  });

  it("'./reporter' (src/reporter.ts) matches the exact expected runtime export-name set", () => {
    expect(Object.keys(reporterApi).toSorted()).toEqual(EXPECTED_REPORTER_EXPORTS);
  });

  it("'./create-matchers' (src/create-matchers.ts) matches the exact expected runtime export-name set", () => {
    expect(Object.keys(createMatchersApi).toSorted()).toEqual(EXPECTED_CREATE_MATCHERS_EXPORTS);
  });
});
