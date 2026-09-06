import * as path from "node:path";

import { DEFAULT_IMAGE_SCALE, fetchBaseline, type FetchBaselineOutcome } from "@framelia/verify";
import { z } from "zod";

import { usageErrorFromZodError } from "../exit.ts";
import type { CliResult } from "../output.ts";
import type { CliRuntime } from "../runtime-types.ts";
import { requireFigmaToken } from "./figma-token.ts";

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

export type CaptureResult = CliResult<FetchBaselineOutcome>;

export interface CaptureDependencies {
  readonly fetchBaseline: typeof fetchBaseline;
}

const defaultDependencies: CaptureDependencies = { fetchBaseline };

export async function captureCommand(
  options: CaptureOptions,
  runtime: CliRuntime,
  deps: CaptureDependencies = defaultDependencies,
): Promise<CaptureResult> {
  const parsed = captureOptionsSchema.safeParse(options);
  if (!parsed.success) throw usageErrorFromZodError(parsed.error);

  const token = requireFigmaToken(runtime);

  const outPath = path.resolve(runtime.cwd(), parsed.data.out);
  const outcome = await deps.fetchBaseline({
    fileKey: parsed.data.fileKey,
    nodeId: parsed.data.nodeId,
    outPath,
    scale: parsed.data.scale ?? DEFAULT_IMAGE_SCALE,
    canvasFill: parsed.data.canvasFill,
    token,
  });
  return { ok: outcome.ok && outcome.fetched, body: outcome };
}
