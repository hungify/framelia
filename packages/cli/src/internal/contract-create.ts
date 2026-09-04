import * as path from "node:path";

import * as p from "@clack/prompts";
import {
  CONTRACT_ID_PATTERN,
  FIGMA_NODE_ID,
  httpUrlSchema,
  VISUAL_CONTRACT_FILE,
  visualArtifactPath,
  type ExpectStyle,
  type StyleCheckPoint,
} from "@framelia/contracts";
import { deriveExpectStyle, resolveNodeSpec } from "@framelia/verify";
import { z } from "zod";

import type { ScopeKind, ViewportPreset } from "../cli-constants.ts";
import { UsageError, usageErrorFromZodError } from "../errors.ts";
import type { CliRuntime } from "../runtime-types.ts";
import {
  createContractRequest,
  writeContractRequest,
  type ContractAnswers,
} from "./contract-scaffold.ts";

type BaselineAnswers = ContractAnswers["baseline"];

/**
 * Everything contractCreateCommand needs from @clack/prompts, as a seam: the real
 * module in production, a scripted fake in tests. Lets the branch structure
 * (custom viewport, region scope, cancellation) be exercised directly instead
 * of only through a full CLI subprocess with every flag supplied. Kept from the old
 * `src/contract.ts` design unchanged -- the rewrite plan calls this an "existing prompt
 * seam" to preserve, unlike auth's `AuthPromptAdapter`, which had no prior seam at all.
 */
export interface PromptAdapter {
  text(options: Parameters<typeof p.text>[0]): ReturnType<typeof p.text>;
  select<T extends string>(
    options: Parameters<typeof p.select<T>>[0],
  ): ReturnType<typeof p.select<T>>;
  cancel(message: string): void;
  isCancel(value: unknown): boolean;
  intro(message: string): void;
  outro(message: string): void;
  warn(message: string): void;
}

export const realPromptAdapter: PromptAdapter = {
  text: (options) => p.text(options),
  select: (options) => p.select(options),
  cancel: (message) => p.cancel(message),
  isCancel: (value) => p.isCancel(value),
  intro: (message) => p.intro(message),
  outro: (message) => p.outro(message),
  warn: (message) => p.log.warn(message),
};

/** Cancellation exits `1` with a documented message and writes no file -- routed through
 *  the injected `runtime.exitCode` (the same underlying field as `context.process.exitCode`,
 *  see `context.ts`'s `buildContext`), never global `process.exitCode`. */
function cancelled(prompts: PromptAdapter, runtime: CliRuntime, value: unknown): value is symbol {
  if (!prompts.isCancel(value)) return false;
  prompts.cancel("Setup cancelled.");
  runtime.exitCode = 1;
  return true;
}

function validateHttpUrl(value: string | undefined): string | undefined {
  if (value == null) return "Required.";
  return httpUrlSchema.safeParse(value).success ? undefined : "Enter an http:// or https:// URL.";
}

function validatePositiveInteger(value: string | undefined): string | undefined {
  if (value == null) return "Required.";
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? undefined : "Enter a positive integer.";
}

function required(value: string | undefined): string | undefined {
  return value?.trim() ? undefined : "Required.";
}

function validateContractId(value: string | undefined): string | undefined {
  return CONTRACT_ID_PATTERN.test(value ?? "")
    ? undefined
    : "Use lowercase letters, numbers, dots, or hyphens.";
}

function validateNodeId(value: string | undefined): string | undefined {
  return FIGMA_NODE_ID.test(value ?? "") ? undefined : "Enter a Figma node ID such as 153:5181.";
}

/** Validates a flag value with a prompt-style validator, raising a CLI usage error on failure. */
function requireFlag<T>(flagName: string, value: T, validate: (value: T) => string | undefined): T {
  const message = validate(value);
  if (message) throw new UsageError(`${flagName}: ${message}`);
  return value;
}

/** Resolves one field: the flag if supplied (validated as a CLI usage error), otherwise
 * an interactive prompt with the same validator. Every prompted field in this command
 * goes through here, so a flag can always stand in for the prompt it replaces. */
async function resolveField(
  flagName: string,
  flagValue: string | undefined,
  validate: (value: string | undefined) => string | undefined,
  prompt: () => Promise<string | undefined>,
): Promise<string | undefined> {
  return flagValue !== undefined ? requireFlag(flagName, flagValue, validate) : await prompt();
}

