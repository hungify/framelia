import * as fs from "node:fs";

import { recordStorageState, type RecordStorageStateResult } from "@framelia/verify/cli";

import { UsageError } from "../exit.ts";
import type { CliRuntime } from "../runtime-types.ts";
import { assertTargetUrl } from "./browser-input.ts";
import { openProject } from "./project.ts";
import { PROMPT_CANCELLED, type PromptAdapter } from "./prompts.ts";

export interface AuthOptions {
  readonly url: string;
  readonly projectRoot: string | undefined;
  readonly yes: boolean | undefined;
}

async function requireConfirmation(
  prompts: PromptAdapter,
  message: string,
  assumeYes: boolean,
): Promise<void> {
  if (assumeYes) return;
  const confirmed = await prompts.confirm(message, true);
  if (confirmed === PROMPT_CANCELLED || !confirmed) {
    throw new UsageError("Auth capture cancelled.");
  }
}

export interface AuthDependencies {
  readonly recordStorageState: (options: {
    url: string;
    outputPath: string;
    waitForUser: () => Promise<void>;
  }) => Promise<RecordStorageStateResult>;
}

const defaultDependencies: AuthDependencies = { recordStorageState };

export async function authCommand(
  options: AuthOptions,
  prompts: PromptAdapter,
  runtime: CliRuntime,
  deps: AuthDependencies = defaultDependencies,
): Promise<void> {
  assertTargetUrl(options.url, "Auth URL", { carriesBrowserStorageState: true });
  const assumeYes = options.yes ?? false;
  const config = await openProject(options.projectRoot, runtime).loadConfig();
  if (!config.resolvedStorageStatePath) {
    throw new UsageError(
      "storageStatePath is not configured. Uncomment it in framelia.config.ts before running framelia auth.",
    );
  }

  prompts.intro("Record Playwright login state");
  if (fs.existsSync(config.resolvedStorageStatePath)) {
    await requireConfirmation(
      prompts,
      `Replace existing auth state at ${config.storageStatePath}?`,
      assumeYes,
    );
  }

  const result = await deps.recordStorageState({
    url: options.url,
    outputPath: config.resolvedStorageStatePath,
    waitForUser: () =>
      requireConfirmation(prompts, "Finish login in browser, then save session?", false),
  });

  prompts.note(
    [
      `Final URL: ${result.finalUrl}`,
      `Saved: ${config.storageStatePath}`,
      "Session file remains ignored by Git.",
    ].join("\n"),
    "Auth ready",
  );
  prompts.outro("Use target.auth=storageState for protected screens.");
}
