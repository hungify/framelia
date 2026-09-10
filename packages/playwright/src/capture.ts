import type { CaptureCoreOutcome, ReadyCaptureSpec } from "@framelia/verify/internal";
import { captureReadyPage } from "@framelia/verify/internal";
import type { Page } from "@playwright/test";

export interface CaptureOptions {
  outPath: string;
  /** Region scope when set, page scope otherwise. */
  selector?: string;
  expectedSize?: { width: number; height: number };
  fullPage?: boolean;
  masks?: ReadyCaptureSpec["screenshot"]["masks"];
  maxMaskedAreaRatio?: number;
  timeoutMs?: number;
  fontPolicy?: "required" | "warn";
  animationPolicy?: "freeze" | "allow";
  /** Hides dev-only overlays (TanStack Query/Router devtools, Next.js's dev overlay) before
   *  capture: `true` uses the built-in selector, or pass a custom CSS selector. Off by
   *  default -- unset means no hiding, matching @framelia/verify's captureReadyPage. */
  devtoolsSelector?: ReadyCaptureSpec["devtoolsSelector"];
  /** Device pixel ratio to capture at -- see @framelia/verify's captureReadyPage `scale`
   *  option. Defaults to 1 (one PNG pixel per CSS px), unchanged from before this
   *  existed; pass the Page's own live `devicePixelRatio` for a sharper capture. */
  scale?: ReadyCaptureSpec["scale"];
}

/**
 * Thin wrapper over @framelia/verify's navigation-free capture primitive.
 * Every matcher (toMatchFigma, toMatchPage, toMatchUrl) captures its "actual"
 * side through here — the caller already navigated/authenticated the page;
 * this only screenshots it.
 */
export async function captureActual(
  page: Page,
  options: CaptureOptions,
): Promise<CaptureCoreOutcome> {
  return captureReadyPage(page, {
    outPath: options.outPath,
    scope: options.selector
      ? { kind: "region", selector: options.selector, expectedSize: options.expectedSize }
      : { kind: "page", fullPage: options.fullPage ?? false },
    screenshot: { masks: options.masks, maxMaskedAreaRatio: options.maxMaskedAreaRatio },
    timeoutMs: options.timeoutMs,
    fontPolicy: options.fontPolicy,
    animationPolicy: options.animationPolicy,
    devtoolsSelector: options.devtoolsSelector,
    scale: options.scale,
  });
}
