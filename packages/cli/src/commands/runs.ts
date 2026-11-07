import { buildCommand, buildRouteMap, numberParser } from "@stricli/core";

import { identityParser, projectRootFlag } from "../cli-constants.ts";
import type { CliContext } from "../context.ts";
import type { RunsListOptions, RunsPruneOptions } from "../internal/runs.ts";
import { emitResult } from "../output.ts";

export const runsListCommand = buildCommand({
  loader: async () => {
    const { runsListCommand: runRunsList } = await import("../internal/runs.ts");
    return function (this: CliContext, flags: RunsListOptions) {
      emitResult(this, runRunsList(flags, this));
    };
  },
  parameters: {
    flags: { projectRoot: projectRootFlag },
    aliases: { r: "projectRoot" },
  },
  docs: {
    brief: "List durable runs, newest first, with status and case counts.",
    fullDescription: [
      "List durable runs under .framelia/runs/, newest first, as one JSON outcome.",
      "Listing never selects a run: open, report and done-gate still take --run <id>.",
      "",
      "Examples:",
      "  framelia runs list",
      "  framelia open --run <run-id>",
    ].join("\n"),
  },
});

const pruneCommand = buildCommand({
  loader: async () => {
    const { runsPruneCommand } = await import("../internal/runs.ts");
    return function (this: CliContext, flags: RunsPruneOptions) {
      emitResult(this, runsPruneCommand(flags, this));
    };
  },
  parameters: {
    flags: {
      projectRoot: projectRootFlag,
      keep: {
        kind: "parsed",
        parse: numberParser,
        optional: true,
        brief: "always keep this many newest runs",
        placeholder: "n",
      },
      olderThan: {
        kind: "parsed",
        parse: identityParser,
        optional: true,
        brief: "only remove runs older than this (30m, 12h, 7d, 2w)",
        placeholder: "age",
      },
      dryRun: {
        kind: "boolean",
        optional: true,
        brief: "report what would be removed without deleting",
      },
    },
    aliases: { r: "projectRoot" },
  },
  docs: {
    brief: "Remove old durable runs; never in-progress or locked ones.",
    fullDescription: [
      "Remove old durable runs selected by --keep and/or --older-than.",
      "A run that is still planned/running or holds its lock is skipped, and a directory",
      "without a valid run record is never touched.",
      "",
      "Examples:",
      "  framelia runs prune --keep 20 --dry-run",
      "  framelia runs prune --keep 5 --older-than 7d",
    ].join("\n"),
  },
});

export const runsRoutes = buildRouteMap({
  routes: { list: runsListCommand, prune: pruneCommand },
  docs: { brief: "Discover and prune durable runs." },
});
