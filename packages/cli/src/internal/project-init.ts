import * as fs from "node:fs";
import * as path from "node:path";

import { DEFAULT_AUTH_STATE_PATH } from "@framelia/contracts";
import { writeFileAtomic } from "@framelia/verify";

import { assertSingleConfigFile, CONFIG_FILE_NAMES, findConfigFiles } from "../config.ts";
import type { CliResult } from "../output.ts";
import type { CliRuntime } from "../runtime-types.ts";
import { openProject } from "./project.ts";
import type { PromptAdapter } from "./prompts.ts";

const INIT_OUTCOME_FORMAT_VERSION = 1 as const;
const AUTH_GITIGNORE = "*\n!.gitignore\n";
const CONTRACT_PATTERN = ".framelia/contracts/**/visual-contract.json";

const PLAYWRIGHT_CONFIG_NAMES = [
  "playwright.config.ts",
  "playwright.config.mts",
  "playwright.config.cts",
  "playwright.config.js",
  "playwright.config.mjs",
  "playwright.config.cjs",
] as const;

const PLAYWRIGHT_CONFIG_SOURCE = `import { defineConfig } from "@playwright/test";

export default defineConfig({
  reporter: [["list"], ["@framelia/playwright/reporter"]],
});
`;

const REPORTER_RECIPE =
  'In the existing Playwright config export, verify reporter includes ["@framelia/playwright/reporter"] as one entry beside every current reporter. If absent, add exactly that entry; do not replace, reorder, or change existing reporters, projects, fixtures, use, or webServer. Then declare the exact visual project names in framelia.config (use [""] only for Playwright\'s unnamed project).';

export type InitChangeAction = "create" | "unchanged" | "manual";

export interface InitChange {
  readonly path: string;
  readonly action: InitChangeAction;
  readonly reason: string;
  readonly content?: string;
}

export interface ProjectInitPlan {
  readonly root: string;
  readonly changes: readonly InitChange[];
  readonly configPath: string;
  readonly authStatePath: string;
  readonly authGitignorePath: string;
  readonly playwrightConfigPath: string;
  readonly reporterRegistration: "configured" | "manual";
  readonly reporterInstructions?: string;
}

export interface ProjectInitResult {
  readonly configPath: string;
  readonly authStatePath: string;
  readonly authGitignorePath: string;
  readonly playwrightConfigPath: string;
  readonly reporterRegistration: "configured" | "manual";
  readonly reporterInstructions?: string;
  readonly changes: readonly InitChange[];
}

export interface ProjectInitOptions {
  readonly projectRoot: string | undefined;
  readonly dryRun?: boolean;
  /** Retained as a safe compatibility flag. It never overwrites existing configuration. */
  readonly force: boolean | undefined;
}

function configSource(playwrightConfigName: string | undefined): string {
  const playwright = playwrightConfigName
    ? `  playwright: { config: ${JSON.stringify(playwrightConfigName)}, projects: [""] },\n`
    : "";
  return `import { defineConfig } from "framelia";

export default defineConfig({
${playwright}  contracts: [${JSON.stringify(CONTRACT_PATTERN)}],
});
`;
}

export function planProjectInitialization(projectRoot: string): ProjectInitPlan {
  const root = path.resolve(projectRoot);
  const existingConfigPaths = findConfigFiles(root);
  assertSingleConfigFile(existingConfigPaths);
  const configPath = existingConfigPaths[0] ?? path.join(root, CONFIG_FILE_NAMES[0]);
  const authStatePath = path.join(root, DEFAULT_AUTH_STATE_PATH);
  const authGitignorePath = path.join(path.dirname(authStatePath), ".gitignore");
  const playwrightConfigs = PLAYWRIGHT_CONFIG_NAMES.map((name) => path.join(root, name)).filter(
    (candidate) => fs.existsSync(candidate),
  );
  if (playwrightConfigs.length > 1) {
    throw new Error(
      `Multiple Playwright configs found: ${playwrightConfigs.map((entry) => path.basename(entry)).join(", ")}. Keep exactly one before running init.`,
    );
  }
  const existingPlaywright = playwrightConfigs[0];
  const playwrightConfigPath = existingPlaywright ?? path.join(root, "playwright.config.ts");
  const changes: InitChange[] = [];

  if (existingConfigPaths.length === 0) {
    changes.push({
      path: path.relative(root, configPath),
      action: "create",
      reason: "Framelia project policy is absent.",
      content: configSource(existingPlaywright ? undefined : path.basename(playwrightConfigPath)),
    });
  } else {
    changes.push({
      path: path.relative(root, configPath),
      action: "unchanged",
      reason: "Existing Framelia policy is preserved byte-for-byte.",
    });
  }

  if (fs.existsSync(authGitignorePath)) {
    changes.push({
      path: path.relative(root, authGitignorePath),
      action: "unchanged",
      reason: "Existing auth-state ignore policy is preserved byte-for-byte.",
    });
  } else {
    changes.push({
      path: path.relative(root, authGitignorePath),
      action: "create",
      reason: "Keep generated browser storage state out of version control.",
      content: AUTH_GITIGNORE,
    });
  }

  let reporterRegistration: ProjectInitPlan["reporterRegistration"];
  let reporterInstructions: string | undefined;
  if (existingPlaywright) {
    reporterRegistration = "manual";
    reporterInstructions = `${path.basename(existingPlaywright)} remains byte-for-byte unchanged. ${REPORTER_RECIPE}`;
    changes.push({
      path: path.relative(root, existingPlaywright),
      action: "manual",
      reason: reporterInstructions,
    });
  } else {
    reporterRegistration = "configured";
    changes.push({
      path: path.relative(root, playwrightConfigPath),
      action: "create",
      reason:
        "No Playwright config exists; create a minimal unnamed-project config with both reporters.",
      content: PLAYWRIGHT_CONFIG_SOURCE,
    });
  }

  return {
    root,
    changes,
    configPath,
    authStatePath,
    authGitignorePath,
    playwrightConfigPath,
    reporterRegistration,
    ...(reporterInstructions ? { reporterInstructions } : {}),
  };
}

