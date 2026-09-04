import * as fs from "node:fs";

import { httpUrlSchema } from "@framelia/contracts";
import { recordStorageState, type RecordStorageStateResult } from "@framelia/verify/cli";

import { UsageError } from "../errors.ts";
import type { CliRuntime } from "../runtime-types.ts";
import { loadProjectConfig } from "./config.ts";
import { resolveProjectRoot } from "./project-root.ts";
import { assertSecureUrl } from "./secure-url.ts";

export interface AuthOptions {
  readonly url: string;
  readonly projectRoot: string | undefined;
  readonly yes: boolean | undefined;
}

/**
 * The complete `@clack/prompts` surface `auth` uses. Distinct from contract-create's
 * `PromptAdapter` (see the rewrite plan) -- auth needs `intro`/`note`/`outro` banners
 * that contract-create's narrower shape doesn't cover. `confirm` collapses clack's
 * cancel-symbol and explicit-"no" outcomes into a single `false`, matching the old
 * CLI's `isCancel(answer) || !answer` check -- both were already treated identically.
 */
export interface AuthPromptAdapter {
  readonly intro: (message: string) => void;
  readonly outro: (message: string) => void;
  readonly note: (message: string, title: string) => void;
  readonly confirm: (message: string, initialValue: boolean) => Promise<boolean>;
}

/** The login-completion prompt is always interactive regardless of `--yes` -- it is the
 * user's own signal that they finished logging in inside the opened browser, not a
 * "just confirm this" checkpoint `--yes` can pre-answer. Only the replacement
 * confirmation below is skippable. */
async function requireConfirmation(
  prompts: AuthPromptAdapter,
  message: string,
  assumeYes: boolean,
): Promise<void> {
  if (assumeYes) return;
  const confirmed = await prompts.confirm(message, true);
  if (!confirmed) throw new UsageError("Auth capture cancelled.");
}

/** The real login-capture step (real Playwright, real browser). Exposed as an
 * injectable dependency -- not module-mocked -- so tests exercise this file's own
 * validation/prompt-sequencing logic without ever touching a browser. */
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
  prompts: AuthPromptAdapter,
  runtime: CliRuntime,
  deps: AuthDependencies = defaultDependencies,
): Promise<void> {
  if (!httpUrlSchema.safeParse(options.url).success) {
    throw new UsageError("Auth URL must use http:// or https://.");
  }
  // Auth always persists Playwright storage state (session cookies) after opening
  // this URL -- a public-HTTP login page can be tampered with or observed on-path.
  assertSecureUrl(options.url, "Auth URL");
  const assumeYes = options.yes ?? false;
  const projectRoot = resolveProjectRoot(options.projectRoot, runtime);
  const config = await loadProjectConfig(projectRoot);
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
