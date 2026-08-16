import * as fs from "node:fs";

import { EXIT_OK, EXIT_USAGE_ERROR, loadProjectEnv } from "@framelia/verify";
import { Command, CommanderError } from "commander";

import { registerAuthCommand } from "./commands/auth.ts";
import { registerContractCommands } from "./commands/contract.ts";
import { registerDashboardCommands, runAggregatedDashboard } from "./commands/dashboard.ts";
import { registerDebugCommands } from "./commands/debug.ts";
import { registerDoneGateCommand } from "./commands/done-gate.ts";
import { registerInitCommand } from "./commands/init-command.ts";
import { registerSchemaCommand } from "./commands/schema.ts";
import { registerStatusCommand } from "./commands/status.ts";

loadProjectEnv();

const PACKAGE_VERSION = (
  JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version: string;
  }
).version;

export function createProgram(): Command {
  const program = new Command()
    .name("framelia")
    .description("CLI-first visual verification for Figma-to-web and web-to-web workflows.")
    .version(PACKAGE_VERSION)
    .showHelpAfterError()
    .exitOverride()
    .configureOutput({
      writeOut: (value) => process.stderr.write(value),
      writeErr: (value) => process.stderr.write(value),
    })
    .addHelpText("after", "\nExample:\n  framelia contract create\n");

  registerDashboardCommands(program);
  registerDoneGateCommand(program);
  registerStatusCommand(program, PACKAGE_VERSION);
  registerSchemaCommand(program);
  registerInitCommand(program);
  registerAuthCommand(program);
  registerContractCommands(program);
  registerDebugCommands(program);

  program.action(() => runAggregatedDashboard({ projectRoot: process.cwd(), open: true }));
  return program;
}

function collectKnownOptions(command: Command): Map<string, boolean> {
  const known = new Map<string, boolean>();
  for (const option of command.options) {
    if (option.long) known.set(option.long, option.required || option.optional);
  }
  return known;
}

/** Walks argv's leading non-flag tokens down the subcommand tree (e.g. "contract create"),
 * so a two-level command's options -- which live on the leaf, not the parent -- are found. */
function resolveCommandChain(program: Command, argv: string[]): Command[] {
  const chain: Command[] = [program];
  let current = program;
  for (const token of argv) {
    if (token.startsWith("-")) continue;
    const next = current.commands.find((command) => command.name() === token);
    if (!next) break;
    chain.push(next);
    current = next;
  }
  return chain;
}

function rejectDuplicateOptions(program: Command, argv: string[]): void {
  const knownOptions = new Map<string, boolean>();
  for (const command of resolveCommandChain(program, argv)) {
    for (const [flag, takesValue] of collectKnownOptions(command))
      knownOptions.set(flag, takesValue);
  }

  const seen = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (!argument.startsWith("--")) continue;
    const [flag, inlineValue] = argument.split(/=(.*)/, 2);
    if (!flag || !knownOptions.has(flag)) continue;
    if (seen.has(flag)) {
      throw new CommanderError(
        EXIT_USAGE_ERROR,
        "commander.duplicateOption",
        `error: option '${flag}' used more than once`,
      );
    }
    seen.add(flag);
    if (knownOptions.get(flag) && inlineValue === undefined) index += 1;
  }
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const program = createProgram();
  try {
    rejectDuplicateOptions(program, argv);
    await program.parseAsync(argv, { from: "user" });
  } catch (error) {
    if (error instanceof CommanderError) {
      if (error.code === "commander.duplicateOption") {
        console.error(error.message);
        program.outputHelp();
      }
      process.exitCode = error.exitCode === EXIT_OK ? EXIT_OK : EXIT_USAGE_ERROR;
      return;
    }
    throw error;
  }
}

const isMain =
  process.argv[1] != null &&
  (process.argv[1].endsWith("/cli.ts") ||
    process.argv[1].endsWith("/cli.js") ||
    process.argv[1].endsWith("framelia.js"));

if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = EXIT_USAGE_ERROR;
  });
}
