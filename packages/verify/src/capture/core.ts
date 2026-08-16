import * as fs from "node:fs";
import * as path from "node:path";

import type { Page } from "@playwright/test";

import {
  DEFAULT_CAPTURE_TIMEOUT_MS,
  DEFAULT_DEVTOOLS_SELECTOR,
  FONT_FALLBACK_WARNING,
} from "../constants.ts";
import { fileHash } from "../hash.ts";
import type { ComputedTextStyle } from "../types.ts";
import { checkFontReadiness, checkScopeSize } from "./domain/capture-rules.ts";
import { resolveMasks } from "./masks.ts";
import { resolveSelector } from "./readiness.ts";
import { reject } from "./reject.ts";
import { fontIncomplete, readComputedTextStyle, settle } from "./settle.ts";
import type { CaptureCoreOutcome, CaptureEvidence, ReadyCaptureSpec } from "./types.ts";
import { MASK_COLOR } from "./types.ts";

/**
 * Navigation-free capture: screenshots a `Page` the caller has already
 * navigated, authenticated, and interacted with — no `goto`/`reload`, no
 * navigation-action execution, no readiness-selector/event wait, and no
 * multi-sample stability loop (a reload between samples would discard the
 * caller's own auth/form state). Intended for callers (e.g.
 * `@framelia/playwright` matchers) that already own reaching the state they
 * want to capture.
 */
export async function captureReadyPage(
  page: Page,
  spec: ReadyCaptureSpec,
): Promise<CaptureCoreOutcome> {
  const timeoutMs = spec.timeoutMs ?? DEFAULT_CAPTURE_TIMEOUT_MS;
  const startedAt = new Date().toISOString();
  const warnings: string[] = [];
  if (page.isClosed()) {
    return reject("CAPTURE_PAGE_CLOSED", "The passed Page is already closed.");
  }
  fs.mkdirSync(path.dirname(spec.outPath), { recursive: true });
  const fontPolicy = spec.fontPolicy ?? "warn";
  const devtoolsSelector =
    spec.devtoolsSelector == null
      ? undefined
      : spec.devtoolsSelector === true
        ? DEFAULT_DEVTOOLS_SELECTOR
        : spec.devtoolsSelector;
  const devtoolsHideStyle = devtoolsSelector
    ? `${devtoolsSelector} { display: none !important; }`
    : undefined;
  const settled = await settle(
    page,
    warnings,
    devtoolsSelector,
    spec.animationPolicy ?? "freeze",
    timeoutMs,
  );
  const fontReject = checkFontReadiness(settled, fontPolicy);
  if (fontReject) return fontReject;
  const selector = spec.scope.kind === "region" ? spec.scope.selector : undefined;
  if (selector) {
    const selectorReject = await resolveSelector(page, selector);
    if (selectorReject) return selectorReject;
  }
  const resolvedMasks = await resolveMasks(page, spec);
  if (!resolvedMasks.ok) return resolvedMasks.reject;
  const { locators: maskLocators, evidence: maskEvidence } = resolvedMasks;
  const capturedAt = new Date().toISOString();
  let elementRect: CaptureEvidence["elementRect"] = null;
  let computedStyle: ComputedTextStyle | null = null;
  if (selector) {
    const locator = page.locator(selector);
    const box = await locator.boundingBox();
    if (box) elementRect = { width: box.width, height: box.height };
    if (box && spec.scope.kind === "region") {
      const scopeSizeReject = checkScopeSize(box, spec.scope.expectedSize);
      if (scopeSizeReject) return scopeSizeReject;
    }
    try {
      computedStyle = await readComputedTextStyle(locator);
    } catch {
      warnings.push("could not read computed style (execution context may have been destroyed).");
    }
    try {
      await locator.screenshot({
        path: spec.outPath,
        animations: spec.animationPolicy === "allow" ? "allow" : "disabled",
        mask: maskLocators,
        ...(maskLocators.length ? { maskColor: MASK_COLOR } : {}),
        ...(devtoolsHideStyle ? { style: devtoolsHideStyle } : {}),
      });
    } catch (error) {
      return reject(
        "CAPTURE_SCREENSHOT_FAILED",
        `Element screenshot failed: ${error instanceof Error ? error.message : String(error)}.`,
      );
    }
  } else {
    try {
      await page.screenshot({
        path: spec.outPath,
        fullPage: spec.scope.kind === "page" ? spec.scope.fullPage : false,
        animations: spec.animationPolicy === "allow" ? "allow" : "disabled",
        mask: maskLocators,
        ...(maskLocators.length ? { maskColor: MASK_COLOR } : {}),
        ...(devtoolsHideStyle ? { style: devtoolsHideStyle } : {}),
      });
    } catch (error) {
      return reject(
        "CAPTURE_SCREENSHOT_FAILED",
        `Page screenshot failed: ${error instanceof Error ? error.message : String(error)}.`,
      );
    }
  }
  return {
    ok: true,
    contract: spec.identity ?? null,
    capturePaths: [spec.outPath],
    ephemeralSamplePaths: [],
    capturedAt,
    startedAt,
    finishedAt: new Date().toISOString(),
    finalUrl: page.url(),
    viewport: page.viewportSize(),
    readiness: null,
    fonts: settled,
    scope: spec.scope,
    screenshotHashes: [fileHash(spec.outPath)],
    elementRect,
    computedStyle,
    warnings:
      fontPolicy === "warn" && fontIncomplete(settled)
        ? [...warnings, FONT_FALLBACK_WARNING]
        : warnings,
    actions: [],
    maskEvidence,
  };
}
