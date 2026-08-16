import * as path from "node:path";

import { profileSchema } from "@framelia/contracts";
import {
  DEFAULT_IMAGE_SCALE,
  EXIT_OK,
  EXIT_VISUAL_FAIL,
  fetchGold,
  JSON_INDENT_SPACES,
  type ProfileName,
} from "@framelia/verify";
import { diffPhase } from "@framelia/verify/internal";
import { Option, type Command } from "commander";

import { positiveNumber, subcommand } from "./shared.ts";

async function fetchGoldCommand(options: {
  fileKey: string;
  nodeId: string;
  out: string;
  scale?: number;
  canvasFill?: string;
}): Promise<void> {
  const result = await fetchGold({
    fileKey: options.fileKey,
    nodeId: options.nodeId,
    outPath: options.out,
    scale: options.scale ?? DEFAULT_IMAGE_SCALE,
    canvasFill: options.canvasFill,
  });
  console.log(JSON.stringify(result, null, JSON_INDENT_SPACES));
  process.exitCode = result.ok ? EXIT_OK : EXIT_VISUAL_FAIL;
}

async function compareCommand(options: {
  gold: string;
  actual: string;
  outDir?: string;
  profile: ProfileName;
}): Promise<void> {
  const result = diffPhase({
    baselinePath: options.gold,
    actualPath: options.actual,
    outDir: options.outDir ?? path.dirname(options.actual),
    profile: options.profile,
  });
  console.log(JSON.stringify(result, null, JSON_INDENT_SPACES));
  process.exitCode = result.pass ? EXIT_OK : EXIT_VISUAL_FAIL;
}

export function registerDebugCommands(program: Command): void {
  program.addCommand(
    subcommand("fetch-gold", "Capture a Figma node baseline image.")
      .alias("capture")
      .requiredOption("--file-key <key>", "Figma file key")
      .requiredOption("--node-id <id>", "Figma node ID")
      .requiredOption("--out <path>", "baseline PNG output")
      .option("--scale <number>", "Figma image scale", positiveNumber)
      .option("--canvas-fill <color>", "canvas fill such as #fff")
      .action(fetchGoldCommand),
  );

  program.addCommand(
    subcommand("compare", "Compare baseline and actual PNG files.")
      .alias("diff")
      .requiredOption("--gold <path>", "baseline PNG")
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