export function applyProjectInitialization(plan: ProjectInitPlan): ProjectInitResult {
  for (const change of plan.changes) {
    if (change.action !== "create" || change.content === undefined) continue;
    const target = path.resolve(plan.root, change.path);
    if (fs.existsSync(target)) continue;
    writeFileAtomic(target, change.content);
  }
  return {
    configPath: plan.configPath,
    authStatePath: plan.authStatePath,
    authGitignorePath: plan.authGitignorePath,
    playwrightConfigPath: plan.playwrightConfigPath,
    reporterRegistration: plan.reporterRegistration,
    ...(plan.reporterInstructions ? { reporterInstructions: plan.reporterInstructions } : {}),
    changes: plan.changes,
  };
}

/** Compatibility API now performs the same non-destructive idempotent plan regardless of force. */
export function initializeProject(projectRoot: string, _force = false): ProjectInitResult {
  return applyProjectInitialization(planProjectInitialization(projectRoot));
}

export interface ProjectInitOutcome {
  readonly formatVersion: typeof INIT_OUTCOME_FORMAT_VERSION;
  readonly kind: "framelia.init-outcome";
  readonly command: "init";
  readonly executionState: "completed" | "error";
  readonly exitCode: 0 | 2;
  readonly dryRun: boolean;
  readonly projectRoot: string;
  readonly changes: readonly Omit<InitChange, "content">[];
  readonly reporter?: {
    status: "configured" | "manual";
    configPath: string;
    instructions?: string;
  };
  readonly diagnostics: readonly { code: string; stage: string; message: string }[];
  readonly next?: { command: string; argv: string[] };
}

export async function projectInitCommand(
  options: ProjectInitOptions,
  prompts: PromptAdapter,
  runtime: CliRuntime,
): Promise<CliResult<ProjectInitOutcome>> {
  prompts.intro("Initialize Framelia");
  try {
    const project = openProject(options.projectRoot, runtime);
    const plan = planProjectInitialization(project.root);
    if (!options.dryRun) applyProjectInitialization(plan);
    const changes = plan.changes.map(({ content: _content, ...change }) => change);
    const configPath = path
      .relative(plan.root, plan.playwrightConfigPath)
      .split(path.sep)
      .join("/");
    const body: ProjectInitOutcome = {
      formatVersion: INIT_OUTCOME_FORMAT_VERSION,
      kind: "framelia.init-outcome",
      command: "init",
      executionState: "completed",
      exitCode: 0,
      dryRun: options.dryRun ?? false,
      projectRoot: ".",
      changes,
      reporter: {
        status: plan.reporterRegistration,
        configPath,
        ...(plan.reporterInstructions ? { instructions: plan.reporterInstructions } : {}),
      },
      diagnostics: [],
      next:
        plan.reporterRegistration === "manual"
          ? {
              command: "framelia",
              argv: [
                "init",
                "--dry-run",
                ...(options.projectRoot ? ["--project-root", options.projectRoot] : []),
              ],
            }
          : {
              command: "framelia",
              argv: [
                "contract",
                "create",
                ...(options.projectRoot ? ["--project-root", options.projectRoot] : []),
              ],
            },
    };
    prompts.note(
      changes.map((change) => `${change.action}: ${change.path}`).join("\n"),
      options.dryRun ? "Initialization plan" : "Project initialized",
    );
    prompts.outro(
      options.dryRun ? "Dry run complete; no files were written." : "Framelia initialized",
    );
    return { ok: true, exitCode: 0, body };
  } catch (error) {
    return {
      ok: false,
      exitCode: 2,
      body: {
        formatVersion: INIT_OUTCOME_FORMAT_VERSION,
        kind: "framelia.init-outcome",
        command: "init",
        executionState: "error",
        exitCode: 2,
        dryRun: options.dryRun ?? false,
        projectRoot: ".",
        changes: [],
        diagnostics: [
          {
            code: "INIT_FAILED",
            stage: "init",
            message: error instanceof Error ? error.message : String(error),
          },
        ],
      },
    };
  }
}
