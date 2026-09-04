import * as fs from "node:fs";
import { pathToFileURL } from "node:url";

import { loadProjectEnv } from "@framelia/verify";
import {
  buildApplication,
  buildRouteMap,
  help,
  run as runApplication,
  version,
} from "@stricli/core";

import { applicationText, normalizeStricliExitCode } from "./application-text.ts";
import { authCommand } from "./commands/auth.ts";
import { baselineRoutes } from "./commands/baseline.ts";
import { captureCommand } from "./commands/capture.ts";
import { compareCommand } from "./commands/compare.ts";
import { contractRoutes } from "./commands/contract.ts";
import { dashboardCommand, openCommand, reportCommand } from "./commands/dashboard.ts";
import { doneGateCommand } from "./commands/done-gate.ts";
import { initCommand } from "./commands/init.ts";
import { schemaCommand } from "./commands/schema.ts";
import { statusCommand } from "./commands/status.ts";
import { type CliProcess, buildContext } from "./context.ts";
import { UsageError } from "./errors.ts";

const PACKAGE_VERSION = (
  JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version: string;
  }
).version;

const rootRoutes = buildRouteMap({
  routes: {
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
    determineExitCode: (exc) => (exc instanceof UsageError ? exc.exitCode : 2),
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

export async function run(
  argv: string[] = process.argv.slice(2),
  options: { process?: CliProcess; loadProjectEnv?: boolean } = {},
): Promise<void> {
  if (options.loadProjectEnv !== false) loadProjectEnv();
  const context = buildContext({ process: options.process, version: PACKAGE_VERSION });
  await runApplication(app, argv, context);
  context.process.exitCode = normalizeStricliExitCode(context.process.exitCode);
}

const isMain = process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) void run();
