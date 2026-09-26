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
    brief: "do not open dashboard in browser",
  },
} as const;

export const dashboardCommand = buildCommand({
  loader: async () => {
    // Stricli's loader is the intentional lazy boundary; dashboard-server is startup-heavy.
    const { dashboardDevserverCommand } = await import("../internal/dashboard-devserver.ts");
    return function (this: CliContext, flags: DashboardOptions) {
      return dashboardDevserverCommand({ ...flags, command: "dashboard" }, this.process);
    };
  },
  parameters: {
    flags: {
      run: {
        kind: "parsed",
        parse: identityParser,
        brief: "explicit durable run ID",
        placeholder: "id",
      },
      projectRoot: projectRootFlag,
      ...dashboardServerFlags,
    },
    aliases: { r: "projectRoot", R: "run", H: "host", p: "port", o: "noOpen" },
  },
  docs: { brief: "Open dashboard for one selected durable run." },
});

export const openCommand = buildCommand({
  loader: async () => {
    // Stricli's loader is the intentional lazy boundary; dashboard-server is startup-heavy.
    const { dashboardDevserverCommand } = await import("../internal/dashboard-devserver.ts");
    return function (this: CliContext, flags: OpenDashboardOptions) {
      return dashboardDevserverCommand({ ...flags, command: "open" }, this.process);
    };
  },
  parameters: {
    flags: {
      projectRoot: projectRootFlag,
      run: {
        kind: "parsed",
        parse: identityParser,
        brief: "explicit durable run ID",
        placeholder: "id",
      },
      ...dashboardServerFlags,
    },
    aliases: { r: "projectRoot", R: "run", H: "host", p: "port", o: "noOpen" },
  },
  docs: { brief: "Open dashboard for one selected durable run." },
});

export const reportCommand = buildCommand({
  loader: async () => {
    // Stricli's loader is the intentional lazy boundary; report projection is startup-heavy.
    const { reportCommand: runReportCommand } = await import("../internal/dashboard-report.ts");
    return async function (this: CliContext, flags: ReportOptions) {
      emitResult(this, await runReportCommand(flags, this.process));
    };
  },
  parameters: {
    flags: {
      projectRoot: projectRootFlag,
      // Deliberately parser-optional: finite commands own missing semantic input so
      // automation receives one versioned JSON outcome instead of Stricli stderr.
      run: {
        kind: "parsed",
        parse: identityParser,
        brief: "explicit durable run ID",
        optional: true,
        placeholder: "id",
      },
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
  docs: { brief: "Export one selected durable run as a static dashboard report." },
});
