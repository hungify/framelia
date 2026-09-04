import * as path from "node:path";

import { compare, type CompareOutcome, type ProfileName } from "@framelia/verify";

import type { CliRuntime } from "../runtime-types.ts";

export interface CompareOptions {
  readonly baseline: string;
  readonly actual: string;
  readonly outDir: string | undefined;
  readonly profile: ProfileName;
}

export type CompareResult = CompareOutcome;

export function compareCommand(options: CompareOptions, runtime: CliRuntime): CompareResult {
  const baselinePath = path.resolve(runtime.cwd(), options.baseline);
  const actualPath = path.resolve(runtime.cwd(), options.actual);
  const outDir = path.resolve(runtime.cwd(), options.outDir ?? path.dirname(options.actual));
  // Resolving here (required for testability against an injected CliRuntime.cwd(), not
  // just the real process cwd) is a known, narrow behavior change from the old CLI:
  // compare()'s "Cannot read PNG: ..." topIssue message now shows the absolute path
  // instead of the raw flag value. Only that one diagnostic string is affected --
  // pass/matchRatio/etc. are unchanged.
  return compare(baselinePath, actualPath, outDir, { profile: options.profile });
}
