import * as fs from "node:fs";
import { pathToFileURL } from "node:url";

import { EXIT_OK, EXIT_USAGE_ERROR, loadProjectEnv } from "@framelia/verify";
import { Command, CommanderError } from "commander";

import { DuplicateFlagError, rejectDuplicateFlags, type FlagSpec } from "./argv-flags.ts";
import { registerAuthCommand } from "./commands/auth.ts";
import { registerBaselineCommands } from "./commands/baseline.ts";
import { registerContractCommands } from "./commands/contract.ts";
import { registerDebugCommands } from "./commands/debug.ts";
import { registerDoneGateCommand } from "./commands/done-gate.ts";
import { registerInitCommand } from "./commands/init-command.ts";
import { registerSchemaCommand } from "./commands/schema.ts";
import { registerStatusCommand } from "./commands/status.ts";
import { registerUICommands } from "./commands/ui.ts";

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

  registerUICommands(program);
  registerDoneGateCommand(program);
  registerStatusCommand(program, PACKAGE_VERSION);
  registerSchemaCommand(program);
  registerInitCommand(program);
  registerAuthCommand(program);
  registerContractCommands(program);
  registerBaselineCommands(program);
  registerDebugCommands(program);

  return program;
}

function optionFlagsOf(command: Command): FlagSpec[] {
  const flags: FlagSpec[] = [];
  for (const option of command.options) {
    if (option.long)
      flags.push({ flag: option.long, takesValue: option.required || option.optional });
  }
  return flags;
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

/** Commander adapter: translates the resolved command chain's Option objects into the
 * flag/takesValue pairs rejectDuplicateFlags (in argv-flags.ts) actually classifies argv
 * against. Keeps the classification logic itself free of Commander's internal shape. */
function knownFlagsFor(program: Command, argv: string[]): FlagSpec[] {
  const takesValueByFlag = new Map<string, boolean>();
  for (const command of resolveCommandChain(program, argv)) {
    for (const { flag, takesValue } of optionFlagsOf(command))
      takesValueByFlag.set(flag, takesValue);
  }
  return [...takesValueByFlag].map(([flag, takesValue]) => ({ flag, takesValue }));
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const program = createProgram();
  try {
    rejectDuplicateFlags(argv, knownFlagsFor(program, argv));
    await program.parseAsync(argv, { from: "user" });
  } catch (error) {
    if (error instanceof DuplicateFlagError) {
      console.error(error.message);
      program.outputHelp();
      process.exitCode = EXIT_USAGE_ERROR;
      return;
    }
    if (error instanceof CommanderError) {
      process.exitCode = error.exitCode === EXIT_OK ? EXIT_OK : EXIT_USAGE_ERROR;
      return;
    }
    throw error;
  }
}

/** Entry point for both the dev script (`tsx src/cli.ts`) and the published
 * bin (`bin/framelia.js`, importing the built `dist/cli.js`) -- one place
 * owns "run the CLI and turn an unexpected throw into a usage-error exit." */
export async function run(argv = process.argv.slice(2)): Promise<void> {
  await main(argv).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = EXIT_USAGE_ERROR;
  });
}

const isMain = process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) void run();
