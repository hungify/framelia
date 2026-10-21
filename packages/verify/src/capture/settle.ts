import type { Page } from "@playwright/test";

import { NETWORK_IDLE_BEST_EFFORT_MS, NETWORK_IDLE_BUFFER_MS } from "../constants.ts";
import type { ComputedTextStyle } from "../types.ts";
import type { FontReadiness } from "./types.ts";

const NO_ANIMATION_CSS = `
*, *::before, *::after {
  animation: none !important;
  transition: none !important;
  caret-color: transparent !important;
  scroll-behavior: auto !important;
}
`;

/** Marks the freeze <style> settle() injects, so it is injected once and removable after. */
const FREEZE_STYLE_ATTRIBUTE = "data-framelia-freeze";
/**
 * Share of the capture's remaining time budget the font wait may use. The rest is left
 * for selector/mask resolution and the screenshots, so a stuck web font ends in the
 * capture's own fontPolicy verdict ("required" rejects, "warn" warns) instead of the
 * caller's outer matcher timeout firing first with a generic message.
 */
export const FONT_READY_BUDGET_FRACTION = 0.5;

export function fontReadyTimeoutMs(remainingBudgetMs: number): number {
  return Math.max(0, Math.floor(remainingBudgetMs * FONT_READY_BUDGET_FRACTION));
}

/**
 * Share of the capture's remaining time budget the network-idle wait may use, never more
 * than NETWORK_IDLE_BEST_EFFORT_MS. A short matcher `timeout` must not be spent almost
 * entirely on this best-effort wait and then end in a generic matcher timeout.
 */
export const NETWORK_IDLE_BUDGET_FRACTION = 0.25;

export function networkIdleTimeoutMs(remainingBudgetMs: number): number {
  return Math.max(
    0,
    Math.min(
      NETWORK_IDLE_BEST_EFFORT_MS,
      Math.floor(remainingBudgetMs * NETWORK_IDLE_BUDGET_FRACTION),
    ),
  );
}

/**
 * @param captureBudgetMs the capture's remaining time budget when settle() starts; the
 *   network-idle wait gets NETWORK_IDLE_BUDGET_FRACTION of it (at most
 *   NETWORK_IDLE_BEST_EFFORT_MS), and the font wait gets FONT_READY_BUDGET_FRACTION of
 *   whatever is left after network idle.
 */
export async function settle(
  page: Page,
  warnings: string[],
  devtoolsSelector: string | undefined,
  animationPolicy: "freeze" | "allow",
  captureBudgetMs: number,
): Promise<FontReadiness> {
  const startedMs = Date.now();
  const idleTimeoutMs = networkIdleTimeoutMs(captureBudgetMs);
  const cutShort =
    idleTimeoutMs < NETWORK_IDLE_BEST_EFFORT_MS
      ? ` (cut short by the ${Math.max(0, Math.floor(captureBudgetMs))}ms capture budget; the best-effort wait is ${NETWORK_IDLE_BEST_EFFORT_MS}ms)`
      : "";
  const networkIdleWarning = `network did not become idle within ${idleTimeoutMs}ms${cutShort}; capture may include pending requests.`;
  // Playwright treats `timeout: 0` as "no timeout", so an exhausted budget skips the wait.
  if (idleTimeoutMs > 0) {
    await page
      .waitForLoadState("networkidle", { timeout: idleTimeoutMs })
      .catch(() => warnings.push(networkIdleWarning));
  } else {
    warnings.push(networkIdleWarning);
  }
  if (animationPolicy === "freeze") {
    try {
      // Tagged and idempotent: repeated captures on one caller-owned page never stack
      // duplicate tags, and releaseAnimationFreeze() can remove it afterwards.
      await page.evaluate(
        ({ css, attribute }) => {
          if (document.querySelector(`style[${attribute}]`)) return;
          const style = document.createElement("style");
          style.setAttribute(attribute, "");
          style.textContent = css;
          (document.head ?? document.documentElement).append(style);
        },
        { css: NO_ANIMATION_CSS, attribute: FREEZE_STYLE_ATTRIBUTE },
      );
    } catch {
      warnings.push("could not inject no-animation CSS.");
    }
  }
  const fontTimeoutMs = fontReadyTimeoutMs(captureBudgetMs - (Date.now() - startedMs));
  const fonts = await page
    .evaluate(async (timeoutMs) => {
      if (!("fonts" in document))
        return { supported: false, status: "unknown" as const, failed: [] as string[] };
      const fontSet = document.fonts as FontFaceSet;
      // fontSet.ready never rejects and can stay pending indefinitely; race it
      // so a slow/stuck font load can't block settle() past the capture timeout.
      const timedOut = await Promise.race([
        fontSet.ready.then(() => false),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(true), timeoutMs)),
      ]);
      return {
        supported: true,
        status:
          !timedOut && fontSet.status === "loaded" ? ("loaded" as const) : ("loading" as const),
        failed: Array.from(fontSet)
          .filter((font) => font.status === "error")
          .map((font) => font.family),
      };
    }, fontTimeoutMs)
    .catch(() => ({ supported: false, status: "unknown" as const, failed: [] as string[] }));
  if (devtoolsSelector) {
    try {
      const matched = await countDevtoolsMatches(page, devtoolsSelector);
      if (matched === 0) {
        warnings.push(
          `devtoolsSelector "${devtoolsSelector}" matched no elements; devtools chrome may still be visible in the capture.`,
        );
      }
    } catch {
      warnings.push(
        "could not check devtoolsSelector matches (execution context may have been destroyed).",
      );
    }
  }
  await page.waitForTimeout(NETWORK_IDLE_BUFFER_MS);
  return fonts;
}

