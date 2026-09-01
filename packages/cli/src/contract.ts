import * as path from "node:path";

import * as p from "@clack/prompts";
import {
  FIGMA_NODE_ID,
  httpUrlSchema,
  VISUAL_CONTRACT_FILE,
  visualArtifactPath,
  type ExpectStyle,
  type StyleCheckPoint,
} from "@framelia/contracts";
import { deriveExpectStyle, resolveNodeSpec } from "@framelia/verify";

import {
  createContractRequest,
  writeContractRequest,
  type ContractAnswers,
} from "./contract/scaffold.ts";

export { createContractRequest, writeContractRequest } from "./contract/scaffold.ts";
export type { WriteContractRequestOutcome } from "./contract/scaffold.ts";

type BaselineAnswers = ContractAnswers["baseline"];

/**
 * Everything runCreateContract needs from @clack/prompts, as a seam: the real
 * module in production, a scripted fake in tests. Lets the branch structure
 * (custom viewport, region scope, cancellation) be exercised directly instead
 * of only through a full CLI subprocess with every flag supplied.
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

function cancelled(prompts: PromptAdapter, value: unknown): value is symbol {
  if (!prompts.isCancel(value)) return false;
  prompts.cancel("Setup cancelled.");
  process.exitCode = 1;
  return true;
}

const CONTRACT_ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

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

/** Validates a flag value with a prompt-style validator, raising a CLI usage error on failure. */
function requireFlag<T>(flagName: string, value: T, validate: (value: T) => string | undefined): T {
  const message = validate(value);
  if (message) throw new Error(`${flagName}: ${message}`);
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
  options: Parameters<typeof p.text>[0],
): Promise<string | undefined> {
  const value = await prompts.text(options);
  return cancelled(prompts, value) ? undefined : value;
}

async function select<T extends string>(
  prompts: PromptAdapter,
  options: Parameters<typeof p.select<T>>[0],
): Promise<T | undefined> {
  const value = await prompts.select<T>(options);
  return cancelled(prompts, value) ? undefined : value;
}

async function positiveIntegerText(
  prompts: PromptAdapter,
  message: string,
  placeholder?: string,
): Promise<number | undefined> {
  const value = await text(prompts, { message, placeholder, validate: validatePositiveInteger });
  return value === undefined ? undefined : Number(value);
}

/**
 * Best-effort: bakes the Figma node's expected text style into the contract.
 * Never blocks contract creation — a missing token or network error just means
 * the contract ships without expectStyle, same as before this existed.
 */
