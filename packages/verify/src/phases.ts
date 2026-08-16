import { compare } from "./compare/index.ts";
import type { CompareOutcome, ExpectSize, ProfileName } from "./types.ts";

export function diffPhase(options: {
  baselinePath: string;
  actualPath: string;
  outDir: string;
  profile: ProfileName;
  expectSize?: ExpectSize;
}): CompareOutcome {
  return compare(options.baselinePath, options.actualPath, options.outDir, {
    profile: options.profile,
    expectSize: options.expectSize,
  });
}
