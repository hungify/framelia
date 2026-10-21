import * as fs from "node:fs";

import type { CommandEnvironment } from "../environment.ts";
import { UsageError } from "../exit.ts";
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

export async function authCommand(options: AuthOptions, env: CommandEnvironment): Promise<void> {
  const runtime = env.process;
  assertTargetUrl(options.url, "Auth URL", { carriesBrowserStorageState: true });
  const assumeYes = options.yes ?? false;
  const config = await openProject(options.projectRoot, runtime).loadConfig();
  if (!config.resolvedStorageStatePath) {
    throw new UsageError(
      "storageStatePath is not configured. Uncomment it in framelia.config.ts before running framelia auth.",
    );
  }

  const prompts = await env.adapters.prompts(runtime);
  prompts.intro("Record Playwright login state");
  if (fs.existsSync(config.resolvedStorageStatePath)) {
    await requireConfirmation(
      prompts,
      `Replace existing auth state at ${config.storageStatePath}?`,
      assumeYes,
    );
  }

  const browser = await env.adapters.browser();
  const result = await browser.recordStorageState({
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
