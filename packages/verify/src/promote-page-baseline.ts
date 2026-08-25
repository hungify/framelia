import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { chromium } from "@playwright/test";

import { captureReadyPage } from "./capture/core.ts";
import { DEFAULT_CAPTURE_TIMEOUT_MS } from "./constants.ts";
import { promotePageBaseline, type PromotePageBaselineResult } from "./page-baseline.ts";

export interface CaptureAndPromotePageBaselineOptions {
  url: string;
  outDir: string;
  promotedBy: string;
  runId?: string;
  note?: string;
  /** Region scope when set (captures only this selector's bounding box); page scope otherwise. */
  selector?: string;
  fullPage?: boolean;
  viewport?: { width: number; height: number };
  /** Playwright storage-state file for an authenticated capture (see `framelia auth`). */
  storageStatePath?: string;
  headless?: boolean;
  timeoutMs?: number;
}

export type CaptureAndPromotePageBaselineOutcome =
  | ({ ok: true } & PromotePageBaselineResult)
  | { ok: false; error: string; message: string };

/**
 * The CLI-facing accept/promote step toMatchFigma never needed (Figma is always the
 * live source of truth) but toMatchPageBaseline's persisted baseline has none until
 * someone explicitly accepts a captured state -- see page-baseline.ts. Owns launching
 * its own browser (mirrors auth.ts's recordStorageState) so `framelia baseline promote`
 * doesn't need a Playwright test runner just to capture one page.
 */
export async function captureAndPromotePageBaseline(
  options: CaptureAndPromotePageBaselineOptions,
): Promise<CaptureAndPromotePageBaselineOutcome> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_CAPTURE_TIMEOUT_MS;
  const browser = await chromium.launch({ headless: options.headless ?? true });
  const captureDir = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-baseline-capture-"));
  const capturePath = path.join(captureDir, "capture.png");
  try {
    const context = await browser.newContext({
      viewport: options.viewport ?? null,
      ...(options.storageStatePath ? { storageState: options.storageStatePath } : {}),
    });
    const page = await context.newPage();
    try {
      await page.goto(options.url, { timeout: timeoutMs, waitUntil: "load" });
    } catch (error) {
      return {
        ok: false,
        error: "CAPTURE_NAVIGATION_FAILED",
        message: `navigation to ${options.url} failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    const captured = await captureReadyPage(page, {
      outPath: capturePath,
      scope: options.selector
        ? { kind: "region", selector: options.selector }
        : { kind: "page", fullPage: options.fullPage ?? false },
      screenshot: {},
      timeoutMs,
    });
    if (!captured.ok) {
      return { ok: false, error: captured.error, message: captured.message };
    }

    const promoted = promotePageBaseline({
      sourcePath: captured.capturePaths[0]!,
      outDir: options.outDir,
      promotedBy: options.promotedBy,
      runId: options.runId,
      note: options.note,
    });
    return { ok: true, ...promoted };
  } finally {
    fs.rmSync(captureDir, { recursive: true, force: true });
    await browser.close();
  }
}
