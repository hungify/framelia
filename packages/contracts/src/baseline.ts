import * as z from "zod";

import { FIGMA_NODE_ID } from "./constants.ts";

export const figmaBaselineSchema = z
  .object({
    kind: z.literal("figma"),
    fileKey: z.string().min(1),
    nodeId: z.string().regex(FIGMA_NODE_ID),
    // Device pixel ratio the Figma image export is rendered at -- must match whatever
    // scale the corresponding web capture used (see @framelia/verify's captureReadyPage
    // `scale` option) or compare() rejects on mismatched image dimensions. Capped at 4,
    // matching ContractDefaults.deviceScaleFactor's own cap.
    scale: z.number().int().min(1).max(4).optional(),
    canvasFill: z
      .string()
      .regex(/^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/)
      .optional(),
  })
  .strict();

export const baselineSchema = figmaBaselineSchema;

export type BaselineSource = z.infer<typeof baselineSchema>;
export type FigmaBaselineSource = z.infer<typeof figmaBaselineSchema>;
