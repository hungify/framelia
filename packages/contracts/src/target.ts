import * as z from "zod";

import { httpUrlSchema } from "./primitives.ts";

export const webTargetSchema = z
  .object({
    kind: z.literal("web"),
    url: httpUrlSchema,
  })
  .strict();

export type WebTarget = z.infer<typeof webTargetSchema>;
