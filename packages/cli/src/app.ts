import * as fs from "node:fs";

import { buildApplication, buildRouteMap, help, version } from "@stricli/core";

import { applicationText } from "./application-text.ts";
import { authCommand } from "./commands/auth.ts";
import { baselineRoutes } from "./commands/baseline.ts";
import { captureCommand } from "./commands/capture.ts";
import { checkCommand } from "./commands/check.ts";
import { compareCommand } from "./commands/compare.ts";
import { completionRoutes } from "./commands/completion.ts";
import { contractRoutes } from "./commands/contract.ts";
import { dashboardCommand, openCommand, reportCommand } from "./commands/dashboard.ts";
import { doneGateCommand } from "./commands/done-gate.ts";
import { initCommand } from "./commands/init.ts";
import { runsRoutes } from "./commands/runs.ts";
import { schemaCommand } from "./commands/schema.ts";
import { statusCommand } from "./commands/status.ts";
import { determineExitCode } from "./exit.ts";

export const PACKAGE_VERSION = (
  JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version: string;
  }
).version;

function buildFrameliaApplication(options: { readonly defaultToDashboard: boolean }) {
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
      runs: runsRoutes,
      completion: completionRoutes,
    },
    defaultCommand: options.defaultToDashboard ? "dashboard" : undefined,
    aliases: { "fetch-gold": "capture", diff: "compare" },
    docs: {
      brief: "CLI-first visual verification for Figma-to-web and web-to-web workflows.",
      fullDescription: [
        "CLI-first visual verification for Figma-to-web and web-to-web workflows.",
        "",
        "Finite commands print one JSON outcome on stdout and exit 0 (passed), 1 (visual",
        "mismatch) or 2 (usage/operational error); its `next` field names the follow-up.",
        "With no arguments, framelia lists durable runs (`framelia runs list`).",
        "",
        "Examples:",
        "  framelia init",
        "  framelia contract create",
        "  framelia check --all",
        "  framelia open --run <run-id>",
      ].join("\n"),
    },
  });

  return buildApplication(
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
}

/**
 * The `framelia` application: its route tree and Stricli configuration, without any process
 * wiring. Building it must stay free of `.env` loading and adapter work.
 */
export const app = buildFrameliaApplication({ defaultToDashboard: true });

/**
 * The same routes for `bash-complete.ts`, minus the default command. Stricli resolves a
 * partial first word to the default command, so with `dashboard` as the default, `framelia
 * co<TAB>` would propose only dashboard flags and never `contract`/`compare`/`completion`.
 */
export const completionApp = buildFrameliaApplication({ defaultToDashboard: false });
