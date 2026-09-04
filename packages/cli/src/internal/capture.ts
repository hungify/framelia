import * as path from "node:path";

import { DEFAULT_IMAGE_SCALE, fetchBaseline, type FetchBaselineOutcome } from "@framelia/verify";
import { z } from "zod";

import { UsageError, usageErrorFromZodError } from "../errors.ts";
import type { CliRuntime } from "../runtime-types.ts";

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

export type CaptureResult = FetchBaselineOutcome;

export async function captureCommand(
  options: CaptureOptions,
  runtime: CliRuntime,
): Promise<CaptureResult> {
  const parsed = captureOptionsSchema.safeParse(options);
  if (!parsed.success) throw usageErrorFromZodError(parsed.error);

  // Fails fast on the injected runtime's env, not `fetchBaseline`'s own fallback to
  // global `process.env` -- that fallback would otherwise let a real host token leak
  // into a test that injected a token-less runtime on purpose.
  const token = runtime.env.FIGMA_ACCESS_TOKEN;
  if (!token) {
    throw new UsageError(
      "FIGMA_ACCESS_TOKEN is not set. Export it before running framelia capture.",
    );
  }

  const outPath = path.resolve(runtime.cwd(), parsed.data.out);
  return fetchBaseline({
    fileKey: parsed.data.fileKey,
    nodeId: parsed.data.nodeId,
    outPath,
    scale: parsed.data.scale ?? DEFAULT_IMAGE_SCALE,
    canvasFill: parsed.data.canvasFill,
    token,
  });
}
