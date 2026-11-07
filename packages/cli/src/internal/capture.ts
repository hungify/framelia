import * as path from "node:path";

import { DEFAULT_IMAGE_SCALE, type FetchBaselineOutcome } from "@framelia/verify";
import { z } from "zod";

import type { CommandEnvironment } from "../environment.ts";
import { EXIT_OK, EXIT_USAGE_ERROR, UsageError, usageErrorFromZodError } from "../exit.ts";
import type { CliResult } from "../output.ts";
import { requireFigmaToken } from "./figma-token.ts";
import { failureOutcome, type FailureOutcome } from "./outcome.ts";

const captureOptionsSchema = z.object({
  fileKey: z.string(),
  nodeId: z.string(),
  out: z.string(),
  scale: z.number().positive().optional(),
  canvasFill: z.string().optional(),
});

export interface CaptureOptions {
  readonly fileKey: string;
  readonly nodeId: string;
  readonly out: string;
  readonly scale: number | undefined;
  readonly canvasFill: string | undefined;
}

export type CaptureResult = CliResult<
  FetchBaselineOutcome | FailureOutcome<"framelia.capture-outcome", "capture">
>;

/** Input and token problems are one structured JSON outcome (exit 2), like every finite command. */
export async function captureCommand(
  options: CaptureOptions,
  env: CommandEnvironment,
): Promise<CaptureResult> {
  try {
    return await capture(options, env);
  } catch (error) {
    return failureOutcome({
      kind: "framelia.capture-outcome",
      command: "capture",
      error,
      fallbackCode: "CAPTURE_FAILED",
      stage: "capture",
      projectRoot: undefined,
    });
  }
}

async function capture(options: CaptureOptions, env: CommandEnvironment): Promise<CaptureResult> {
  const runtime = env.process;
  const parsed = captureOptionsSchema.safeParse(options);
  if (!parsed.success) {
    throw new UsageError(usageErrorFromZodError(parsed.error).message, { code: "INVALID_INPUT" });
  }

  const token = requireFigmaToken(runtime);

  const outPath = path.resolve(runtime.cwd(), parsed.data.out);
  const figma = await env.adapters.figma();
  const outcome = await figma.fetchBaseline({
    fileKey: parsed.data.fileKey,
    nodeId: parsed.data.nodeId,
    outPath,
    scale: parsed.data.scale ?? DEFAULT_IMAGE_SCALE,
    canvasFill: parsed.data.canvasFill,
    token,
  });
  const fetched = outcome.ok && outcome.fetched;
  // A capture that never produced a baseline is an environment failure, not a visual verdict.
  return { ok: fetched, exitCode: fetched ? EXIT_OK : EXIT_USAGE_ERROR, body: outcome };
}
