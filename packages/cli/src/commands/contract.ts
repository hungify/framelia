import { suggestMasksForUrl } from "@framelia/verify/cli";
import { Option, type Command } from "commander";

import {
  runCreateContract,
  SCOPE_KINDS,
  VIEWPORT_PRESETS,
  type CreateContractOptions,
} from "../contract.ts";
import {
  emitResult,
  positiveInteger,
  requirePairedViewport,
  resolveProjectRoot,
  subcommand,
  validateTargetUrl,
} from "./shared.ts";

type CreateContractFlags = Omit<CreateContractOptions, "projectRoot"> & { projectRoot?: string };

interface SuggestMasksOptions {
  targetUrl: string;
  viewportWidth?: number;
  viewportHeight?: number;
  storageState?: string;
  headed?: boolean;
}

/**
 * `framelia contract suggest-masks` (#42): scans a live page for common
 * dynamic-content signals (see @framelia/verify's mask-suggest.ts) and prints
 * candidate `masks[]` entries. Always proposals only -- this never reads or
 * writes a contract file; accepting a suggestion is a manual edit the caller
 * makes to their own contract.
 */
export async function suggestMasksCommand(options: SuggestMasksOptions): Promise<void> {
  validateTargetUrl(options.targetUrl);
  requirePairedViewport(options.viewportWidth, options.viewportHeight);

  const result = await suggestMasksForUrl({
    url: options.targetUrl,
    ...(options.viewportWidth !== undefined && options.viewportHeight !== undefined
      ? { viewport: { width: options.viewportWidth, height: options.viewportHeight } }
      : {}),
    storageStatePath: options.storageState,
    headless: !options.headed,
  });

  if (!result.ok) {
    emitResult({ error: result.error, message: result.message }, false);
    return;
  }
  emitResult(
    {
      url: result.url,
      suggestions: result.suggestions,
      note: "Proposals only -- nothing was written to any contract. Review and add the selectors you accept to the contract's masks[] yourself.",
    },
    true,
  );
}

export function registerContractCommands(program: Command): void {
  const contract = subcommand("contract", "Create and manage visual contracts.");

  contract.addCommand(
    subcommand(
      "create",
      "Create a schema-v4 visual contract. Prompts interactively for any flag left unset.",
    )
      .option("--project-root <dir>", "target project root")
      .option("--output <path>", "contract path relative to project root")
      .option("--force", "replace existing contract")
      .option("--target-url <url>", "target application URL")
      .option("--contract-id <id>", "contract id, e.g. home.desktop")
      .option("--file-key <key>", "Figma file key")
      .option("--node-id <id>", "Figma node id, e.g. 153:5181")
      .addOption(
        new Option("--viewport <preset>", "desktop, mobile, or custom").choices(VIEWPORT_PRESETS),
      )
      .option("--viewport-name <name>", "viewport name (with --viewport custom)")
      .option(
        "--viewport-width <n>",
        "viewport width in px (with --viewport custom)",
        positiveInteger,
      )
      .option(
        "--viewport-height <n>",
        "viewport height in px (with --viewport custom)",
        positiveInteger,
      )
      .addOption(new Option("--scope <kind>", "page or region").choices(SCOPE_KINDS))
      .option(
        "--page-reason <text>",
        "why the baseline represents the complete page (with --scope page)",
      )
      .option(
        "--style-check-selector <css>",
        "CSS selector for one style check-point (with --scope page; pairs with --style-check-node-id)",
      )
      .option(
        "--style-check-node-id <id>",
        "Figma node id for the style check-point (with --style-check-selector)",
      )
      .option("--selector <css>", "CSS selector for the captured region (with --scope region)")
      .option(
        "--region-width <n>",
        "expected region width in px (with --scope region)",
        positiveInteger,
      )
      .option(
        "--region-height <n>",
        "expected region height in px (with --scope region)",
        positiveInteger,
      )
      .action(({ output, ...options }: CreateContractFlags & { output?: string }) =>
        runCreateContract({
          ...options,
          projectRoot: resolveProjectRoot(options.projectRoot),
          outputPath: output,
        }),
      ),
  );

  contract.addCommand(
    subcommand(
      "suggest-masks",
      "Scan a live page for common dynamic-content signals and propose mask selectors. Proposals only -- never writes to a contract.",
    )
      .requiredOption("--target-url <url>", "page URL to scan")
      .option("--viewport-width <n>", "viewport width in px", positiveInteger)
      .option("--viewport-height <n>", "viewport height in px", positiveInteger)
      .option("--storage-state <path>", "Playwright storage-state file for an authenticated scan")
      .option("--headed", "run the scan browser headed (defaults to headless)")
      .action(suggestMasksCommand),
  );

  program.addCommand(contract);
}
