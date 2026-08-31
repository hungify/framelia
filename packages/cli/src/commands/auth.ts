import * as fs from "node:fs";

import * as p from "@clack/prompts";
import { httpUrlSchema } from "@framelia/contracts";
import { recordStorageState } from "@framelia/verify/cli";
import type { Command } from "commander";

import { loadFrameliaConfig } from "../config.ts";
import { resolveProjectRoot, subcommand } from "./shared.ts";

interface AuthOptions {
  url: string;
  projectRoot?: string;
  yes?: boolean;
}

function validateHttpUrl(value: string): void {
  if (!httpUrlSchema.safeParse(value).success) {
    throw new Error("Auth URL must use http:// or https://.");
  }
}

/** --yes only bypasses the existing-state replacement confirmation. The login
 * completion prompt stays interactive regardless -- it is the user's own signal
 * that they finished logging in inside the opened browser, not a "just confirm
 * this" checkpoint assumeYes can pre-answer. */
async function confirm(message: string, assumeYes: boolean): Promise<void> {
  if (assumeYes) return;
  const answer = await p.confirm({ message, initialValue: true });
  if (p.isCancel(answer) || !answer) throw new Error("Auth capture cancelled.");
}

export async function authCommand(options: AuthOptions): Promise<void> {
  validateHttpUrl(options.url);
  const assumeYes = options.yes ?? false;
  const projectRoot = resolveProjectRoot(options.projectRoot);
  const config = await loadFrameliaConfig(projectRoot);
  if (!config.resolvedStorageStatePath) {
    throw new Error(
      "storageStatePath is not configured. Uncomment it in framelia.config.ts before running framelia auth.",
    );
  }

  p.intro("Record Playwright login state");
  if (fs.existsSync(config.resolvedStorageStatePath)) {
    await confirm(`Replace existing auth state at ${config.storageStatePath}?`, assumeYes);
  }

  const result = await recordStorageState({
    url: options.url,
    outputPath: config.resolvedStorageStatePath,
    waitForUser: () => confirm("Finish login in browser, then save session?", false),
  });
  p.note(
    [
      `Final URL: ${result.finalUrl}`,
      `Saved: ${config.storageStatePath}`,
      "Session file remains ignored by Git.",
    ].join("\n"),
    "Auth ready",
  );
  p.outro("Use target.auth=storageState for protected screens.");
}

export function registerAuthCommand(program: Command): void {
  program.addCommand(
    subcommand("auth", "Open Playwright for login and save browser session state.")
      .requiredOption("--url <url>", "login URL")
      .option("--project-root <dir>", "target project root")
      .option("--yes", "skip existing auth-state replacement confirmation")
      .action(authCommand),
  );
}
