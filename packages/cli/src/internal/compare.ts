import * as path from "node:path";

import { compare, type CompareOutcome, type ProfileName } from "@framelia/verify";

import type { CommandEnvironment } from "../environment.ts";
import { EXIT_OK, EXIT_USAGE_ERROR, EXIT_VISUAL_FAIL } from "../exit.ts";
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

/**
 * The comparator reports a PNG it could not read as a skipped comparison with no decoded
 * size on either side; a real PNG is never 0x0, so this is an input failure, not a verdict.
 */
function inputUnreadable(outcome: CompareOutcome): boolean {
  return (
    outcome.matchRatio === null &&
    outcome.baselineSize.width === 0 &&
    outcome.actualSize.width === 0
  );
}

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
  const exitCode = outcome.pass
    ? EXIT_OK
    : inputUnreadable(outcome)
      ? EXIT_USAGE_ERROR
      : EXIT_VISUAL_FAIL;
  return { ok: outcome.pass, exitCode, body: outcome };
}
