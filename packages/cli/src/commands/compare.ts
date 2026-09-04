import { profileSchema } from "@framelia/contracts";
import { buildCommand } from "@stricli/core";

import { identityParser } from "../cli-constants.ts";
import type { CliContext } from "../context.ts";
import { emitResult } from "../output.ts";

// Lightweight, zod-only import (see the rewrite plan's Architecture §1 "Verification
// callout") -- @framelia/contracts has no Playwright/Hono/prompt runtime deps, so this
// is safe for a command declaration file's static import graph.
const PROFILE_VALUES = profileSchema.options;
type ProfileName = (typeof PROFILE_VALUES)[number];

interface CompareFlags {
  readonly baseline: string;
  readonly actual: string;
  readonly outDir: string | undefined;
  readonly profile: ProfileName;
}

export const compareCommand = buildCommand({
  loader: async () => {
    const { compareCommand: runCompareCommand } = await import("../internal/compare.ts");
    return function (this: CliContext, flags: CompareFlags) {
      const result = runCompareCommand(
        {
          baseline: flags.baseline,
          actual: flags.actual,
          outDir: flags.outDir,
          profile: flags.profile,
        },
        this.runtime,
      );
      emitResult(this, result, result.pass);
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
