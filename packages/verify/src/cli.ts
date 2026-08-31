/**
 * CLI-only entry point: the three actions that launch their own standalone
 * browser (`framelia auth`, `contract suggest-masks`, `baseline promote`) so
 * those commands don't need a Playwright test runner just to open a page. Kept
 * out of the main index -- which @framelia/playwright's matchers and Reporter
 * import -- because each pulls in `chromium` from `@playwright/test` for
 * real at module-load time; a consumer linked in from a separate pnpm project
 * (see examples/framelia-reference-app) that also runs its own Playwright test
 * process would otherwise load a second physical copy of @playwright/test just
 * by importing the main index, which Playwright itself refuses to allow.
 */

export { recordStorageState } from "./auth.ts";
export type { RecordStorageStateOptions, RecordStorageStateResult } from "./auth.ts";

export { captureAndPromotePageBaseline } from "./promote-page-baseline.ts";
export type {
  CaptureAndPromotePageBaselineOptions,
  CaptureAndPromotePageBaselineOutcome,
} from "./promote-page-baseline.ts";

export { suggestMasksForUrl } from "./suggest-masks.ts";
export type { SuggestMasksForUrlOptions, SuggestMasksForUrlOutcome } from "./suggest-masks.ts";
