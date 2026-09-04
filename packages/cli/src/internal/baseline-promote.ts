import * as path from "node:path";

import { CONTRACT_ID_PATTERN, httpUrlSchema, visualArtifactPath } from "@framelia/contracts";
import { captureAndPromotePageBaseline } from "@framelia/verify/cli";
import { z } from "zod";

import { usageErrorFromZodError } from "../errors.ts";
import type { CliRuntime } from "../runtime-types.ts";
import { resolveProjectRoot } from "./project-root.ts";
import { assertSecureUrl } from "./secure-url.ts";

const baselinePromoteOptionsSchema = z
  .object({
    key: z.string(),
    targetUrl: z.string(),
    viewportWidth: z.number().int().positive().optional(),
    viewportHeight: z.number().int().positive().optional(),
  })
  .superRefine((data, ctx) => {
    if (!CONTRACT_ID_PATTERN.test(data.key)) {
      ctx.addIssue({
        code: "custom",
        message: "--key must use lowercase letters, numbers, dots, or hyphens, e.g. home.desktop.",
      });
    }
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

export interface BaselinePromoteResult {
  readonly ok: boolean;
  readonly body: unknown;
}

/** Injectable seam over the Playwright-backed capture call, so tests never launch a
 *  real browser -- production uses the real `@framelia/verify/cli` implementation by
 *  default (same default-parameter DI shape as `internal/auth.ts`'s `AuthDependencies`). */
export interface BaselinePromoteDependencies {
  readonly captureAndPromote: typeof captureAndPromotePageBaseline;
}

const defaultDependencies: BaselinePromoteDependencies = {
  captureAndPromote: captureAndPromotePageBaseline,
};

/** Best-effort default so a local `framelia baseline promote` doesn't require typing
 *  --promoted-by every time; CI should still pass it explicitly (e.g. the actor/run id).
 *  Reads the injected runtime's env, never global `process.env`. */
function defaultPromotedBy(env: NodeJS.ProcessEnv): string {
  return env.FRAMELIA_PROMOTED_BY ?? env.GIT_AUTHOR_EMAIL ?? env.USER ?? env.USERNAME ?? "unknown";
}

export async function baselinePromoteCommand(
  options: BaselinePromoteOptions,
  runtime: CliRuntime,
  deps: BaselinePromoteDependencies = defaultDependencies,
): Promise<BaselinePromoteResult> {
  const parsed = baselinePromoteOptionsSchema.safeParse(options);
  if (!parsed.success) throw usageErrorFromZodError(parsed.error);

  // A matching non-Secure cookie in --storage-state can be sent over cleartext HTTP;
  // only require HTTPS (or loopback) when storage state is actually in play.
  if (options.storageState !== undefined) {
    assertSecureUrl(options.targetUrl, "--target-url");
  }

  const projectRoot = resolveProjectRoot(options.projectRoot, runtime);
  const outDir = path.join(projectRoot, visualArtifactPath(options.key));
  const promotedBy = options.promotedBy ?? defaultPromotedBy(runtime.env);

  const result = await deps.captureAndPromote({
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
    return { ok: false, body: { key: options.key, error: result.error, message: result.message } };
  }
  return {
    ok: true,
    body: {
      key: options.key,
      outDir: path.relative(projectRoot, outDir) || ".",
      baselinePath: result.baselinePath,
      version: result.meta.current.version,
      promotedAt: result.meta.current.promotedAt,
      promotedBy: result.meta.current.promotedBy,
      ...(result.archivedPath ? { archivedPath: result.archivedPath } : {}),
    },
  };
}
