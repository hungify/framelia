import { DEFAULT_DASHBOARD_PORT } from "@framelia/dashboard-server/constants";
import { buildCommand, numberParser } from "@stricli/core";

import { identityParser, projectRootFlag } from "../cli-constants.ts";
import type { CliContext } from "../context.ts";
import type { DashboardOptions, OpenDashboardOptions } from "../internal/dashboard-devserver.ts";
import type { ReportOptions } from "../internal/dashboard-report.ts";
import { emitResult } from "../output.ts";

const dashboardServerFlags = {
  host: {
    kind: "parsed",
    parse: identityParser,
    optional: true,
    inferEmpty: true,
    brief: "host to bind (bare flag binds every interface)",
    placeholder: "host",
  },
  port: {
    kind: "parsed",
    parse: numberParser,
    default: String(DEFAULT_DASHBOARD_PORT),
    brief: "port to bind",
    placeholder: "port",
  },
  noOpen: {
    kind: "boolean",
    default: false,
    withNegated: false,
    brief: "do not open dashboard in browser (never opened when CI is set)",
  },
} as const;

// Deliberately parser-optional: a missing run is one structured JSON outcome pointing at
// `framelia runs list`, not a Stricli usage error on stderr.
const runFlag = {
  kind: "parsed",
  parse: identityParser,
  optional: true,
  brief: "explicit durable run ID (see `framelia runs list`)",
  placeholder: "id",
} as const;

const dashboardAliases = { r: "projectRoot", R: "run" } as const;

export const dashboardCommand = buildCommand({
  loader: async () => {
    // Stricli's loader is the intentional lazy boundary; dashboard-server is startup-heavy.
    const { dashboardDevserverCommand } = await import("../internal/dashboard-devserver.ts");
    return function (this: CliContext, flags: DashboardOptions) {
      return dashboardDevserverCommand({ ...flags, command: "dashboard" }, this);
    };
  },
  parameters: {
    flags: { run: runFlag, projectRoot: projectRootFlag, ...dashboardServerFlags },
    aliases: dashboardAliases,
  },
  docs: {
    brief: "Serve the dashboard for one selected durable run.",
    fullDescription: [
      "Serve the dashboard for one selected durable run until Ctrl+C.",
      "",
      "Once listening it writes one framelia.open-ready JSON record to stdout; logs go to",
      "stderr. A browser opens unless --no-open is passed or CI is set.",
      "",
      "Examples:",
      "  framelia runs list",
      "  framelia dashboard --run <run-id>",
      "  framelia dashboard --run <run-id> --host --port 4000 --no-open",
    ].join("\n"),
  },
});

export const openCommand = buildCommand({
  loader: async () => {
    // Stricli's loader is the intentional lazy boundary; dashboard-server is startup-heavy.
    const { dashboardDevserverCommand } = await import("../internal/dashboard-devserver.ts");
    return function (this: CliContext, flags: OpenDashboardOptions) {
      return dashboardDevserverCommand({ ...flags, command: "open" }, this);
    };
  },
  parameters: {
    flags: { projectRoot: projectRootFlag, run: runFlag, ...dashboardServerFlags },
    aliases: dashboardAliases,
  },
  docs: {
    brief: "Open the dashboard for one selected durable run without rerunning it.",
    fullDescription: [
      "Open the dashboard for one selected durable run without rerunning it.",
      "",
      "Examples:",
      "  framelia open --run <run-id>",
      "  framelia open --run <run-id> --no-open",
    ].join("\n"),
  },
});

export const reportCommand = buildCommand({
  loader: async () => {
    // Stricli's loader is the intentional lazy boundary; report projection is startup-heavy.
    const { reportCommand: runReportCommand } = await import("../internal/dashboard-report.ts");
    return async function (this: CliContext, flags: ReportOptions) {
      emitResult(this, await runReportCommand(flags, this));
    };
  },
  parameters: {
    flags: {
      projectRoot: projectRootFlag,
      // Deliberately parser-optional: finite commands own missing semantic input so
      // automation receives one versioned JSON outcome instead of Stricli stderr.
      run: runFlag,
      // See --run above. reportCommand validates the required pair together.
      output: {
        kind: "parsed",
        parse: identityParser,
        brief: "empty report output directory",
        optional: true,
        placeholder: "dir",
      },
    },
    aliases: { r: "projectRoot", R: "run", o: "output" },
  },
  docs: {
    brief: "Export one selected durable run as a static dashboard report.",
    fullDescription: [
      "Export one selected durable run as a relocatable static dashboard report.",
      "",
      "An existing previous Framelia report directory is replaced only after the new report",
      "is complete. Serve the output over HTTP; browsers block file:// JSON loading.",
      "",
      "Example:",
      "  framelia report --run <run-id> --output ./framelia-report",
    ].join("\n"),
  },
});
