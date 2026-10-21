import * as path from "node:path";

import { CONTRACT_ID_PATTERN, visualArtifactPath } from "@framelia/contracts";
import { z } from "zod";

import type { CommandEnvironment } from "../environment.ts";
import { EXIT_USAGE_ERROR, usageErrorFromZodError } from "../exit.ts";
import type { CliResult } from "../output.ts";
import { targetUrlMessage, viewportPairMessage } from "./browser-input.ts";
import { openProject } from "./project.ts";

const baselinePromoteOptionsSchema = z
  .object({
    key: z.string(),
    targetUrl: z.string(),
    viewportWidth: z.number().int().positive().optional(),
    viewportHeight: z.number().int().positive().optional(),
    storageState: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (!CONTRACT_ID_PATTERN.test(data.key)) {
      ctx.addIssue({
        code: "custom",
        message: "--key must use lowercase letters, numbers, dots, or hyphens, e.g. home.desktop.",
      });
    }
    const urlMessage = targetUrlMessage(data.targetUrl, "--target-url", {
      carriesBrowserStorageState: data.storageState !== undefined,
    });
    if (urlMessage) ctx.addIssue({ code: "custom", message: urlMessage });
    const pairMessage = viewportPairMessage(data.viewportWidth, data.viewportHeight);
    if (pairMessage) ctx.addIssue({ code: "custom", message: pairMessage });
  });

export interface BaselinePromoteOptions {
  readonly key: string;
  readonly targetUrl: string;
  readonly projectRoot: string | undefined;
  readonly selector: string | undefined;
  readonly fullPage: boolean | undefined;
  readonly viewportWidth: number | undefined;
  readonly viewportHeight: number | undefined;
  readonly promotedBy: string | undefined;
  readonly runId: string | undefined;
  readonly note: string | undefined;
  readonly storageState: string | undefined;
  readonly headed: boolean | undefined;
}

export type BaselinePromoteResult = CliResult<unknown>;

function defaultPromotedBy(env: NodeJS.ProcessEnv): string {
  return env.FRAMELIA_PROMOTED_BY ?? env.GIT_AUTHOR_EMAIL ?? env.USER ?? env.USERNAME ?? "unknown";
}

export async function baselinePromoteCommand(
  options: BaselinePromoteOptions,
  env: CommandEnvironment,
): Promise<BaselinePromoteResult> {
  const runtime = env.process;
  const parsed = baselinePromoteOptionsSchema.safeParse(options);
  if (!parsed.success) throw usageErrorFromZodError(parsed.error);

  const project = openProject(options.projectRoot, runtime);
  const outDir = project.resolve(visualArtifactPath(options.key));
  const promotedBy = options.promotedBy ?? defaultPromotedBy(runtime.env);

  const browser = await env.adapters.browser();
  const result = await browser.captureAndPromote({
    url: options.targetUrl,
    outDir,
    promotedBy,
    runId: options.runId,
    note: options.note,
    selector: options.selector,
    fullPage: options.fullPage,
    ...(options.viewportWidth !== undefined && options.viewportHeight !== undefined
      ? { viewport: { width: options.viewportWidth, height: options.viewportHeight } }
      : {}),
    storageStatePath: options.storageState,
    headless: !options.headed,
  });

  if (!result.ok) {
    return {
      ok: false,
      exitCode: EXIT_USAGE_ERROR,
      body: { key: options.key, error: result.error, message: result.message },
    };
  }
  return {
    ok: true,
    body: {
      key: options.key,
      outDir: path.relative(project.root, outDir) || ".",
      baselinePath: result.baselinePath,
      version: result.meta.current.version,
      promotedAt: result.meta.current.promotedAt,
      promotedBy: result.meta.current.promotedBy,
      ...(result.archivedPath ? { archivedPath: result.archivedPath } : {}),
    },
  };
}
