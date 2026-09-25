import * as fs from "node:fs";
import { pathToFileURL } from "node:url";

import { loadProjectEnv } from "@framelia/verify/env";
import { discoverProjectConfig } from "@framelia/verify/project-policy";
import {
  buildApplication,
  buildRouteMap,
  help,
  run as runApplication,
  version,
} from "@stricli/core";

import { applicationText } from "./application-text.ts";
import { authCommand } from "./commands/auth.ts";
import { baselineRoutes } from "./commands/baseline.ts";
import { captureCommand } from "./commands/capture.ts";
import { checkCommand } from "./commands/check.ts";
import { compareCommand } from "./commands/compare.ts";
import { contractRoutes } from "./commands/contract.ts";
import { dashboardCommand, openCommand, reportCommand } from "./commands/dashboard.ts";
import { doneGateCommand } from "./commands/done-gate.ts";
import { initCommand } from "./commands/init.ts";
import { schemaCommand } from "./commands/schema.ts";
import { statusCommand } from "./commands/status.ts";
import { buildContext } from "./context.ts";
import { determineExitCode, normalizeStricliExitCode } from "./exit.ts";
import type { CliRuntime } from "./runtime-types.ts";

const PACKAGE_VERSION = (
  JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version: string;
  }
).version;

const rootRoutes = buildRouteMap({
  routes: {
    check: checkCommand,
    dashboard: dashboardCommand,
    open: openCommand,
    report: reportCommand,
    "done-gate": doneGateCommand,
    status: statusCommand,
    schema: schemaCommand,
    init: initCommand,
    auth: authCommand,
    contract: contractRoutes,
    baseline: baselineRoutes,
    capture: captureCommand,
    compare: compareCommand,
  },
  defaultCommand: "dashboard",
  aliases: { "fetch-gold": "capture", diff: "compare" },
  docs: {
    brief: "CLI-first visual verification for Figma-to-web and web-to-web workflows.",
    fullDescription:
      "CLI-first visual verification for Figma-to-web and web-to-web workflows.\n\nExample:\n  framelia contract create",
  },
});

const app = buildApplication(
  rootRoutes,
  {
    name: "framelia",
    scanner: { caseStyle: "allow-kebab-for-camel" },
    localization: { text: applicationText },
    determineExitCode,
  },
  {
    help: help({
      brief: "Print help for a command.",
      defaultForRouteMap: true,
      formatting: {
        useAliasInUsageLine: false,
        onlyRequiredInUsageLine: false,
        caseStyle: "convert-camel-to-kebab",
      },
    }),
    version: version({
      brief: "Print the current version.",
      alias: "V",
      info: { currentVersion: PACKAGE_VERSION },
    }),
  },
);

function explicitProjectRoot(argv: readonly string[]): string | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument.startsWith("--project-root=")) return argument.slice("--project-root=".length);
    if (argument === "--project-root" || argument === "-r") return argv[index + 1];
  }
  return undefined;
}

export async function run(
  argv: string[] = process.argv.slice(2),
  options: { process?: CliRuntime; loadProjectEnv?: boolean } = {},
): Promise<void> {
  const context = buildContext({ process: options.process, version: PACKAGE_VERSION });
  // Resolve the selected application root before reading any environment file. Loading
  // cwd first would let an unrelated parent/sibling .env permanently win over an
  // explicit --project-root because process environment has highest precedence.
  if (
    options.loadProjectEnv !== false &&
    argv[0] !== "done-gate" &&
    !argv.includes("--help") &&
    !argv.includes("--version") &&
    !argv.includes("-V")
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