/**
 * Removes the freeze <style> settle() injected, restoring the caller's page: capture
 * functions that screenshot a caller-owned Page must not leave animations disabled for
 * whatever the caller does next. Best effort -- a closed or navigated page has nothing
 * left to restore.
 */
export async function releaseAnimationFreeze(page: Page): Promise<void> {
  if (page.isClosed()) return;
  await page
    .evaluate((attribute) => {
      for (const style of Array.from(document.querySelectorAll(`style[${attribute}]`))) {
        style.remove();
      }
    }, FREEZE_STYLE_ATTRIBUTE)
    .catch(() => {});
}

export function fontIncomplete(fonts: FontReadiness): boolean {
  return !fonts.supported || fonts.status !== "loaded" || fonts.failed.length > 0;
}

export async function readComputedTextStyle(
  loc: ReturnType<Page["locator"]>,
): Promise<ComputedTextStyle> {
  return loc.evaluate((el) => {
    const cs = getComputedStyle(el);
    // Playwright serializes this whole callback to run inside the browser page;
    // px/color must stay nested here, not hoisted to Node scope, or the browser
    // won't have them (oxlint's consistent-function-scoping doesn't know that).
    // oxlint-disable-next-line unicorn/consistent-function-scoping
    const px = (value: string) => Number.parseFloat(value) || 0;
    // oxlint-disable-next-line unicorn/consistent-function-scoping
    const color = (value: string) => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d", { colorSpace: "srgb" });
      if (!context) return null;
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
      return r == null || g == null || b == null || a == null ? null : { r, g, b, a: a / 255 };
    };
    return {
      fontFamily: cs.fontFamily,
      fontWeight: Number.parseFloat(cs.fontWeight) || 400,
      fontSizePx: px(cs.fontSize),
      lineHeightPx: cs.lineHeight === "normal" ? null : px(cs.lineHeight),
      letterSpacingPx: cs.letterSpacing === "normal" ? 0 : px(cs.letterSpacing),
      color: color(cs.color),
      backgroundColor: color(cs.backgroundColor),
    };
  });
}

/**
 * Counts elements matching devtoolsSelector, including inside open shadow
 * roots (Next.js mounts its dev overlay inside a `<nextjs-portal>` shadow
 * root), purely so settle() can warn on a selector that matches nothing.
 * The actual hiding happens via Playwright's own
 * page.screenshot({ style })/locator.screenshot({ style }) — that pierces
 * shadow DOM natively and is applied fresh at every screenshot (including
 * every stability sample) instead of being injected once up front here.
 */
export async function countDevtoolsMatches(page: Page, selector: string): Promise<number> {
  return page.evaluate((sel) => {
    const roots: (Document | ShadowRoot)[] = [document];
    const collectShadowRoots = (root: Document | ShadowRoot) => {
      for (const el of Array.from(root.querySelectorAll("*"))) {
        if (el.shadowRoot) {
          roots.push(el.shadowRoot);
          collectShadowRoots(el.shadowRoot);
        }
      }
    };
    collectShadowRoots(document);
    return roots.reduce((total, root) => total + root.querySelectorAll(sel).length, 0);
  }, selector);
}
