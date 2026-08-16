import * as fs from "node:fs";
import * as path from "node:path";

import { chromium } from "@playwright/test";

export interface RecordStorageStateOptions {
  url: string;
  outputPath: string;
  waitForUser: () => Promise<void>;
  headless?: boolean;
}

export interface RecordStorageStateResult {
  outputPath: string;
  finalUrl: string;
}

export async function recordStorageState(
  options: RecordStorageStateOptions,
): Promise<RecordStorageStateResult> {
  const outputPath = path.resolve(options.outputPath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  const browser = await chromium.launch({ headless: options.headless ?? false });

  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(options.url, { waitUntil: "load" });
    await options.waitForUser();
    await context.storageState({ path: temporaryPath });
    fs.renameSync(temporaryPath, outputPath);
    return { outputPath, finalUrl: page.url() };
  } finally {
    fs.rmSync(temporaryPath, { force: true });
    await browser.close();
  }
}
