import type { Command } from "commander";
import { describe, expect, it } from "vitest";

import { createProgram } from "../src/cli.ts";

/**
 * rejectDuplicateFlags (src/argv-flags.ts) only understands long flags (`--foo`) with
 * at most one non-variadic value -- see its own doc comment. That's a silent
 * under-enforcement risk: adding a short flag or a variadic option anywhere
 * would stop being checked for duplicates without any error. This test locks
 * the assumption so violating it fails loudly here instead.
 *
 * `-h`/`-V` are commander's own eager-exit help/version flags, not part of
 * this CLI's declared option surface: they short-circuit the process on
 * first occurrence, so a duplicate can never actually be parsed.
 */
const FRAMEWORK_OWNED_LONG_FLAGS = new Set(["--help", "--version"]);

function collectOptionViolations(command: Command, path: string[]): string[] {
  const commandPath = [...path, command.name()].join(" ");
  const violations: string[] = [];

  for (const option of command.options) {
    if (FRAMEWORK_OWNED_LONG_FLAGS.has(option.long ?? "")) continue;
    if (option.short) {
      violations.push(`${commandPath}: short flag '${option.short}' not covered by dedup check`);
    }
    if (option.variadic) {
      violations.push(
        `${commandPath}: variadic option '${option.long}' not covered by dedup check`,
      );
    }
  }

  for (const subcommand of command.commands) {
    violations.push(...collectOptionViolations(subcommand, [...path, command.name()]));
  }

  return violations;
}

describe("CLI option surface", () => {
  it("stays within rejectDuplicateFlags' long-flag, non-variadic assumption", () => {
    const program = createProgram();
    expect(collectOptionViolations(program, [])).toEqual([]);
  });
});
