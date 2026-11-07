import * as fs from "node:fs";
import * as path from "node:path";

import { DEFAULT_AUTH_STATE_PATH } from "@framelia/contracts";
import { writeFileAtomic } from "@framelia/verify";

import { assertSingleConfigFile, CONFIG_FILE_NAMES, findConfigFiles } from "../config.ts";
import type { CommandEnvironment } from "../environment.ts";
import type { CliResult } from "../output.ts";
import { failureOutcome, frameliaNext } from "./outcome.ts";
import { openProject } from "./project.ts";

const INIT_OUTCOME_FORMAT_VERSION = 1 as const;
/** Ignores everything in its directory except itself: auth state and run bundles stay local. */
const SELF_ONLY_GITIGNORE = "*\n!.gitignore\n";
const RUNS_GITIGNORE_PATH = ".framelia/runs/.gitignore";
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
  /** False when an existing Playwright config's project names could not be read. */
  readonly playwrightProjectsDetected: boolean;
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

/**
 * Best-effort, read-only guess at an existing Playwright config's project names: no `projects`
 * key means Playwright's single unnamed project (`""`); literal `name: "..."` entries after it
 * are its named projects. `undefined` means the names could not be read from the source.
 */
export function detectPlaywrightProjects(source: string): string[] | undefined {
  const projectsAt = source.search(/\bprojects\s*:/u);
  if (projectsAt === -1) return [""];
  const names = [...source.slice(projectsAt).matchAll(/\bname\s*:\s*(["'`])([^"'`\n]+)\1/gu)].map(
    (match) => match[2]!,
  );
  return names.length > 0 ? [...new Set(names)] : undefined;
}

function configSource(
  playwrightConfigName: string,
  projects: readonly string[] | undefined,
): string {
  const projectList = projects
    ? `[${projects.map((name) => JSON.stringify(name)).join(", ")}]`
    : '[/* TODO: the exact visual Playwright project names, e.g. "chromium" */]';
  const note = projects
    ? ""
    : "  // Fill in projects before `framelia check`; an empty list is rejected.\n";
  return `import { defineConfig } from "framelia";

export default defineConfig({
${note}  playwright: { config: ${JSON.stringify(playwrightConfigName)}, projects: ${projectList} },
  contracts: [${JSON.stringify(CONTRACT_PATTERN)}],
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
  const playwrightProjects = existingPlaywright
    ? detectPlaywrightProjects(fs.readFileSync(existingPlaywright, "utf8"))
    : [""];

  if (existingConfigPaths.length === 0) {
    changes.push({
      path: path.relative(root, configPath),
      action: "create",
      reason: playwrightProjects
        ? "Framelia project policy is absent."
        : "Framelia project policy is absent; fill in the visual Playwright project names it marks TODO.",
      content: configSource(path.basename(playwrightConfigPath), playwrightProjects),
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
      content: SELF_ONLY_GITIGNORE,
    });
  }

  const runsGitignorePath = path.join(root, RUNS_GITIGNORE_PATH);
  if (fs.existsSync(runsGitignorePath)) {
    changes.push({
      path: path.relative(root, runsGitignorePath),
      action: "unchanged",
      reason: "Existing run-bundle ignore policy is preserved byte-for-byte.",
    });
  } else {
    changes.push({
      path: path.relative(root, runsGitignorePath),
      action: "create",
      reason: "Keep durable run bundles (screenshots, diffs) out of version control.",
      content: SELF_ONLY_GITIGNORE,
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
    playwrightProjectsDetected: playwrightProjects !== undefined,
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
  env: CommandEnvironment,
): Promise<CliResult<ProjectInitOutcome>> {
  const runtime = env.process;
  const prompts = await env.adapters.prompts(runtime);
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
      next: frameliaNext(initNext(plan), options.projectRoot),
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
    const failure = failureOutcome({
      kind: "framelia.init-outcome",
      command: "init",
      error,
      fallbackCode: "INIT_FAILED",
      stage: "init",
      projectRoot: options.projectRoot,
    });
    const { next: _next, ...body } = failure.body;
    // Re-running init cannot repair what init itself rejected; only other follow-ups apply.
    const next = _next && _next.argv[0] !== "init" ? _next : undefined;
    return {
      ...failure,
      body: {
        ...body,
        dryRun: options.dryRun ?? false,
        projectRoot: ".",
        changes: [],
        ...(next ? { next } : {}),
      },
    };
  }
}

/**
 * What follows init: a fresh project authors its first contract; an existing Playwright
 * config is checked by `contract list` once its reporter recipe is applied; undetected
 * project names must first be filled in (`status` re-validates the config).
 */
function initNext(plan: ProjectInitPlan): string[] {
  if (!plan.playwrightProjectsDetected) return ["status"];
  return plan.reporterRegistration === "manual" ? ["contract", "list"] : ["contract", "create"];
}