async function text(
  prompts: PromptAdapter,
  runtime: CliRuntime,
  options: Parameters<typeof p.text>[0],
): Promise<string | undefined> {
  const value = await prompts.text(options);
  return cancelled(prompts, runtime, value) ? undefined : value;
}

async function select<T extends string>(
  prompts: PromptAdapter,
  runtime: CliRuntime,
  options: Parameters<typeof p.select<T>>[0],
): Promise<T | undefined> {
  const value = await prompts.select<T>(options);
  return cancelled(prompts, runtime, value) ? undefined : value;
}

async function positiveIntegerText(
  prompts: PromptAdapter,
  runtime: CliRuntime,
  message: string,
  placeholder?: string,
): Promise<number | undefined> {
  const value = await text(prompts, runtime, {
    message,
    placeholder,
    validate: validatePositiveInteger,
  });
  return value === undefined ? undefined : Number(value);
}

/**
 * Best-effort: bakes the Figma node's expected text style into the contract.
 * Never blocks contract creation -- a missing token or network error just means
 * the contract ships without expectStyle, same as before this existed. `token` is
 * passed explicitly from the injected `runtime.env`, not read implicitly from global
 * `process.env` (which `resolveNodeSpec` would otherwise fall back to).
 */
async function tryFetchExpectStyle(
  prompts: PromptAdapter,
  runtime: CliRuntime,
  fileKey: string,
  nodeId: string,
  purpose = "expected component style",
): Promise<ExpectStyle | undefined> {
  const resolved = await resolveNodeSpec({
    fileKey,
    nodeId,
    token: runtime.env.FIGMA_ACCESS_TOKEN,
    gateName: "contract create",
    purpose,
  });
  if (!resolved.ok) {
    prompts.warn(`Skipping expected-style bake-in: ${resolved.warning}`);
    return undefined;
  }
  return deriveExpectStyle(resolved.meta);
}

/**
 * A single style check-point supplied entirely via flags: `--style-check-selector` and
 * `--style-check-node-id` must arrive together (enforced upfront by
 * `contractCreateFlagsSchema`, not re-checked here). Its expectStyle is baked in the
 * same way the interactive loop below bakes each of its own.
 */
async function buildFlagStyleCheck(
  prompts: PromptAdapter,
  runtime: CliRuntime,
  fileKey: string,
  options: Pick<ContractCreateOptions, "styleCheckSelector" | "styleCheckNodeId">,
): Promise<StyleCheckPoint | undefined> {
  const { styleCheckSelector, styleCheckNodeId } = options;
  if (styleCheckSelector === undefined || styleCheckNodeId === undefined) return undefined;
  const expectStyle = await tryFetchExpectStyle(
    prompts,
    runtime,
    fileKey,
    styleCheckNodeId,
    "expected style for this check-point",
  );
  return {
    selector: styleCheckSelector,
    nodeId: styleCheckNodeId,
    ...(expectStyle ? { expectStyle } : {}),
  };
}

/**
 * Interactive loop offering to add page-scope style check-points one at a time --
 * each is a CSS selector paired with its own Figma node (distinct from the page
 * contract's own baseline node). Runs only when the surrounding page setup is itself
 * interactive (see its call site); a fully flag-driven page contract skips it so a
 * scripted invocation never blocks on an unscripted prompt.
 */
async function collectPageStyleChecks(
  prompts: PromptAdapter,
  runtime: CliRuntime,
  fileKey: string,
): Promise<StyleCheckPoint[] | undefined> {
  const checkPoints: StyleCheckPoint[] = [];
  for (;;) {
    const action = await select<"add" | "done">(prompts, runtime, {
      message:
        checkPoints.length > 0 ? "Add another style check-point?" : "Add a style check-point?",
      options: [
        { value: "add", label: "Add a check-point" },
        {
          value: "done",
          label: checkPoints.length > 0 ? "Done" : "Skip — no style check-points",
        },
      ],
    });
    if (!action) return undefined;
    if (action === "done") break;

    const selector = await text(prompts, runtime, {
      message: "CSS selector for this style check-point",
      placeholder: "[data-testid=hero-heading]",
      validate: required,
    });
    if (!selector) return undefined;

    const nodeId = await text(prompts, runtime, {
      message: "Figma node ID for this style check-point",
      placeholder: "153:5181",
      validate: validateNodeId,
    });
    if (!nodeId) return undefined;

    const expectStyle = await tryFetchExpectStyle(
      prompts,
      runtime,
      fileKey,
      nodeId,
      "expected style for this check-point",
    );
    checkPoints.push({
      selector,
      nodeId,
      ...(expectStyle ? { expectStyle } : {}),
    });
  }
  return checkPoints;
}

