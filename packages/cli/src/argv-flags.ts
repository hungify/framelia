export interface FlagSpec {
  flag: string;
  takesValue: boolean;
}

export class DuplicateFlagError extends Error {
  readonly flag: string;

  constructor(flag: string) {
    super(`error: option '${flag}' used more than once`);
    this.flag = flag;
  }
}

/**
 * Pure argv classifier: knows nothing about Commander's Command/Option shape —
 * callers translate whatever option source they have into FlagSpec[] first.
 * Long-form flags only (`--foo`), no short flags, no variadic option values —
 * matches this CLI's whole option surface. Extending to short flags or variadic
 * options would need this rewritten, not just extended.
 */
export function rejectDuplicateFlags(
  argv: readonly string[],
  knownFlags: readonly FlagSpec[],
): void {
  const takesValueByFlag = new Map(knownFlags.map((spec) => [spec.flag, spec.takesValue]));
  const seen = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--") break;
    if (!argument.startsWith("--")) continue;
    const [flag, inlineValue] = argument.split(/=(.*)/, 2);
    if (!flag || !takesValueByFlag.has(flag)) continue;
    if (seen.has(flag)) throw new DuplicateFlagError(flag);
    seen.add(flag);
    if (takesValueByFlag.get(flag) && inlineValue === undefined) index += 1;
  }
}