async function tryFetchExpectStyle(
  prompts: PromptAdapter,
  fileKey: string,
  nodeId: string,
  purpose = "expected component style",
): Promise<ExpectStyle | undefined> {
  const resolved = await resolveNodeSpec({
    fileKey,
    nodeId,
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
 * `--style-check-node-id` must arrive together. Its expectStyle is baked in the same way
 * the interactive loop below bakes each of its own.
 */
async function buildFlagStyleCheck(
  prompts: PromptAdapter,
  fileKey: string,
  options: Pick<CreateContractOptions, "styleCheckSelector" | "styleCheckNodeId">,
): Promise<StyleCheckPoint | undefined> {
  const { styleCheckSelector, styleCheckNodeId } = options;
  if (styleCheckSelector === undefined && styleCheckNodeId === undefined) return undefined;
  if (styleCheckSelector === undefined || styleCheckNodeId === undefined) {
    throw new Error("--style-check-selector and --style-check-node-id must be supplied together.");
  }
  requireFlag("--style-check-selector", styleCheckSelector, required);
  requireFlag("--style-check-node-id", styleCheckNodeId, validateNodeId);
  const expectStyle = await tryFetchExpectStyle(
    prompts,
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
  fileKey: string,
): Promise<StyleCheckPoint[] | undefined> {
  const checkPoints: StyleCheckPoint[] = [];
  for (;;) {
    const action = await select<"add" | "done">(prompts, {
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

    const selector = await text(prompts, {
      message: "CSS selector for this style check-point",
      placeholder: "[data-testid=hero-heading]",
      validate: required,
    });
    if (!selector) return undefined;

    const nodeId = await text(prompts, {
      message: "Figma node ID for this style check-point",
      placeholder: "153:5181",
      validate: validateNodeId,
    });
    if (!nodeId) return undefined;

    const expectStyle = await tryFetchExpectStyle(
      prompts,
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

/** Single source of truth for the --viewport choices, shared by CreateContractOptions
 * and commands/contract.ts's flag parser -- adding a preset here is enough. */
export const VIEWPORT_PRESETS = ["desktop", "mobile", "custom"] as const;
export type ViewportPreset = (typeof VIEWPORT_PRESETS)[number];

/** Single source of truth for the --scope choices; see VIEWPORT_PRESETS. */
export const SCOPE_KINDS = ["page", "region"] as const;
export type ScopeKind = (typeof SCOPE_KINDS)[number];

export interface CreateContractOptions {
  projectRoot: string;
  outputPath?: string;
  force?: boolean;
  /** Non-interactive overrides: any field left undefined still prompts interactively. */
  targetUrl?: string;
  contractId?: string;
  name?: string;
  fileKey?: string;
  nodeId?: string;
  viewport?: ViewportPreset;
  viewportName?: string;
  viewportWidth?: number;
  viewportHeight?: number;
  scope?: ScopeKind;
  pageReason?: string;
  /** Single style check-point via flags (with --scope page); selector and nodeId must arrive together. */
  styleCheckSelector?: string;
  styleCheckNodeId?: string;
  selector?: string;
  regionWidth?: number;
  regionHeight?: number;
}

function validateContractId(value: string | undefined): string | undefined {
  return CONTRACT_ID_PATTERN.test(value ?? "")
    ? undefined
    : "Use lowercase letters, numbers, dots, or hyphens.";
}

function validateNodeId(value: string | undefined): string | undefined {
  return FIGMA_NODE_ID.test(value ?? "") ? undefined : "Enter a Figma node ID such as 153:5181.";
}

export async function runCreateContract(
  options: CreateContractOptions,
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

  prompts.intro("Create Framelia visual contract");

  const targetUrl = await resolveField("--target-url", options.targetUrl, validateHttpUrl, () =>
    text(prompts, {
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
      text(prompts, {
        message: "Contract ID",
        placeholder: "home.desktop",
        initialValue: "home.desktop",
        validate: validateContractId,
      }),
  );
  if (!contractId) return;

  const name = await resolveField("--name", options.name, required, () =>
    text(prompts, {
      message: "Display name (just this contract -- the feature is already grouped)",
      placeholder: "Desktop",
      validate: required,
    }),
  );
  if (!name) return;

  const fileKey = await resolveField("--file-key", options.fileKey, required, () =>
    text(prompts, { message: "Figma file key", validate: required }),
  );
  if (!fileKey) return;

  const nodeId = await resolveField("--node-id", options.nodeId, validateNodeId, () =>
    text(prompts, {
      message: "Figma node ID",
      placeholder: "153:5181",
      validate: validateNodeId,
    }),
  );
  if (!nodeId) return;
  const baseline: BaselineAnswers = { kind: "figma", fileKey, nodeId };

  const viewportPreset =
    options.viewport ??
    (await select<"desktop" | "mobile" | "custom">(prompts, {
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
      () => text(prompts, { message: "Viewport name", placeholder: "tablet", validate: required }),
    );
    if (!viewportPresetName) return;
    const width = options.viewportWidth ?? (await positiveIntegerText(prompts, "Viewport width"));
    if (width === undefined) return;
    const height =
      options.viewportHeight ?? (await positiveIntegerText(prompts, "Viewport height"));
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
    (await select<"page" | "region">(prompts, {
      message: "Capture scope",
      options: [
        { value: "page", label: "Full page" },
        { value: "region", label: "Element or region" },
      ],
    }));
  if (!scopeKind) return;

  if (
    scopeKind !== "page" &&
    (options.styleCheckSelector !== undefined || options.styleCheckNodeId !== undefined)
  ) {
    throw new Error("--style-check-selector and --style-check-node-id require --scope page.");
  }

  let scope: ContractAnswers["scope"];
  if (scopeKind === "page") {
    const pageReason = await resolveField("--page-reason", options.pageReason, required, () =>
      text(prompts, {
        message: "Why does baseline represent complete page?",
        placeholder: "Baseline node represents complete page.",
        initialValue: "Baseline node represents complete page.",
        validate: required,
      }),
    );
    if (!pageReason) return;

    const flagStyleCheck = await buildFlagStyleCheck(prompts, fileKey, options);
    const styleChecks = flagStyleCheck ? [flagStyleCheck] : [];
    // Skip the interactive loop only when nothing at all has been prompted for yet --
    // a fully flag-driven invocation. The moment any field along the way came from a
    // real prompt, this session is interactive and the loop stays on offer, even if
    // --page-reason itself happened to be a flag (add more via hand-editing otherwise).
    if (promptedAnyField) {
      const collected = await collectPageStyleChecks(prompts, fileKey);
      if (collected === undefined) return;
      styleChecks.push(...collected);
    }

    scope = {
      kind: "page",
      pageReason,
      ...(styleChecks.length > 0 ? { styleChecks } : {}),
    };
  } else {
    const selector = await resolveField("--selector", options.selector, required, () =>
      text(prompts, {
        message: "CSS selector",
        placeholder: "[data-testid=card]",
        validate: required,
      }),
    );
    if (!selector) return;
    const width =
      options.regionWidth ?? (await positiveIntegerText(prompts, "Expected region width"));
    if (width === undefined) return;
    const height =
      options.regionHeight ?? (await positiveIntegerText(prompts, "Expected region height"));
    if (height === undefined) return;
    const expectStyle = await tryFetchExpectStyle(prompts, baseline.fileKey, baseline.nodeId);
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
  const outputPath = path.resolve(
    options.projectRoot,
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
