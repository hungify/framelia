import * as path from "node:path";

import type { Command } from "commander";

import { runCreateContract } from "../contract.ts";
import { subcommand } from "./shared.ts";

export function registerContractCommands(program: Command): void {
  const contract = subcommand("contract", "Create and manage visual contracts.");

  contract.addCommand(
    subcommand("create", "Interactively create a schema-v4 visual contract.")
      .option("--project-root <dir>", "target project root")
      .option("--output <path>", "contract path relative to project root")
      .option("--force", "replace existing contract")
      .action((options: { projectRoot?: string; output?: string; force?: boolean }) =>
        runCreateContract({
          projectRoot: path.resolve(options.projectRoot ?? process.cwd()),
          outputPath: options.output,
          force: options.force,
        }),
      ),
  );

  program.addCommand(contract);
}
