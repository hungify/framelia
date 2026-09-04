import { buildCommand, numberParser } from "@stricli/core";

import { DEFAULT_DASHBOARD_PORT, identityParser, projectRootFlag } from "../cli-constants.ts";
import type { CliContext } from "../context.ts";
import { emitResult } from "../output.ts";

/**
 * `--host [host]` (bare flag binds all interfaces): Commander's optional-value flag has
 * no exact single-line Stricli equivalent, so this is declared with no default and
 * `inferEmpty: true` (a bare `--host` scans as `""`); the adapter distinguishes "flag
 * never given" (`undefined`, default to "localhost") from "flag given bare" (`""`,
 * resolved to "0.0.0.0" here) from "flag given a value" (passed through as-is).
 */
function parseHost(input: string): string {
  return input === "" ? "0.0.0.0" : input;
}

function resolveHost(host: string | undefined): { host: string; hostExplicit: boolean } {
  return { host: host ?? "localhost", hostExplicit: host !== undefined };
}

const dashboardServerFlags = {
  host: {
    kind: "parsed",
    parse: parseHost,
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

interface DashboardFlags {
  readonly projectRoot: string | undefined;
  readonly host: string | undefined;
  readonly port: number;
  readonly noOpen: boolean;
}

export const dashboardCommand = buildCommand({
  loader: async () => {
    const { runAggregatedDashboardCommand } = await import("../internal/dashboard-devserver.ts");
    return function (this: CliContext, flags: DashboardFlags) {
      const { host, hostExplicit } = resolveHost(flags.host);
      return runAggregatedDashboardCommand(
        {
          projectRoot: flags.projectRoot,
          open: !flags.noOpen,
          host,
          hostExplicit,
          port: flags.port,
        },
        this.runtime,
      );
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

interface OpenFlags {
  readonly artifact: string;
  readonly host: string | undefined;
  readonly port: number;
  readonly noOpen: boolean;
}

export const openCommand = buildCommand({
  loader: async () => {
    const { openCommand: runOpenCommand } = await import("../internal/dashboard-devserver.ts");
    return function (this: CliContext, flags: OpenFlags) {
      const { host, hostExplicit } = resolveHost(flags.host);
      return runOpenCommand(
        {
          artifact: flags.artifact,
          open: !flags.noOpen,
          host,
          hostExplicit,
          port: flags.port,
        },
        this.runtime,
      );
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

interface ReportFlags {
  readonly artifact: string;
  readonly output: string;
}

export const reportCommand = buildCommand({
  loader: async () => {
    const { reportCommand: runReportCommand } = await import("../internal/dashboard-report.ts");
    return async function (this: CliContext, flags: ReportFlags) {
      const result = await runReportCommand(
        { artifact: flags.artifact, output: flags.output },
        this.runtime,
      );
      emitResult(this, result, true);
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
