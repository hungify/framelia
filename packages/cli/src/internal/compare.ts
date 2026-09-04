import * as path from "node:path";

import { compare, type CompareOutcome, type ProfileName } from "@framelia/verify";

import type { CliResult } from "../output.ts";
import type { CliRuntime } from "../runtime-types.ts";

export interface CompareOptions {
  readonly baseline: string;
  readonly actual: string;
  readonly outDir: string | undefined;
  readonly profile: ProfileName;
}

export type CompareResult = CliResult<CompareOutcome>;

export interface CompareDependencies {
  readonly compare: typeof compare;
}

const defaultDependencies: CompareDependencies = { compare };

export function compareCommand(
  options: CompareOptions,
  runtime: CliRuntime,
  deps: CompareDependencies = defaultDependencies,
): CompareResult {
  const baselinePath = path.resolve(runtime.cwd(), options.baseline);
  const actualPath = path.resolve(runtime.cwd(), options.actual);
  const outDir = path.resolve(runtime.cwd(), options.outDir ?? path.dirname(options.actual));
  const outcome = deps.compare(baselinePath, actualPath, outDir, { profile: options.profile });
  return { ok: outcome.pass, body: outcome };
}
