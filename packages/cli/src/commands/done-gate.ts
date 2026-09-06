import { buildCommand, numberParser } from "@stricli/core";

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
      artifact: {
        kind: "parsed",
        parse: identityParser,
        brief: "verification artifact JSON",
        placeholder: "path",
      },
      projectRoot: projectRootFlag,
      maxScoreAgeMs: {
        kind: "parsed",
        parse: numberParser,
        optional: true,
        brief: "maximum score age",
        placeholder: "ms",
      },
      maxBaselineAgeMs: {
        kind: "parsed",
        parse: numberParser,
        optional: true,
        brief: "maximum baseline age",
        placeholder: "ms",
      },
      maxGoldAgeMs: {
        kind: "parsed",
        parse: numberParser,
        optional: true,
        hidden: true,
        brief: "deprecated alias for --max-baseline-age-ms",
        placeholder: "ms",
      },
    },
    aliases: { a: "artifact", r: "projectRoot", s: "maxScoreAgeMs", b: "maxBaselineAgeMs" },
  },
  docs: { brief: "Evaluate final done gate from verification evidence." },
});
