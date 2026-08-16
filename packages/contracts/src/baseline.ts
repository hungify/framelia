import * as z from "zod";

import { FIGMA_NODE_ID } from "./constants.ts";

export const figmaBaselineSchema = z
  .object({
    kind: z.literal("figma"),
    fileKey: z.string().min(1),
    nodeId: z.string().regex(FIGMA_NODE_ID),
    scale: z.literal(1).optional(),
    canvasFill: z
      .string()
      .regex(/^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/)
      .optional(),
  })
  .strict();

export const baselineSchema = figmaBaselineSchema;

export type BaselineSource = z.infer<typeof baselineSchema>;
export type FigmaBaselineSource = z.infer<typeof figmaBaselineSchema>;
