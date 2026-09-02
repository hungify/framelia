import * as z from "zod";

import {
  DEFAULT_MAX_MASKED_AREA_RATIO,
  MAX_CONTRACT_TIMEOUT_MS,
  MAX_STABILITY_SAMPLES,
  MIN_CONTRACT_TIMEOUT_MS,
  MIN_STABILITY_SAMPLES,
} from "./constants.ts";
import { nonEmptyTrimmed } from "./primitives.ts";

/**
 * Project-wide capture-tuning defaults, resolved from `framelia.config.ts`.
 * Schema-v4 contracts no longer carry these fields — every contract in a
 * project run behaves the same way.
 */
export const captureDefaultsSchema = z
  .object({
    stabilitySamples: z
      .number()
      .int()
      .min(MIN_STABILITY_SAMPLES)
      .max(MAX_STABILITY_SAMPLES)
      .optional(),
    timeoutMs: z
      .number()
      .int()
      .min(MIN_CONTRACT_TIMEOUT_MS)
      .max(MAX_CONTRACT_TIMEOUT_MS)
      .optional(),
    // true = hide with the built-in default selector; a string = hide with a custom
    // selector; omitted = devtools hiding is off.
    devtoolsSelector: z.union([z.literal(true), nonEmptyTrimmed]).optional(),
    deviceScaleFactor: z.number().positive().max(4).optional(),
    fontPolicy: z.enum(["required", "warn"]).optional(),
    animationPolicy: z.enum(["freeze", "allow"]).optional(),
    retry: z
      .object({
        attempts: z.number().int().min(1).max(5),
        delayMs: z.number().int().min(0).max(MAX_CONTRACT_TIMEOUT_MS),
      })
      .strict()
      .optional(),
    // README documents this field as only able to lower the conservative default cap,
    // never raise it — the schema bound must match that default, not a separate number.
    maxMaskedAreaRatio: z.number().min(0).max(DEFAULT_MAX_MASKED_AREA_RATIO).optional(),
  })
  .strict();

export type CaptureDefaults = z.infer<typeof captureDefaultsSchema>;
