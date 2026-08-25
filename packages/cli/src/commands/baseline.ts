import * as path from "node:path";

import { CONTRACT_ID_PATTERN, httpUrlSchema, visualArtifactPath } from "@framelia/contracts";
import { captureAndPromotePageBaseline } from "@framelia/verify";
import type { Command } from "commander";

import { emitResult, positiveInteger, resolveProjectRoot, subcommand } from "./shared.ts";

interface BaselinePromoteOptions {
  key: string;
  targetUrl: string;
  projectRoot?: string;
  selector?: string;
  fullPage?: boolean;
  viewportWidth?: number;
  viewportHeight?: number;
  promotedBy?: string;
  runId?: string;
  note?: string;
  storageState?: string;
  headed?: boolean;
}

function validateContractId(value: string): void {
  if (!CONTRACT_ID_PATTERN.test(value)) {
    throw new Error(
      "--key must use lowercase letters, numbers, dots, or hyphens, e.g. home.desktop.",
    );
  }
}

function validateTargetUrl(value: string): void {
  if (!httpUrlSchema.safeParse(value).success) {
    throw new Error("--target-url must use http:// or https://.");
  }
}

/** Best-effort default so a local `framelia baseline promote` doesn't require typing
 *  --promoted-by every time; CI should still pass it explicitly (e.g. the actor/run id). */
function defaultPromotedBy(): string {
  return (
    process.env.FRAMELIA_PROMOTED_BY ??
    process.env.GIT_AUTHOR_EMAIL ??
    process.env.USER ??
    process.env.USERNAME ??
    "unknown"
  );
}

export async function baselinePromoteCommand(options: BaselinePromoteOptions): Promise<void> {
  validateContractId(options.key);
  validateTargetUrl(options.targetUrl);
  if ((options.viewportWidth === undefined) !== (options.viewportHeight === undefined)) {
    throw new Error("--viewport-width and --viewport-height must be supplied together.");
  }

  const projectRoot = resolveProjectRoot(options.projectRoot);
  const outDir = path.join(projectRoot, visualArtifactPath(options.key));
  const promotedBy = options.promotedBy ?? defaultPromotedBy();

  const result = await captureAndPromotePageBaseline({
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
    emitResult({ key: options.key, error: result.error, message: result.message }, false);
    return;
  }
  emitResult(
    {
      key: options.key,
      outDir: path.relative(projectRoot, outDir) || ".",
      baselinePath: result.baselinePath,
      version: result.meta.current.version,
      promotedAt: result.meta.current.promotedAt,
      promotedBy: result.meta.current.promotedBy,
      ...(result.archivedPath ? { archivedPath: result.archivedPath } : {}),
    },
    true,
  );
}

export function registerBaselineCommands(program: Command): void {
  const baseline = subcommand(
    "baseline",
    "Manage promoted page-to-page baselines used by toMatchPageBaseline.",
  );

  baseline.addCommand(
    subcommand(
      "promote",
      "Capture the target URL's current state and accept it as the new toMatchPageBaseline baseline.",
    )
      .requiredOption("--key <id>", "baseline key, e.g. home.desktop")
      .requiredOption("--target-url <url>", "page URL to capture")
      .option("--project-root <dir>", "target project root")
      .option(
        "--selector <css>",
        "CSS selector to scope the capture to (region instead of full page)",
      )
      .option("--full-page", "capture the full scrollable page")
      .option("--viewport-width <n>", "viewport width in px", positiveInteger)
      .option("--viewport-height <n>", "viewport height in px", positiveInteger)
      .option("--promoted-by <who>", "who is accepting this baseline (defaults to $USER)")
      .option("--run-id <id>", "CI run id/URL to record alongside this promotion")
      .option("--note <text>", "why this baseline was promoted")
      .option(
        "--storage-state <path>",
        "Playwright storage-state file for an authenticated capture",
      )
      .option("--headed", "run the capture browser headed (defaults to headless)")
      .action(baselinePromoteCommand),
  );

  program.addCommand(baseline);
}
