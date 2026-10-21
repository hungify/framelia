import { buildCommand, buildRouteMap, numberParser } from "@stricli/core";

import { identityParser, projectRootFlag } from "../cli-constants.ts";
import type { CliContext } from "../context.ts";
import type { RunsFinalizeOptions, RunsListOptions, RunsPruneOptions } from "../internal/runs.ts";
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

const finalizeCommand = buildCommand({
  loader: async () => {
    const { runsFinalizeCommand } = await import("../internal/runs.ts");
    return async function (this: CliContext, flags: RunsFinalizeOptions) {
      emitResult(this, await runsFinalizeCommand(flags, this));
    };
  },
  parameters: {
    flags: {
      run: {
        kind: "parsed",
        parse: identityParser,
        optional: true,
        brief: "the sharded run's shared run ID",
        placeholder: "id",
      },
      projectRoot: projectRootFlag,
    },
    aliases: { r: "projectRoot", R: "run" },
  },
  docs: {
    brief: "Compose and finalize a sharded run once every shard is collected.",
    fullDescription: [
      "Compose one sharded direct run's plan from every shard's plan fragment and finalize it.",
      "Use it when shards ran on separate machines: collect every shard's .framelia/runs/<run>",
      "directory into one project root first. Exits 2 and lists the missing shards when any",
      "shard has not completed; a run that is already finalized is left unchanged.",
      "",
      "Example:",
      "  framelia runs finalize --run <run-id>",
    ].join("\n"),
  },
});

export const runsRoutes = buildRouteMap({
  routes: { list: runsListCommand, prune: pruneCommand, finalize: finalizeCommand },
  docs: { brief: "Discover, finalize and prune durable runs." },
});
