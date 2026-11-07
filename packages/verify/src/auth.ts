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

/** Storage state is a live session credential: owner-only, regardless of the umask. */
const STORAGE_STATE_FILE_MODE = 0o600;
const STORAGE_STATE_DIRECTORY_MODE = 0o700;

export async function recordStorageState(
  options: RecordStorageStateOptions,
): Promise<RecordStorageStateResult> {
  const outputPath = path.resolve(options.outputPath);
  const directory = path.dirname(outputPath);
  const directoryExisted = fs.existsSync(directory);
  fs.mkdirSync(directory, { recursive: true, mode: STORAGE_STATE_DIRECTORY_MODE });
  // mkdir's mode is masked by the umask; a directory this call created is narrowed explicitly.
  // An existing directory is the project's own choice and stays as it is.
  if (!directoryExisted) fs.chmodSync(directory, STORAGE_STATE_DIRECTORY_MODE);
  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  const browser = await chromium.launch({ headless: options.headless ?? false });

  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(options.url, { waitUntil: "load" });
    await options.waitForUser();
    await context.storageState({ path: temporaryPath });
    // Narrow before the rename so the session is never visible at the final path with a wider
    // mode, then again after it in case the platform's rename does not carry the mode over.
    fs.chmodSync(temporaryPath, STORAGE_STATE_FILE_MODE);
    fs.renameSync(temporaryPath, outputPath);
    fs.chmodSync(outputPath, STORAGE_STATE_FILE_MODE);
    return { outputPath, finalUrl: page.url() };
  } finally {
    fs.rmSync(temporaryPath, { force: true });
    await browser.close();
  }
}
