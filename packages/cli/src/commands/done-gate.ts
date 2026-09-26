import { buildCommand } from "@stricli/core";

import { identityParser, projectRootFlag } from "../cli-constants.ts";
import type { CliContext } from "../context.ts";
import type { DoneGateOptions } from "../internal/done-gate.ts";
import { emitResult } from "../output.ts";

export const doneGateCommand = buildCommand({
  loader: async () => {
    const { doneGateCommand: runDoneGateCommand } = await import("../internal/done-gate.ts");
    return async function (this: CliContext, flags: DoneGateOptions) {
      emitResult(this, await runDoneGateCommand(flags, this.process));
    };
  },
  parameters: {
    flags: {
      run: {
        kind: "parsed",
        parse: identityParser,
        optional: true,
        brief: "explicit durable run ID",
        placeholder: "id",
      },
      requirements: {
        kind: "parsed",
        parse: identityParser,
        optional: true,
        brief: "protected CI/deployment requirements JSON",
        placeholder: "path",
      },
      artifact: {
        kind: "parsed",
        parse: identityParser,
        optional: true,
        hidden: true,
        brief: "legacy artifact (rejected with rerun guidance)",
        placeholder: "path",
      },
      projectRoot: projectRootFlag,
    },
    aliases: { r: "projectRoot", R: "run", q: "requirements" },
  },
  docs: { brief: "Evaluate one selected run against protected trusted requirements." },
});
