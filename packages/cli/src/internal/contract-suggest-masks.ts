import { httpUrlSchema } from "@framelia/contracts";
import { suggestMasksForUrl } from "@framelia/verify/cli";
import { z } from "zod";

import { usageErrorFromZodError } from "../errors.ts";

const suggestMasksOptionsSchema = z
  .object({
    targetUrl: z.string(),
    viewportWidth: z.number().int().positive().optional(),
    viewportHeight: z.number().int().positive().optional(),
  })
  .superRefine((data, ctx) => {
    if (!httpUrlSchema.safeParse(data.targetUrl).success) {
      ctx.addIssue({ code: "custom", message: "--target-url must use http:// or https://." });
    }
    if ((data.viewportWidth === undefined) !== (data.viewportHeight === undefined)) {
      ctx.addIssue({
        code: "custom",
        message: "--viewport-width and --viewport-height must be supplied together.",
      });
    }
  });

export interface SuggestMasksOptions {
  readonly targetUrl: string;
  readonly viewportWidth: number | undefined;
  readonly viewportHeight: number | undefined;
  readonly storageState: string | undefined;
  readonly headed: boolean | undefined;
}

export interface SuggestMasksResult {
  readonly ok: boolean;
  readonly body: unknown;
}

/** Injectable seam over the Playwright-backed scan, so tests never launch a real
 *  browser -- same default-parameter DI shape as `internal/auth.ts`'s `AuthDependencies`
 *  and `internal/baseline-promote.ts`'s `BaselinePromoteDependencies`. */
export interface SuggestMasksDependencies {
  readonly suggestMasksForUrl: typeof suggestMasksForUrl;
}

const defaultDependencies: SuggestMasksDependencies = { suggestMasksForUrl };

/**
 * `framelia contract suggest-masks` (#42): scans a live page for common
 * dynamic-content signals (see @framelia/verify's mask-suggest.ts) and returns
 * candidate `masks[]` entries. Always proposals only -- this never reads or
 * writes a contract file; accepting a suggestion is a manual edit the caller
 * makes to their own contract.
 */
export async function suggestMasksCommand(
  options: SuggestMasksOptions,
  deps: SuggestMasksDependencies = defaultDependencies,
): Promise<SuggestMasksResult> {
  const parsed = suggestMasksOptionsSchema.safeParse(options);
  if (!parsed.success) throw usageErrorFromZodError(parsed.error);

  const result = await deps.suggestMasksForUrl({
    url: options.targetUrl,
    ...(options.viewportWidth !== undefined && options.viewportHeight !== undefined
      ? { viewport: { width: options.viewportWidth, height: options.viewportHeight } }
      : {}),
    storageStatePath: options.storageState,
    headless: !options.headed,
  });

  if (!result.ok) {
    return { ok: false, body: { error: result.error, message: result.message } };
  }
  return {
    ok: true,
    body: {
      url: result.url,
      suggestions: result.suggestions,
      note: "Proposals only -- nothing was written to any contract. Review and add the selectors you accept to the contract's masks[] yourself.",
    },
  };
}
