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

export async function settle(
  page: Page,
  warnings: string[],
  devtoolsSelector: string | undefined,
  animationPolicy: "freeze" | "allow",
  fontReadyTimeoutMs: number,
): Promise<FontReadiness> {
  await page
    .waitForLoadState("networkidle", { timeout: NETWORK_IDLE_BEST_EFFORT_MS })
    .catch(() =>
      warnings.push(
        `network did not become idle within ${NETWORK_IDLE_BEST_EFFORT_MS}ms; capture may include pending requests.`,
      ),
    );
  if (animationPolicy === "freeze") {
    try {
      await page.addStyleTag({ content: NO_ANIMATION_CSS });
    } catch {
      warnings.push("could not inject no-animation CSS.");
    }
  }
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
    }, fontReadyTimeoutMs)
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