export interface ContractCreateOptions {
  readonly projectRoot: string | undefined;
  readonly outputPath: string | undefined;
  readonly force: boolean | undefined;
  readonly targetUrl: string | undefined;
  readonly contractId: string | undefined;
  readonly name: string | undefined;
  readonly fileKey: string | undefined;
  readonly nodeId: string | undefined;
  readonly viewport: ViewportPreset | undefined;
  readonly viewportName: string | undefined;
  readonly viewportWidth: number | undefined;
  readonly viewportHeight: number | undefined;
  readonly scope: ScopeKind | undefined;
  readonly pageReason: string | undefined;
  readonly styleCheckSelector: string | undefined;
  readonly styleCheckNodeId: string | undefined;
  readonly selector: string | undefined;
  readonly regionWidth: number | undefined;
  readonly regionHeight: number | undefined;
}

/**
 * The one command-level Zod schema (see the rewrite plan's "Validation seam" section).
 * Covers flag-level format and cross-field checks that don't depend on which fields
 * ended up prompted -- so an invalid flag combination is rejected before any prompt is
 * shown, without duplicating the format checks `resolveField`'s own per-field validators
 * already perform for the prompt path. Each issue is added without a Zod `path` so
 * `usageErrorFromZodError` reproduces the exact historical message text when only one
 * issue fires (see Phase 4/7 precedent).
 *
 * `--viewport-width`/`--viewport-height` are a HARD pairing here (both-or-neither),
 * unlike the old CLI, which let one arrive via flag and silently prompted for the
 * other. This is a deliberate, documented behavior change: the plan's command table,
 * "Flag ↔ Zod note", and Phase 8 bullet list all explicitly call out both
 * viewport-width/height and style-check-selector/node-id as "paired" validation --
 * consistent with `baseline promote`'s and `suggest-masks`'s existing pairing rule
 * elsewhere in this CLI. `--region-width`/`--region-height` is NOT similarly paired
 * (the plan never lists it as such), so it keeps the old soft prompt-for-the-missing-half
 * fallback below.
 */
const contractCreateFlagsSchema = z
  .object({
    targetUrl: z.string().optional(),
    contractId: z.string().optional(),
    nodeId: z.string().optional(),
    viewportWidth: z.number().int().positive().optional(),
    viewportHeight: z.number().int().positive().optional(),
    regionWidth: z.number().int().positive().optional(),
    regionHeight: z.number().int().positive().optional(),
    styleCheckSelector: z.string().optional(),
    styleCheckNodeId: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.targetUrl !== undefined && !httpUrlSchema.safeParse(data.targetUrl).success) {
      ctx.addIssue({ code: "custom", message: "--target-url: Enter an http:// or https:// URL." });
    }
    if (data.contractId !== undefined && !CONTRACT_ID_PATTERN.test(data.contractId)) {
      ctx.addIssue({
        code: "custom",
        message: "--contract-id: Use lowercase letters, numbers, dots, or hyphens.",
      });
    }
    if (data.nodeId !== undefined && !FIGMA_NODE_ID.test(data.nodeId)) {
      ctx.addIssue({
        code: "custom",
        message: "--node-id: Enter a Figma node ID such as 153:5181.",
      });
    }
    if ((data.viewportWidth === undefined) !== (data.viewportHeight === undefined)) {
      ctx.addIssue({
        code: "custom",
        message: "--viewport-width and --viewport-height must be supplied together.",
      });
    }
    if ((data.styleCheckSelector === undefined) !== (data.styleCheckNodeId === undefined)) {
      ctx.addIssue({
        code: "custom",
        message: "--style-check-selector and --style-check-node-id must be supplied together.",
      });
    } else if (data.styleCheckNodeId !== undefined && !FIGMA_NODE_ID.test(data.styleCheckNodeId)) {
      ctx.addIssue({
        code: "custom",
        message: "--style-check-node-id: Enter a Figma node ID such as 153:5181.",
      });
    }
  });

