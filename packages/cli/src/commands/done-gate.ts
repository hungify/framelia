import { buildCommand, numberParser } from "@stricli/core";

import { identityParser, projectRootFlag } from "../cli-constants.ts";
import type { CliContext } from "../context.ts";
import { emitResult } from "../output.ts";

interface DoneGateFlags {
  readonly artifact: string;
  readonly projectRoot: string | undefined;
  readonly maxScoreAgeMs: number | undefined;
  readonly maxBaselineAgeMs: number | undefined;
  readonly maxGoldAgeMs: number | undefined;
}

export const doneGateCommand = buildCommand({
  loader: async () => {
    const { doneGateCommand: runDoneGateCommand } = await import("../internal/done-gate.ts");
    return async function (this: CliContext, flags: DoneGateFlags) {
      // `--max-gold-age-ms` is a deprecated hidden alias for `--max-baseline-age-ms`;
      // merged here, not in internal/done-gate.ts, so the internal function only ever
      // sees the one canonical field.
      const result = await runDoneGateCommand(
        {
          artifact: flags.artifact,
          projectRoot: flags.projectRoot,
          maxScoreAgeMs: flags.maxScoreAgeMs,
          maxBaselineAgeMs: flags.maxBaselineAgeMs ?? flags.maxGoldAgeMs,
        },
        this.runtime,
      );
      emitResult(this, result, result.done);
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
