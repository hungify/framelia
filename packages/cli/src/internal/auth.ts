import * as fs from "node:fs";

import type { CommandEnvironment } from "../environment.ts";
import { UsageError } from "../exit.ts";
import type { CliResult } from "../output.ts";
import { assertTargetUrl } from "./browser-input.ts";
import { failureOutcome, type FailureOutcome } from "./outcome.ts";
import { openProject } from "./project.ts";
import { PROMPT_CANCELLED, type PromptAdapter } from "./prompts.ts";

export interface AuthOptions {
  readonly url: string;
  readonly projectRoot: string | undefined;
  readonly yes: boolean | undefined;
}

export interface AuthOutcome {
  readonly formatVersion: 1;
  readonly kind: "framelia.auth-outcome";
  readonly command: "auth";
  readonly executionState: "completed";
  readonly exitCode: 0;
  /** Project-relative path of the saved session; the file itself is never echoed. */
  readonly storageStatePath: string;
  /** Where login ended, without query or fragment (they can carry one-time secrets). */
  readonly finalUrl: string;
  readonly diagnostics: [];
}

export type AuthResult = CliResult<AuthOutcome | FailureOutcome<"framelia.auth-outcome", "auth">>;

async function requireConfirmation(
  prompts: PromptAdapter,
  message: string,
  assumeYes: boolean,
): Promise<void> {
  if (assumeYes) return;
  const confirmed = await prompts.confirm(message, true);
  if (confirmed === PROMPT_CANCELLED || !confirmed) {
    throw new UsageError("Auth capture cancelled.", { code: "AUTH_CANCELLED" });
  }
}

function withoutSecrets(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "";
  }
}

/** Records a login session through a headed browser; needs a person at an interactive terminal. */
export async function authCommand(
  options: AuthOptions,
  env: CommandEnvironment,
): Promise<AuthResult> {
  try {
    return await recordAuth(options, env);
  } catch (error) {
    return failureOutcome({
      kind: "framelia.auth-outcome",
      command: "auth",
      error,
      fallbackCode: "AUTH_FAILED",
      stage: "auth",
      projectRoot: options.projectRoot,
    });
  }
}

async function recordAuth(options: AuthOptions, env: CommandEnvironment): Promise<AuthResult> {
  const runtime = env.process;
  assertTargetUrl(options.url, "Auth URL", { carriesBrowserStorageState: true });
  const assumeYes = options.yes ?? false;
  const prompts = await env.adapters.prompts(runtime);
  if (!prompts.interactive) {
    // Login completion is always confirmed by a person; never hang a CI job waiting for it.
    throw new UsageError(
      "framelia auth needs an interactive terminal to confirm the login; run it locally, not in CI or with redirected stdin.",
      { code: "INTERACTIVE_TERMINAL_REQUIRED" },
    );
  }
  const config = await openProject(options.projectRoot, runtime).loadConfig();
  if (!config.resolvedStorageStatePath || !config.storageStatePath) {
    throw new UsageError(
      "storageStatePath is not configured. Uncomment it in framelia.config.ts before running framelia auth.",
      { code: "PROJECT_POLICY_INCOMPLETE" },
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
  return {
    ok: true,
    exitCode: 0,
    body: {
      formatVersion: 1,
      kind: "framelia.auth-outcome",
      command: "auth",
      executionState: "completed",
      exitCode: 0,
      storageStatePath: config.storageStatePath,
      finalUrl: withoutSecrets(result.finalUrl),
      diagnostics: [],
    },
  };
}
