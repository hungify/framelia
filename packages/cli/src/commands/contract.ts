import * as path from "node:path";

import { InvalidArgumentError, type Command } from "commander";

import { runCreateContract, type CreateContractOptions } from "../contract.ts";
import { positiveInteger, subcommand } from "./shared.ts";

type CreateContractFlags = Omit<CreateContractOptions, "projectRoot"> & { projectRoot?: string };

function viewportPreset(raw: string): "desktop" | "mobile" | "custom" {
  if (raw !== "desktop" && raw !== "mobile" && raw !== "custom") {
    throw new InvalidArgumentError('must be "desktop", "mobile", or "custom"');
  }
  return raw;
}

function scopeKind(raw: string): "page" | "region" {
  if (raw !== "page" && raw !== "region") {
    throw new InvalidArgumentError('must be "page" or "region"');
  }
  return raw;
}

export function registerContractCommands(program: Command): void {
  const contract = subcommand("contract", "Create and manage visual contracts.");

  contract.addCommand(
    subcommand(
      "create",
      "Create a schema-v4 visual contract. Prompts interactively for any flag left unset.",
    )
      .option("--project-root <dir>", "target project root")
      .option("--output <path>", "contract path relative to project root")
      .option("--force", "replace existing contract")
      .option("--target-url <url>", "target application URL")
      .option("--contract-id <id>", "contract id, e.g. home.desktop")
      .option("--file-key <key>", "Figma file key")
      .option("--node-id <id>", "Figma node id, e.g. 153:5181")
      .option("--viewport <preset>", "desktop, mobile, or custom", viewportPreset)
      .option("--viewport-name <name>", "viewport name (with --viewport custom)")
      .option(
        "--viewport-width <n>",
        "viewport width in px (with --viewport custom)",
        positiveInteger,
      )
      .option(
        "--viewport-height <n>",
        "viewport height in px (with --viewport custom)",
        positiveInteger,
      )
      .option("--scope <kind>", "page or region", scopeKind)
      .option(
        "--page-reason <text>",
        "why the baseline represents the complete page (with --scope page)",
      )
      .option("--selector <css>", "CSS selector for the captured region (with --scope region)")
      .option(
        "--region-width <n>",
        "expected region width in px (with --scope region)",
        positiveInteger,
      )
      .option(
        "--region-height <n>",
        "expected region height in px (with --scope region)",
        positiveInteger,
      )
      .action(({ output, ...options }: CreateContractFlags & { output?: string }) =>
        runCreateContract({
          ...options,
          projectRoot: path.resolve(options.projectRoot ?? process.cwd()),
          outputPath: output,
        }),
      ),
  );

  program.addCommand(contract);
}
