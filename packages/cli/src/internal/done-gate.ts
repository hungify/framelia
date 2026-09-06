import * as fs from "node:fs";
import * as path from "node:path";

import { verificationArtifactSchema } from "@framelia/contracts";
import { doneGateFromArtifact, type DoneGateVerdict } from "@framelia/verify";
import { z } from "zod";

import { UsageError, usageErrorFromZodError } from "../exit.ts";
import type { CliResult } from "../output.ts";
import type { CliRuntime } from "../runtime-types.ts";
import { openProject } from "./project.ts";

const doneGateOptionsSchema = z.object({
  artifact: z.string(),
  projectRoot: z.string().optional(),
  maxScoreAgeMs: z.number().positive().optional(),
  maxBaselineAgeMs: z.number().positive().optional(),
  maxGoldAgeMs: z.number().positive().optional(),
});

export interface DoneGateOptions {
  readonly artifact: string;
  readonly projectRoot: string | undefined;
  readonly maxScoreAgeMs: number | undefined;
  readonly maxBaselineAgeMs: number | undefined;
  readonly maxGoldAgeMs: number | undefined;
}

export type DoneGateResult = CliResult<DoneGateVerdict & { readonly artifactPath: string }>;

export async function doneGateCommand(
  options: DoneGateOptions,
  runtime: CliRuntime,
): Promise<DoneGateResult> {
  const parsed = doneGateOptionsSchema.safeParse(options);
  if (!parsed.success) throw usageErrorFromZodError(parsed.error);

  const artifactPath = path.resolve(runtime.cwd(), parsed.data.artifact);
  let artifactJson: unknown;
  try {
    artifactJson = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  } catch (error) {
    throw new UsageError(
      `Cannot read JSON ${parsed.data.artifact}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  const artifactResult = verificationArtifactSchema.safeParse(artifactJson);
  if (!artifactResult.success) throw usageErrorFromZodError(artifactResult.error);

  const project = openProject(parsed.data.projectRoot, runtime);
  const config = await project.loadConfig();
  const verdict = doneGateFromArtifact(artifactResult.data, {
    maxScoreAgeMs: parsed.data.maxScoreAgeMs,
    maxBaselineAgeMs: parsed.data.maxBaselineAgeMs ?? parsed.data.maxGoldAgeMs,
    defaults: config,
  });
  return { ok: verdict.done, body: { artifactPath, ...verdict } };
}
