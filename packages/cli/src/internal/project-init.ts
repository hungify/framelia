import * as fs from "node:fs";
import * as path from "node:path";

import * as p from "@clack/prompts";
import {
  captureDefaultsSchema,
  DEFAULT_AUTH_STATE_PATH,
  type CaptureDefaults,
} from "@framelia/contracts";

import { assertSingleConfigFile, CONFIG_FILE_NAMES, findConfigFiles } from "../config.ts";
import { UsageError } from "../errors.ts";
import type { CliRuntime } from "../runtime-types.ts";

const AUTH_GITIGNORE = "*\n!.gitignore\n";

/**
 * One illustrative literal per CaptureDefaults field, rendered into the scaffolded
 * config's commented example block. Typed as Record<keyof CaptureDefaults, string> so
 * adding a field to captureDefaultsSchema without adding an example here is a compile
 * error, not a silently stale `framelia init` template.
 */
const CONTRACT_DEFAULT_EXAMPLES: Record<keyof CaptureDefaults, string> = {
  stabilitySamples: "3",
  timeoutMs: "60_000",
  devtoolsSelector: "true",
  deviceScaleFactor: "1",
  fontPolicy: '"required"',
  animationPolicy: '"freeze"',
  retry: "{ attempts: 2, delayMs: 1_000 }",
  maxMaskedAreaRatio: "0.15",
};

const CONTRACT_DEFAULTS_COMMENT = captureDefaultsSchema
  .keyof()
  .options.map((key) => `  // ${key}: ${CONTRACT_DEFAULT_EXAMPLES[key]},`)
  .join("\n");

const CONFIG_SOURCE = `import { defineConfig } from "framelia";

export default defineConfig({
  // envFile: ".env.playwright",
  // storageStatePath: "${DEFAULT_AUTH_STATE_PATH}",

  // Project-wide capture defaults:
${CONTRACT_DEFAULTS_COMMENT}
});
`;

export interface ProjectInitResult {
  readonly configPath: string;
  readonly authStatePath: string;
  readonly authGitignorePath: string;
}

export interface ProjectInitOptions {
  readonly projectRoot: string | undefined;
  readonly force: boolean | undefined;
}

/**
 * Library-facing scaffold step: throws an ordinary `Error` on ambiguous/existing
 * config (see `../config.ts`'s `assertSingleConfigFile`), not `UsageError` --
 * that reclassification happens only in `projectInitCommand` below, the CLI
 * adapter boundary, per the plan's Phase 5 instruction.
 */
export function initializeProject(projectRoot: string, force = false): ProjectInitResult {
  const root = path.resolve(projectRoot);
  const existingConfigPaths = findConfigFiles(root);
  assertSingleConfigFile(existingConfigPaths);
  const configPath = existingConfigPaths[0] ?? path.join(root, CONFIG_FILE_NAMES[0]);
  const authStatePath = path.join(root, DEFAULT_AUTH_STATE_PATH);
  const authGitignorePath = path.join(path.dirname(authStatePath), ".gitignore");

  if (existingConfigPaths.length === 1 && !force) {
    throw new Error(
      `Refusing to overwrite existing file: ${configPath}. Pass --force to replace it.`,
    );
  }

  fs.mkdirSync(path.dirname(authStatePath), { recursive: true });
  fs.writeFileSync(configPath, CONFIG_SOURCE, "utf8");
  if (!fs.existsSync(authGitignorePath)) {
    fs.writeFileSync(authGitignorePath, AUTH_GITIGNORE, "utf8");
  }

  return { configPath, authStatePath, authGitignorePath };
}

/**
 * `framelia init`. No cancellation prompt today -- `p.intro` is written before
 * the scaffold step runs (and before it can throw), matching the old CLI's
 * exact output ordering.
 */
export async function projectInitCommand(
  options: ProjectInitOptions,
  runtime: CliRuntime,
): Promise<void> {
  const root = path.resolve(options.projectRoot ?? runtime.cwd());
  p.intro("Initialize Framelia");
  let result: ProjectInitResult;
  try {
    result = initializeProject(root, options.force ?? false);
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
  p.note(
    [
      `Config: ${path.relative(root, result.configPath)}`,
      "Authenticated screens (optional):",
      `  save Playwright state to ${path.relative(root, result.authStatePath)}`,
      "  then uncomment storageStatePath in framelia.config.ts",
      "Auth state directory is ignored by Git.",
      "",
      "Next: framelia contract create",
    ].join("\n"),
    "Project ready",
  );
  p.outro("Framelia initialized");
}
