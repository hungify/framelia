import * as fs from "node:fs";
import * as path from "node:path";

import {
  captureDefaultsSchema,
  DEFAULT_AUTH_STATE_PATH,
  type CaptureDefaults,
} from "@framelia/contracts";

import { assertSingleConfigFile, CONFIG_FILE_NAMES, findConfigFiles } from "../config.ts";
import { UsageError } from "../exit.ts";
import type { CliRuntime } from "../runtime-types.ts";
import { openProject } from "./project.ts";
import type { PromptAdapter } from "./prompts.ts";

const AUTH_GITIGNORE = "*\n!.gitignore\n";

const PLAYWRIGHT_CONFIG_NAMES = [
  "playwright.config.ts",
  "playwright.config.mts",
  "playwright.config.js",
  "playwright.config.mjs",
  "playwright.config.cts",
  "playwright.config.cjs",
] as const;

const PLAYWRIGHT_CONFIG_SOURCE = `import { defineConfig } from "@playwright/test";

export default defineConfig({
  reporter: [["list"], ["@framelia/playwright/reporter"]],
});
`;

const REPORTER_RECIPE = `Preserve every existing reporter and add:
reporter: [
  ...existingReporters,
  ["@framelia/playwright/reporter"],
]`;

interface ConfigToken {
  kind: "word" | "string" | "punctuation";
  value: string;
}

function tokenizeConfig(source: string): ConfigToken[] {
  const tokens: ConfigToken[] = [];
  let index = 0;
  while (index < source.length) {
    const character = source[index]!;
    if (/\s/u.test(character)) {
      index += 1;
      continue;
    }
    if (character === "/" && source[index + 1] === "/") {
      index = source.indexOf("\n", index + 2);
      if (index === -1) break;
      continue;
    }
    if (character === "/" && source[index + 1] === "*") {
      const end = source.indexOf("*/", index + 2);
      if (end === -1) break;
      index = end + 2;
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      const quote = character;
      let value = "";
      index += 1;
      while (index < source.length) {
        const next = source[index]!;
        if (next === "\\") {
          value += source[index + 1] ?? "";
          index += 2;
          continue;
        }
        if (next === quote) {
          index += 1;
          break;
        }
        value += next;
        index += 1;
      }
      tokens.push({ kind: "string", value });
      continue;
    }
    if (/[$A-Z_a-z]/u.test(character)) {
      const start = index;
      index += 1;
      while (index < source.length && /[$\w]/u.test(source[index]!)) index += 1;
      tokens.push({ kind: "word", value: source.slice(start, index) });
      continue;
    }
    tokens.push({ kind: "punctuation", value: character });
    index += 1;
  }
  return tokens;
}

function hasConfiguredReporter(source: string): boolean {
  const tokens = tokenizeConfig(source);
  for (let index = 0; index < tokens.length - 2; index += 1) {
    if (
      tokens[index]?.value !== "reporter" ||
      tokens[index + 1]?.value !== ":" ||
      tokens[index + 2]?.value !== "["
    ) {
      continue;
    }
    let depth = 0;
    for (let cursor = index + 2; cursor < tokens.length; cursor += 1) {
      const token = tokens[cursor]!;
      if (token.value === "[") depth += 1;
      if (
        token.kind === "string" &&
        token.value === "@framelia/playwright/reporter" &&
        (depth === 1 || depth === 2)
      ) {
        return true;
      }
      if (token.value === "]") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
  }
  return false;
}
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
  // playwright: {
  //   config: "playwright.config.ts",
  //   projects: ["chromium"],
  // },
  // contracts: [".framelia/contracts/**/visual-contract.json"],
  // retryAcceptance: "require-first-attempt",
  // envFile: ".env.e2e",
  // storageStatePath: "${DEFAULT_AUTH_STATE_PATH}",

  // Project-wide capture defaults:
${CONTRACT_DEFAULTS_COMMENT}
});
`;

export interface ProjectInitResult {
  readonly configPath: string;
  readonly authStatePath: string;
  readonly authGitignorePath: string;
  readonly playwrightConfigPath: string;
  readonly reporterRegistration: "configured" | "manual";
  readonly reporterInstructions?: string;
}

export interface ProjectInitOptions {
  readonly projectRoot: string | undefined;
  readonly force: boolean | undefined;
}

export function initializeProject(projectRoot: string, force = false): ProjectInitResult {
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
      `Multiple Playwright configs found: ${playwrightConfigs.map((entry) => path.basename(entry)).join(", ")}.`,
    );
  }
  const playwrightConfigPath = playwrightConfigs[0] ?? path.join(root, "playwright.config.ts");

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
  let reporterRegistration: ProjectInitResult["reporterRegistration"];
  let reporterInstructions: string | undefined;
  if (playwrightConfigs.length === 0) {
    fs.writeFileSync(playwrightConfigPath, PLAYWRIGHT_CONFIG_SOURCE, "utf8");
    reporterRegistration = "configured";
  } else if (hasConfiguredReporter(fs.readFileSync(playwrightConfigPath, "utf8"))) {
    reporterRegistration = "configured";
  } else {
    reporterRegistration = "manual";
    reporterInstructions = `${path.basename(playwrightConfigPath)} requires manual integration. ${REPORTER_RECIPE}`;
  }

  return {
    configPath,
    authStatePath,
    authGitignorePath,
    playwrightConfigPath,
    reporterRegistration,
    ...(reporterInstructions ? { reporterInstructions } : {}),
  };
}

export async function projectInitCommand(
  options: ProjectInitOptions,
  prompts: PromptAdapter,
  runtime: CliRuntime,
): Promise<void> {
  const project = openProject(options.projectRoot, runtime);
  prompts.intro("Initialize Framelia");
  let result: ProjectInitResult;
  try {
    result = initializeProject(project.root, options.force ?? false);
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
  prompts.note(
    [
      `Config: ${path.relative(project.root, result.configPath)}`,
      "Authenticated screens (optional):",
      `  save Playwright state to ${path.relative(project.root, result.authStatePath)}`,
      "  then uncomment storageStatePath in framelia.config.ts",
      "Auth state directory is ignored by Git.",
      `Playwright reporter: ${
        result.reporterRegistration === "configured"
          ? `configured in ${path.relative(project.root, result.playwrightConfigPath)}`
          : result.reporterInstructions
      }`,
      "",
      "Next: framelia contract create",
    ].join("\n"),
    "Project ready",
  );
  prompts.outro("Framelia initialized");
}