export async function contractCreateCommand(
  options: ContractCreateOptions,
  runtime: CliRuntime,
  promptsInput: PromptAdapter = realPromptAdapter,
): Promise<void> {
  // Tracks whether any field so far was actually prompted for (as opposed to supplied by
  // flag) -- the signal for whether this invocation is interactive at all. Gating the page
  // style-check loop on one specific flag's presence (e.g. --page-reason) breaks as soon as
  // a *different* field is left to prompt in the same run; this tracks the whole session.
  let promptedAnyField = false;
  const prompts: PromptAdapter = {
    ...promptsInput,
    text: (promptOptions) => {
      promptedAnyField = true;
      return promptsInput.text(promptOptions);
    },
    select: (promptOptions) => {
      promptedAnyField = true;
      return promptsInput.select(promptOptions);
    },
  };

  // `intro`/`outro`/`warn`/`cancel` are one-way banners, not interactive prompts -- only
  // `text`/`select` block on user input. The old CLI called `intro` unconditionally before
  // any validation; matching that exact ordering (rather than validating first) keeps
  // stderr output byte-identical for a flag-only invocation that fails validation, without
  // weakening the "rejects ... without launching an interactive prompt" guarantee the two
  // checks below already provide (neither ever calls `text`/`select`).
  prompts.intro("Create Framelia visual contract");

  const parsedFlags = contractCreateFlagsSchema.safeParse(options);
  if (!parsedFlags.success) throw usageErrorFromZodError(parsedFlags.error);

  // scope=page gating for style-check flags depends on the RESOLVED scope, which may
  // itself come from a prompt below -- so it can't be folded into the upfront schema
  // above (control flow, not format validation; see the rewrite plan's framing).
  if (
    options.scope !== undefined &&
    options.scope !== "page" &&
    (options.styleCheckSelector !== undefined || options.styleCheckNodeId !== undefined)
  ) {
    throw new UsageError("--style-check-selector and --style-check-node-id require --scope page.");
  }

  const targetUrl = await resolveField("--target-url", options.targetUrl, validateHttpUrl, () =>
    text(prompts, runtime, {
      message: "Target application URL",
      placeholder: "http://127.0.0.1:3000",
      initialValue: "http://127.0.0.1:3000",
      validate: validateHttpUrl,
    }),
  );
  if (!targetUrl) return;

  const contractId = await resolveField(
    "--contract-id",
    options.contractId,
    validateContractId,
    () =>
      text(prompts, runtime, {
        message: "Contract ID",
        placeholder: "home.desktop",
        initialValue: "home.desktop",
        validate: validateContractId,
      }),
  );
  if (!contractId) return;

  const name = await resolveField("--name", options.name, required, () =>
    text(prompts, runtime, {
      message: "Display name (just this contract -- the feature is already grouped)",
      placeholder: "Desktop",
      validate: required,
    }),
  );
  if (!name) return;

  const fileKey = await resolveField("--file-key", options.fileKey, required, () =>
    text(prompts, runtime, { message: "Figma file key", validate: required }),
  );
  if (!fileKey) return;

  const nodeId = await resolveField("--node-id", options.nodeId, validateNodeId, () =>
    text(prompts, runtime, {
      message: "Figma node ID",
      placeholder: "153:5181",
      validate: validateNodeId,
    }),
  );
  if (!nodeId) return;
  const baseline: BaselineAnswers = { kind: "figma", fileKey, nodeId };

  const viewportPreset =
    options.viewport ??
    (await select<"desktop" | "mobile" | "custom">(prompts, runtime, {
      message: "Viewport",
      options: [
        { value: "desktop", label: "Desktop", hint: "1440 × 1024" },
        { value: "mobile", label: "Mobile", hint: "390 × 844" },
        { value: "custom", label: "Custom" },
      ],
    }));
  if (!viewportPreset) return;

  let viewport: ContractAnswers["viewport"];
  if (viewportPreset === "custom") {
    const viewportPresetName = await resolveField(
      "--viewport-name",
      options.viewportName,
      required,
      () =>
        text(prompts, runtime, {
          message: "Viewport name",
          placeholder: "tablet",
          validate: required,
        }),
    );
    if (!viewportPresetName) return;
    const width =
      options.viewportWidth ?? (await positiveIntegerText(prompts, runtime, "Viewport width"));
    if (width === undefined) return;
    const height =
      options.viewportHeight ?? (await positiveIntegerText(prompts, runtime, "Viewport height"));
    if (height === undefined) return;
    viewport = { preset: viewportPresetName, width, height };
  } else {
    viewport =
      viewportPreset === "desktop"
        ? { preset: "desktop", width: 1440, height: 1024 }
        : { preset: "mobile", width: 390, height: 844 };
  }

  const scopeKind =
    options.scope ??
    (await select<"page" | "region">(prompts, runtime, {
      message: "Capture scope",
      options: [
        { value: "page", label: "Full page" },
        { value: "region", label: "Element or region" },
      ],
    }));
  if (!scopeKind) return;

  let scope: ContractAnswers["scope"];
  if (scopeKind === "page") {
    const pageReason = await resolveField("--page-reason", options.pageReason, required, () =>
      text(prompts, runtime, {
        message: "Why does baseline represent complete page?",
        placeholder: "Baseline node represents complete page.",
        initialValue: "Baseline node represents complete page.",
        validate: required,
      }),
    );
    if (!pageReason) return;

    const flagStyleCheck = await buildFlagStyleCheck(prompts, runtime, fileKey, options);
    const styleChecks = flagStyleCheck ? [flagStyleCheck] : [];
    // Skip the interactive loop only when nothing at all has been prompted for yet --
    // a fully flag-driven invocation. The moment any field along the way came from a
    // real prompt, this session is interactive and the loop stays on offer, even if
    // --page-reason itself happened to be a flag (add more via hand-editing otherwise).
    if (promptedAnyField) {
      const collected = await collectPageStyleChecks(prompts, runtime, fileKey);
      if (collected === undefined) return;
      styleChecks.push(...collected);
    }

    scope = {
      kind: "page",
      pageReason,
      ...(styleChecks.length > 0 ? { styleChecks } : {}),
    };
  } else {
    // Mirrors the upfront flag-only check above -- that one can't see a scope resolved
    // by the prompt (scopeKind here), so a prompted "region" answer needs its own gate
    // or these flags get silently dropped instead of rejected.
    if (options.styleCheckSelector !== undefined || options.styleCheckNodeId !== undefined) {
      throw new UsageError(
        "--style-check-selector and --style-check-node-id require --scope page.",
      );
    }
    const selector = await resolveField("--selector", options.selector, required, () =>
      text(prompts, runtime, {
        message: "CSS selector",
        placeholder: "[data-testid=card]",
        validate: required,
      }),
    );
    if (!selector) return;
    const width =
      options.regionWidth ?? (await positiveIntegerText(prompts, runtime, "Expected region width"));
    if (width === undefined) return;
    const height =
      options.regionHeight ??
      (await positiveIntegerText(prompts, runtime, "Expected region height"));
    if (height === undefined) return;
    const expectStyle = await tryFetchExpectStyle(
      prompts,
      runtime,
      baseline.fileKey,
      baseline.nodeId,
    );
    scope = {
      kind: "region",
      selector,
      expectSize: { width, height },
      ...(expectStyle ? { expectStyle } : {}),
    };
  }

  const request = createContractRequest({
    targetUrl,
    contractId,
    name,
    baseline,
    viewport,
    scope,
  });
  const featureName = contractId.split(".")[0] ?? contractId;
  const projectRoot = path.resolve(runtime.cwd(), options.projectRoot ?? ".");
  const outputPath = path.resolve(
    projectRoot,
    options.outputPath ?? visualArtifactPath(featureName, VISUAL_CONTRACT_FILE),
  );
  const outcome = writeContractRequest(outputPath, request, options.force);
  const verb =
    outcome === "created"
      ? "Created"
      : outcome === "added"
        ? "Added contract to"
        : "Replaced contract in";
  prompts.outro(`${verb} ${outputPath}`);
}
