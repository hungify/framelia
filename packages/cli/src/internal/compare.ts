import * as path from "node:path";

import { compare, type CompareOutcome, type ProfileName } from "@framelia/verify";

import type { CommandEnvironment } from "../environment.ts";
import type { CliResult } from "../output.ts";

export interface CompareOptions {
  readonly baseline: string;
  readonly actual: string;
  readonly outDir: string | undefined;
  readonly profile: ProfileName;
}

export type CompareResult = CliResult<CompareOutcome>;

/** Test seam: the in-process comparator. */
export interface CompareSeams {
  readonly compare: typeof compare;
}

const defaultSeams: CompareSeams = { compare };

export function compareCommand(
  options: CompareOptions,
  env: Pick<CommandEnvironment, "process">,
  seams: CompareSeams = defaultSeams,
): CompareResult {
  const runtime = env.process;
  const baselinePath = path.resolve(runtime.cwd(), options.baseline);
  const actualPath = path.resolve(runtime.cwd(), options.actual);
  const outDir = path.resolve(runtime.cwd(), options.outDir ?? path.dirname(options.actual));
  const outcome = seams.compare(baselinePath, actualPath, outDir, { profile: options.profile });
  return { ok: outcome.pass, body: outcome };
}
