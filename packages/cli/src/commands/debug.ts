import * as path from "node:path";

import { profileSchema } from "@framelia/contracts";
import { compare, DEFAULT_IMAGE_SCALE, fetchBaseline, type ProfileName } from "@framelia/verify";
import { Option, type Command } from "commander";

import { emitResult, positiveNumber, subcommand } from "./shared.ts";

async function captureCommand(options: {
  fileKey: string;
  nodeId: string;
  out: string;
  scale?: number;
  canvasFill?: string;
}): Promise<void> {
  const result = await fetchBaseline({
    fileKey: options.fileKey,
    nodeId: options.nodeId,
    outPath: options.out,
    scale: options.scale ?? DEFAULT_IMAGE_SCALE,
    canvasFill: options.canvasFill,
  });
  emitResult(result, result.ok && result.fetched);
}

async function compareCommand(options: {
  baseline: string;
  actual: string;
  outDir?: string;
  profile: ProfileName;
}): Promise<void> {
  const result = compare(
    options.baseline,
    options.actual,
    options.outDir ?? path.dirname(options.actual),
    {
      profile: options.profile,
    },
  );
  emitResult(result, result.pass);
}

export function registerDebugCommands(program: Command): void {
  program.addCommand(
    subcommand("capture", "Capture a Figma node baseline image.")
      .alias("fetch-gold")
      .requiredOption("--file-key <key>", "Figma file key")
      .requiredOption("--node-id <id>", "Figma node ID")
      .requiredOption("--out <path>", "baseline PNG output")
      .option("--scale <number>", "Figma image scale", positiveNumber)
      .option("--canvas-fill <color>", "canvas fill such as #fff")
      .action(captureCommand),
  );

  program.addCommand(
    subcommand("compare", "Compare baseline and actual PNG files.")
      .alias("diff")
      .requiredOption("--baseline <path>", "baseline PNG")
      .requiredOption("--actual <path>", "actual PNG")
      .option("--out-dir <dir>", "comparison artifact directory")
      .addOption(
        new Option("--profile <profile>", "comparison profile")
          .choices(profileSchema.options)
          .default("component/strict"),
      )
      .action(compareCommand),
  );
}
