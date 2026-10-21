import { buildCommand } from "@stricli/core";

import { identityParser, projectRootFlag } from "../cli-constants.ts";
import type { CliContext } from "../context.ts";
import { runCheck } from "../internal/check.ts";
import { emitResult } from "../output.ts";

interface CheckFlags {
  contract?: string[];
  all?: boolean;
  projectRoot?: string;
  project?: string[];
  runIdFile?: string;
}

export const checkCommand = buildCommand({
  loader: async () => {
    return async function (this: CliContext, flags: CheckFlags) {
      const outcome = await runCheck(
        { ...flags, contract: flags.contract ?? [], project: flags.project ?? [] },
        this,
      );
      emitResult(this, { ok: outcome.exitCode === 0, exitCode: outcome.exitCode, body: outcome });
    };
  },
  parameters: {
    flags: {
      projectRoot: projectRootFlag,
      contract: {
        kind: "parsed",
        parse: identityParser,
        optional: true,
        variadic: true,
        brief: "exact authored contract id (repeatable)",
        placeholder: "id",
      },
      all: {
        kind: "boolean",
        optional: true,
        brief: "run every required authored contract",
      },
      project: {
        kind: "parsed",
        parse: identityParser,
        optional: true,
        variadic: true,
        brief: "exact configured visual project name (repeatable; empty selects unnamed)",
        placeholder: "name",
      },
      runIdFile: {
        kind: "parsed",
        parse: identityParser,
        optional: true,
        brief: "write the durable run ID to this file as soon as the run starts",
        placeholder: "path",
      },
    },
    aliases: { c: "contract", p: "project", r: "projectRoot" },
  },
  docs: {
    brief: "Run contract-selected visual checks through the project's local Playwright.",
  },
});
