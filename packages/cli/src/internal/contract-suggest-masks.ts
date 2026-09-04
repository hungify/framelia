import { suggestMasksForUrl } from "@framelia/verify/cli";
import { z } from "zod";

import { usageErrorFromZodError } from "../exit.ts";
import type { CliResult } from "../output.ts";
import { targetUrlMessage, viewportPairMessage } from "./browser-input.ts";

const suggestMasksOptionsSchema = z
  .object({
    targetUrl: z.string(),
    viewportWidth: z.number().int().positive().optional(),
    viewportHeight: z.number().int().positive().optional(),
    storageState: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    const urlMessage = targetUrlMessage(data.targetUrl, "--target-url", {
      carriesBrowserStorageState: data.storageState !== undefined,
    });
    if (urlMessage) ctx.addIssue({ code: "custom", message: urlMessage });
    const pairMessage = viewportPairMessage(data.viewportWidth, data.viewportHeight);
    if (pairMessage) ctx.addIssue({ code: "custom", message: pairMessage });
  });

export interface SuggestMasksOptions {
  readonly targetUrl: string;
  readonly viewportWidth: number | undefined;
  readonly viewportHeight: number | undefined;
  readonly storageState: string | undefined;
  readonly headed: boolean | undefined;
}

export type SuggestMasksResult = CliResult<unknown>;

export interface SuggestMasksDependencies {
  readonly suggestMasksForUrl: typeof suggestMasksForUrl;
}

const defaultDependencies: SuggestMasksDependencies = { suggestMasksForUrl };

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
