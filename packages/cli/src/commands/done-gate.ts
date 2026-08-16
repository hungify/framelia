import * as path from "node:path";

import { verificationArtifactSchema } from "@framelia/contracts";
import {
  doneGateFromArtifact,
  EXIT_OK,
  EXIT_VISUAL_FAIL,
  JSON_INDENT_SPACES,
} from "@framelia/verify";
import { Option, type Command } from "commander";

import { loadFrameliaConfig } from "../config.ts";
import { positiveNumber, readJsonFile, subcommand } from "./shared.ts";

interface DoneGateOptions {
  artifact: string;
  projectRoot?: string;
  maxScoreAgeMs?: number;
  maxBaselineAgeMs?: number;
  maxGoldAgeMs?: number;
}

async function doneGateCommand(options: DoneGateOptions): Promise<void> {
  const artifact = verificationArtifactSchema.parse(readJsonFile(options.artifact));
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const config = await loadFrameliaConfig(projectRoot);
  const verdict = doneGateFromArtifact(artifact, {
    maxScoreAgeMs: options.maxScoreAgeMs,
    maxBaselineAgeMs: options.maxBaselineAgeMs ?? options.maxGoldAgeMs,
    defaults: config,
  });
  console.log(
    JSON.stringify(
      { artifactPath: path.resolve(options.artifact), ...verdict },
      null,
      JSON_INDENT_SPACES,
    ),
  );
  process.exitCode = verdict.done ? EXIT_OK : EXIT_VISUAL_FAIL;
}

export function registerDoneGateCommand(program: Command): void {
  program.addCommand(
    subcommand("done-gate", "Evaluate final done gate from verification evidence.")
      .requiredOption("--artifact <path>", "verification artifact JSON")
      .option("--project-root <dir>", "target project root")
      .option("--max-score-age-ms <ms>", "maximum score age", positiveNumber)
      .option("--max-baseline-age-ms <ms>", "maximum baseline age", positiveNumber)
      .addOption(
        new Option("--max-gold-age-ms <ms>", "deprecated alias for --max-baseline-age-ms")
          .argParser(positiveNumber)
          .hideHelp(),
      )
      .action(doneGateCommand),
  );
}
