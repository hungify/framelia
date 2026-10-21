import { z } from "zod";

import type { CommandEnvironment } from "../environment.ts";
import { UsageError, usageErrorFromZodError } from "../exit.ts";
import type { CliResult } from "../output.ts";
import { targetUrlMessage, viewportPairMessage } from "./browser-input.ts";
import { failureOutcome } from "./outcome.ts";
import { resolveStorageState } from "./storage-state.ts";

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
  readonly projectRoot?: string | undefined;
  readonly viewportWidth: number | undefined;
  readonly viewportHeight: number | undefined;
  /** Defaults to the project's recorded `storageStatePath` when that file exists. */
  readonly storageState: string | undefined;
  readonly headed: boolean | undefined;
}

export type SuggestMasksResult = CliResult<unknown>;

function failure(error: unknown, options: SuggestMasksOptions, extra: object = {}) {
  const result = failureOutcome({
    kind: "framelia.suggest-masks-outcome",
    command: "contract suggest-masks",
    error,
    fallbackCode: "SUGGEST_MASKS_FAILED",
    stage: "suggest-masks",
    projectRoot: options.projectRoot,
  });
  return { ...result, body: { ...result.body, ...extra } };
}

export async function suggestMasksCommand(
  options: SuggestMasksOptions,
  env: Pick<CommandEnvironment, "adapters" | "process">,
): Promise<SuggestMasksResult> {
  try {
    const storageState = await resolveStorageState(
      options.storageState,
      options.targetUrl,
      options.projectRoot,
      env.process,
    );
    const parsed = suggestMasksOptionsSchema.safeParse({ ...options, storageState });
    if (!parsed.success) {
      const error = usageErrorFromZodError(parsed.error);
      throw new UsageError(error.message, { code: "INVALID_INPUT" });
    }

    const browser = await env.adapters.browser();
    const result = await browser.suggestMasksForUrl({
      url: options.targetUrl,
      ...(options.viewportWidth !== undefined && options.viewportHeight !== undefined
        ? { viewport: { width: options.viewportWidth, height: options.viewportHeight } }
        : {}),
      storageStatePath: storageState,
      headless: !options.headed,
    });

    if (!result.ok) {
      // `error`/`message` stay at the top level for callers of the previous body shape.
      return failure(new UsageError(result.message, { code: result.error }), options, {
        error: result.error,
        message: result.message,
      });
    }
    return {
      ok: true,
      body: {
        url: result.url,
        suggestions: result.suggestions,
        note: "Proposals only -- nothing was written to any contract. Review and add the selectors you accept to the contract's masks[] yourself.",
      },
    };
  } catch (error) {
    return failure(error, options);
  }
}
