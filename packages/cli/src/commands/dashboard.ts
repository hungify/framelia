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
      return dashboardDevserverCommand(flags, this.process);
    };
  },
  parameters: {
    flags: {
      projectRoot: projectRootFlag,
      ...dashboardServerFlags,
    },
    aliases: { r: "projectRoot", H: "host", p: "port", o: "noOpen" },
  },
  docs: { brief: "Open dashboard aggregating every verification artifact." },
});

export const openCommand = buildCommand({
  loader: async () => {
    // Stricli's loader is the intentional lazy boundary; dashboard-server is startup-heavy.
    const { dashboardDevserverCommand } = await import("../internal/dashboard-devserver.ts");
    return function (this: CliContext, flags: OpenDashboardOptions) {
      return dashboardDevserverCommand(flags, this.process);
    };
  },
  parameters: {
    flags: {
      artifact: {
        kind: "parsed",
        parse: identityParser,
        brief: "verification artifact JSON",
        placeholder: "path",
      },
      ...dashboardServerFlags,
    },
    aliases: { a: "artifact", H: "host", p: "port", o: "noOpen" },
  },
  docs: { brief: "Open dashboard for an existing verification artifact." },
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
      artifact: {
        kind: "parsed",
        parse: identityParser,
        brief: "verification artifact JSON",
        placeholder: "path",
      },
      output: {
        kind: "parsed",
        parse: identityParser,
        brief: "empty report output directory",
        placeholder: "dir",
      },
    },
    aliases: { a: "artifact", o: "output" },
  },
  docs: { brief: "Export a static dashboard report." },
});
