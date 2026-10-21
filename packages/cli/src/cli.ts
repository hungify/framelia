import { pathToFileURL } from "node:url";

import { loadProjectEnv } from "@framelia/verify/env";
import { discoverProjectConfig } from "@framelia/verify/project-policy";
import { run as runApplication } from "@stricli/core";

import { app, PACKAGE_VERSION } from "./app.ts";
import { buildContext } from "./context.ts";
import type { CliAdapters, EnvironmentOverrides } from "./environment.ts";
import { normalizeStricliExitCode } from "./exit.ts";
import type { CliRuntime } from "./runtime-types.ts";

/**
 * Routes that must never see the project's .env: done-gate's trust inputs (signing key path,
 * job identity, audience) have to come from the protected job runtime, not the project, and
 * completion edits the user's shell profile, which no project setting may steer.
 */
const ROUTES_WITHOUT_PROJECT_ENV = new Set(["done-gate", "completion"]);

const HELP_FLAGS = new Set(["--help", "-h", "--help-all", "--version", "-V"]);

/** Bare `framelia` lists durable runs: the one useful, side-effect-free starting point. */
const BARE_INVOCATION = ["runs", "list"];

function explicitProjectRoot(argv: readonly string[]): string | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument.startsWith("--project-root=")) return argument.slice("--project-root=".length);
    if (argument === "--project-root" || argument === "-r") return argv[index + 1];
  }
  return undefined;
}

export async function run(
  rawArgv: string[] = process.argv.slice(2),
  options: {
    process?: CliRuntime;
    loadProjectEnv?: boolean;
    adapters?: Partial<CliAdapters>;
    overrides?: EnvironmentOverrides;
  } = {},
): Promise<void> {
  const argv = rawArgv.length === 0 ? BARE_INVOCATION : rawArgv;
  const context = buildContext({
    process: options.process,
    version: PACKAGE_VERSION,
    ...(options.adapters ? { adapters: options.adapters } : {}),
    ...(options.overrides ? { overrides: options.overrides } : {}),
  });
  // Resolve the selected application root before reading any environment file. Loading
  // cwd first would let an unrelated parent/sibling .env permanently win over an
  // explicit --project-root because process environment has highest precedence.
  if (
    options.loadProjectEnv !== false &&
    !ROUTES_WITHOUT_PROJECT_ENV.has(argv[0] ?? "") &&
    !argv.some((argument) => HELP_FLAGS.has(argument))
  ) {
    let root: string | undefined;
    try {
      root = discoverProjectConfig(context.process.cwd(), explicitProjectRoot(argv)).root;
    } catch {
      // Discovery is repeated by the routed command, which owns its structured error
      // shape. Preloading must not reject before that route can emit the outcome.
    }
    if (root) loadProjectEnv(root, { env: context.process.env });
  }
  await runApplication(app, argv, context);
  context.process.exitCode = normalizeStricliExitCode(context.process.exitCode);
}

const isMain = process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) void run();
