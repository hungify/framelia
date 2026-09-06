import { profileSchema } from "@framelia/contracts";
import { buildCommand } from "@stricli/core";

import { identityParser } from "../cli-constants.ts";
import type { CliContext } from "../context.ts";
import type { CompareOptions } from "../internal/compare.ts";
import { emitResult } from "../output.ts";

const PROFILE_VALUES = profileSchema.options;

export const compareCommand = buildCommand({
  loader: async () => {
    const { compareCommand: runCompareCommand } = await import("../internal/compare.ts");
    return function (this: CliContext, flags: CompareOptions) {
      emitResult(this, runCompareCommand(flags, this.process));
    };
  },
  parameters: {
    flags: {
      baseline: {
        kind: "parsed",
        parse: identityParser,
        brief: "baseline PNG",
        placeholder: "path",
      },
      actual: { kind: "parsed", parse: identityParser, brief: "actual PNG", placeholder: "path" },
      outDir: {
        kind: "parsed",
        parse: identityParser,
        optional: true,
        brief: "comparison artifact directory",
        placeholder: "dir",
      },
      profile: {
        kind: "enum",
        values: PROFILE_VALUES,
        default: "component/strict",
        brief: "comparison profile",
      },
    },
    aliases: { b: "baseline", a: "actual", o: "outDir", p: "profile" },
  },
  docs: { brief: "Compare baseline and actual PNG files." },
});
