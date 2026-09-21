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
 * navigation-action execution, and no readiness-selector/event wait. It takes two
 * back-to-back samples without reloading so the durable score can prove whether the
 * caller-owned state was pixel-stable. Intended for callers (e.g.
 * `@framelia/playwright` matchers) that already own reaching the state they want to
 * capture.
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
  const scale = spec.scale ?? 1;
  // "css" (one PNG pixel per CSS px) is the default and what every existing
  // CSS-px-based bound below (masks.ts's scope/mask bounds, capture-style.ts's
  // captureElementBounds) assumes -- Playwright's own "device" default would let a
  // deviceScaleFactor > 1 context silently misalign every one of them. Only switch to
  // "device" (and scale those bounds to match, see resolveMasks's `scale` param below)
  // when the caller explicitly asks for a sharper, non-1:1 capture.
  const screenshotScale = scale === 1 ? "css" : "device";
  if (scale > 1) {
    // A "device"-scale screenshot always reflects the context's own real DPR,
    // regardless of what `scale` the caller asked for -- Playwright has no per-call
    // override. Failing fast here, before any settle/mask/selector work, turns a
    // silently wrong-resolution capture (and a downstream, harder-to-diagnose
    // compare() dimension mismatch) into one clear, immediate, actionable rejection.
    const liveDpr = await page.evaluate(() => window.devicePixelRatio);
    if (liveDpr !== scale) {
      return reject(
        "CAPTURE_SCALE_MISMATCH",
        `Requested capture scale ${scale} does not match the page's actual devicePixelRatio ${liveDpr}. deviceScaleFactor is fixed at browser-context creation -- configure the context with { deviceScaleFactor: ${scale} } to match, or capture at scale 1.`,
      );
    }
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
  const resolvedMasks = await resolveMasks(page, spec, scale);
  if (!resolvedMasks.ok) return resolvedMasks.reject;
  const { locators: maskLocators, evidence: maskEvidence } = resolvedMasks;
  const capturedAt = new Date().toISOString();
  const samplePaths = Array.from({ length: spec.stabilitySamples - 1 }, (_, index) =>
    path.join(
      path.dirname(spec.outPath),
      `.${path.basename(spec.outPath)}.stability-${index + 1}.png`,
    ),
  );
  const capturePaths = [spec.outPath, ...samplePaths];
  const removePrivateSamples = (): void => {
    for (const samplePath of samplePaths) fs.rmSync(samplePath, { force: true });
  };
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
      for (const screenshotPath of capturePaths) {
        await locator.screenshot({
          path: screenshotPath,
          scale: screenshotScale,
          animations: spec.animationPolicy === "allow" ? "allow" : "disabled",
          mask: maskLocators,
          ...(maskLocators.length ? { maskColor: MASK_COLOR } : {}),
          ...(devtoolsHideStyle ? { style: devtoolsHideStyle } : {}),
        });
      }
    } catch (error) {
      removePrivateSamples();
      return reject(
        "CAPTURE_SCREENSHOT_FAILED",
        `Element screenshot failed: ${error instanceof Error ? error.message : String(error)}.`,
      );
    }
  } else {
    try {
      for (const screenshotPath of capturePaths) {
        await page.screenshot({
          path: screenshotPath,
          scale: screenshotScale,
          fullPage: spec.scope.kind === "page" ? spec.scope.fullPage : false,
          animations: spec.animationPolicy === "allow" ? "allow" : "disabled",
          mask: maskLocators,
          ...(maskLocators.length ? { maskColor: MASK_COLOR } : {}),
          ...(devtoolsHideStyle ? { style: devtoolsHideStyle } : {}),
        });
      }
    } catch (error) {
      removePrivateSamples();
      return reject(
        "CAPTURE_SCREENSHOT_FAILED",
        `Page screenshot failed: ${error instanceof Error ? error.message : String(error)}.`,
      );
    }
  }
  let screenshotHashes: string[];
  try {
    screenshotHashes = capturePaths.map((capturePath) => fileHash(capturePath));
  } finally {
    removePrivateSamples();
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
    screenshotHashes,
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
