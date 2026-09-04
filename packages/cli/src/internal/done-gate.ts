import * as path from "node:path";

import { verificationArtifactSchema } from "@framelia/contracts";
import { doneGateFromArtifact, type DoneGateVerdict } from "@framelia/verify";
import { z } from "zod";

import { loadFrameliaConfig } from "../config.ts";
import { usageErrorFromZodError } from "../errors.ts";
import type { CliRuntime } from "../runtime-types.ts";
import { readJsonFile } from "./json-file.ts";
import { resolveProjectRoot } from "./project-root.ts";

const doneGateOptionsSchema = z.object({
  artifact: z.string(),
  projectRoot: z.string().optional(),
  maxScoreAgeMs: z.number().positive().optional(),
  maxBaselineAgeMs: z.number().positive().optional(),
});

export interface DoneGateOptions {
  readonly artifact: string;
  readonly projectRoot: string | undefined;
  readonly maxScoreAgeMs: number | undefined;
  readonly maxBaselineAgeMs: number | undefined;
}

export type DoneGateResult = DoneGateVerdict & { readonly artifactPath: string };

export async function doneGateCommand(
  options: DoneGateOptions,
  runtime: CliRuntime,
): Promise<DoneGateResult> {
  const parsed = doneGateOptionsSchema.safeParse(options);
  if (!parsed.success) throw usageErrorFromZodError(parsed.error);

  const artifactPath = path.resolve(runtime.cwd(), parsed.data.artifact);
  const artifact = verificationArtifactSchema.parse(
    readJsonFile(parsed.data.artifact, runtime.cwd()),
  );
  const projectRoot = resolveProjectRoot(parsed.data.projectRoot, runtime);
  const config = await loadFrameliaConfig(projectRoot);
  const verdict = doneGateFromArtifact(artifact, {
    maxScoreAgeMs: parsed.data.maxScoreAgeMs,
    maxBaselineAgeMs: parsed.data.maxBaselineAgeMs,
    defaults: config,
  });
  return { artifactPath, ...verdict };
}
