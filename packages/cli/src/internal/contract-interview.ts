import {
  CONTRACT_ID_PATTERN,
  FIGMA_NODE_ID,
  type ExpectStyle,
  type StyleCheckPoint,
} from "@framelia/contracts";
import { targetPathSchema } from "@framelia/contracts/workflow";
import { deriveExpectStyle, resolveNodeSpec } from "@framelia/verify";
import { z } from "zod";

import type { ScopeKind, ViewportPreset } from "../cli-constants.ts";
import { UsageError, usageErrorFromZodError } from "../exit.ts";
import type { CliRuntime } from "../runtime-types.ts";
import { targetUrlValidationMessage, viewportPairMessage } from "./browser-input.ts";
import { optionalFigmaToken } from "./figma-token.ts";
import {
  PROMPT_CANCELLED,
  type PromptAdapter,
  type SelectPromptOptions,
  type TextPromptOptions,
} from "./prompts.ts";

export interface ContractCreateOptions {
  readonly projectRoot: string | undefined;
  readonly output: string | undefined;
  readonly force: boolean | undefined;
  readonly targetPath?: string;
  readonly targetUrl?: string;
  readonly contractId: string | undefined;
  readonly name: string | undefined;
  readonly figmaUrl?: string;
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

export interface ContractAnswers {
  targetPath: string;
  contractId: string;
  name: string;
  baseline: { kind: "figma"; fileKey: string; nodeId: string };
  viewport: { preset: string; width: number; height: number };
  scope:
    | { kind: "page"; pageReason: string; styleChecks?: StyleCheckPoint[] }
    | {
        kind: "region";
        selector: string;
        expectSize: { width: number; height: number };
        expectStyle?: ExpectStyle;
      };
}

export interface ContractInterviewDependencies {
  readonly resolveNodeSpec: typeof resolveNodeSpec;
  readonly deriveExpectStyle: typeof deriveExpectStyle;
}

export type ContractInterviewResult =
  | { readonly kind: "completed"; readonly answers: ContractAnswers }
  | { readonly kind: "cancelled" };

const defaultDependencies: ContractInterviewDependencies = { resolveNodeSpec, deriveExpectStyle };

export interface ParsedFigmaDesignUrl {
  fileKey: string;
  nodeId: string;
}

export function parseFigmaDesignUrl(value: string): ParsedFigmaDesignUrl {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new UsageError(
      "--figma-url must be an https://www.figma.com/design/<fileKey>/<slug>?node-id=6006-1028 URL.",
    );
  }
  const segments = url.pathname.split("/").filter(Boolean);
  const fileKey = segments[0] === "design" ? segments[1] : undefined;
  const nodeParameter = url.searchParams.get("node-id");
  const normalizedNodeId =
    nodeParameter && /^\d+-\d+$/.test(nodeParameter)
      ? nodeParameter.replace("-", ":")
      : nodeParameter;
  if (
    url.protocol !== "https:" ||
    url.hostname !== "www.figma.com" ||
    segments.length < 3 ||
    !fileKey ||
    !normalizedNodeId ||
    !FIGMA_NODE_ID.test(normalizedNodeId)
  ) {
    throw new UsageError(
      "--figma-url must be an https://www.figma.com/design/<fileKey>/<slug>?node-id=6006-1028 URL with node-id.",
    );
  }
  return { fileKey, nodeId: normalizedNodeId };
}

const contractCreateFlagsSchema = z
  .object({
    targetPath: z.string().optional(),
    targetUrl: z.string().optional(),
    figmaUrl: z.string().optional(),
    contractId: z.string().optional(),
    fileKey: z.string().optional(),
    nodeId: z.string().optional(),
    viewportWidth: z.number().int().positive().optional(),
    viewportHeight: z.number().int().positive().optional(),
    regionWidth: z.number().int().positive().optional(),
    regionHeight: z.number().int().positive().optional(),
    styleCheckSelector: z
      .string()
      .trim()
      .min(1, "--style-check-selector: Enter a CSS selector.")
      .optional(),
    styleCheckNodeId: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.targetPath !== undefined) {
      const result = targetPathSchema.safeParse(data.targetPath);
      if (!result.success) {
        ctx.addIssue({
          code: "custom",
          message: "--target-path must begin with one slash and stay application-relative.",
        });
      }
    }
    if (data.targetUrl !== undefined) {
      const message = targetUrlValidationMessage(data.targetUrl);
      if (message) ctx.addIssue({ code: "custom", message: `--target-url: ${message}` });
    }
    if (data.figmaUrl !== undefined) {
      try {
        const parsed = parseFigmaDesignUrl(data.figmaUrl);
        if (data.fileKey !== undefined && data.fileKey !== parsed.fileKey) {
          ctx.addIssue({
            code: "custom",
            message: "--figma-url fileKey conflicts with --file-key.",
          });
        }
        if (data.nodeId !== undefined && data.nodeId !== parsed.nodeId) {
          ctx.addIssue({
            code: "custom",
            message: "--figma-url node-id conflicts with --node-id.",
          });
        }
      } catch (error) {
        ctx.addIssue({
          code: "custom",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const pairMessage = viewportPairMessage(data.viewportWidth, data.viewportHeight);
    if (pairMessage) ctx.addIssue({ code: "custom", message: pairMessage });
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

class InterviewCancelled extends Error {}

interface InterviewState {
  prompted: boolean;
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

function requireFlag<T>(flagName: string, value: T, validate: (value: T) => string | undefined): T {
  const message = validate(value);
  if (message) throw new UsageError(`${flagName}: ${message}`);
  return value;
}

async function promptText(
  prompts: PromptAdapter,
  state: InterviewState,
  options: TextPromptOptions,
): Promise<string> {
  state.prompted = true;
  const value = await prompts.text(options);
  if (value === PROMPT_CANCELLED) throw new InterviewCancelled();
  return value;
}

async function promptSelect<T extends string>(
  prompts: PromptAdapter,
  state: InterviewState,
  options: SelectPromptOptions<T>,
): Promise<T> {
  state.prompted = true;
  const value = await prompts.select(options);
  if (value === PROMPT_CANCELLED) throw new InterviewCancelled();
  return value;
}

async function resolveField(
  prompts: PromptAdapter,
  state: InterviewState,
  flagName: string,
  flagValue: string | undefined,
  validate: (value: string | undefined) => string | undefined,
  promptOptions: TextPromptOptions,
): Promise<string> {
  return flagValue !== undefined
    ? requireFlag(flagName, flagValue, validate)
    : promptText(prompts, state, promptOptions);
}

async function positiveIntegerText(
  prompts: PromptAdapter,
  state: InterviewState,
  message: string,
): Promise<number> {
  return Number(
    await promptText(prompts, state, {
      message,
      validate: validatePositiveInteger,
    }),
  );
}

async function tryFetchExpectStyle(
  prompts: PromptAdapter,
  token: string | undefined,
  deps: ContractInterviewDependencies,
  fileKey: string,
  nodeId: string,
  purpose = "expected component style",
): Promise<ExpectStyle | undefined> {
  if (token === undefined) {
    prompts.warn("Skipping expected-style bake-in: FIGMA_ACCESS_TOKEN is not set.");
    return undefined;
  }
  const resolved = await deps.resolveNodeSpec({
    fileKey,
    nodeId,
    token,
    gateName: "contract create",
    purpose,
  });
  if (!resolved.ok) {
    prompts.warn(`Skipping expected-style bake-in: ${resolved.warning}`);
    return undefined;
  }
  return deps.deriveExpectStyle(resolved.meta);
}

async function buildFlagStyleCheck(
  prompts: PromptAdapter,
  token: string | undefined,
  deps: ContractInterviewDependencies,
  fileKey: string,
  options: Pick<ContractCreateOptions, "styleCheckSelector" | "styleCheckNodeId">,
): Promise<StyleCheckPoint | undefined> {
  const { styleCheckSelector, styleCheckNodeId } = options;
  if (styleCheckSelector === undefined || styleCheckNodeId === undefined) return undefined;
  const expectStyle = await tryFetchExpectStyle(
    prompts,
    token,
    deps,
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

async function collectPageStyleChecks(
  prompts: PromptAdapter,
  state: InterviewState,
  token: string | undefined,
  deps: ContractInterviewDependencies,
  fileKey: string,
): Promise<StyleCheckPoint[]> {
  const checkPoints: StyleCheckPoint[] = [];
  for (;;) {
    // eslint-disable-next-line no-await-in-loop -- one prompt at a time: this IS the interview's turn-taking
    const action = await promptSelect(prompts, state, {
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
    if (action === "done") return checkPoints;

    // eslint-disable-next-line no-await-in-loop -- the user answers this only after choosing "add" above
    const selector = await promptText(prompts, state, {
      message: "CSS selector for this style check-point",
      placeholder: "[data-testid=hero-heading]",
      validate: required,
    });
    // eslint-disable-next-line no-await-in-loop -- asked after the selector, never concurrently with it
    const nodeId = await promptText(prompts, state, {
      message: "Figma node ID for this style check-point",
      placeholder: "153:5181",
      validate: validateNodeId,
    });
    // eslint-disable-next-line no-await-in-loop -- needs the nodeId the user just typed
    const expectStyle = await tryFetchExpectStyle(
      prompts,
      token,
      deps,
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
}

function assertViewportFlagsApply(options: ContractCreateOptions, preset: ViewportPreset): void {
  if (preset === "custom") return;
  if (
    options.viewportName !== undefined ||
    options.viewportWidth !== undefined ||
    options.viewportHeight !== undefined
  ) {
    throw new UsageError(
      "--viewport-name, --viewport-width, and --viewport-height require --viewport custom.",
    );
  }
}

async function resolveViewport(
  options: ContractCreateOptions,
  prompts: PromptAdapter,
  state: InterviewState,
): Promise<ContractAnswers["viewport"]> {
  const preset =
    options.viewport ??
    (await promptSelect<ViewportPreset>(prompts, state, {
      message: "Viewport",
      options: [
        { value: "desktop", label: "Desktop", hint: "1440 × 1024" },
        { value: "mobile", label: "Mobile", hint: "390 × 844" },
        { value: "custom", label: "Custom" },
      ],
    }));
  assertViewportFlagsApply(options, preset);

  if (preset === "desktop") return { preset: "desktop", width: 1440, height: 1024 };
  if (preset === "mobile") return { preset: "mobile", width: 390, height: 844 };

  const customName = await resolveField(
    prompts,
    state,
    "--viewport-name",
    options.viewportName,
    required,
    { message: "Viewport name", placeholder: "tablet", validate: required },
  );
  const width =
    options.viewportWidth ?? (await positiveIntegerText(prompts, state, "Viewport width"));
  const height =
    options.viewportHeight ?? (await positiveIntegerText(prompts, state, "Viewport height"));
  return { preset: customName, width, height };
}

function assertScopeFlagsApply(options: ContractCreateOptions, scope: ScopeKind): void {
  if (scope === "page") {
    if (
      options.selector !== undefined ||
      options.regionWidth !== undefined ||
      options.regionHeight !== undefined
    ) {
      throw new UsageError(
        "--selector, --region-width, and --region-height require --scope region.",
      );
    }
    return;
  }
  if (
    options.pageReason !== undefined ||
    options.styleCheckSelector !== undefined ||
    options.styleCheckNodeId !== undefined
  ) {
    throw new UsageError(
      "--page-reason, --style-check-selector, and --style-check-node-id require --scope page.",
    );
  }
}

async function resolveScope(
  options: ContractCreateOptions,
  prompts: PromptAdapter,
  state: InterviewState,
  token: string | undefined,
  deps: ContractInterviewDependencies,
  baseline: ContractAnswers["baseline"],
): Promise<ContractAnswers["scope"]> {
  const kind =
    options.scope ??
    (await promptSelect<ScopeKind>(prompts, state, {
      message: "Capture scope",
      options: [
        { value: "page", label: "Full page" },
        { value: "region", label: "Element or region" },
      ],
    }));
  assertScopeFlagsApply(options, kind);

  if (kind === "page") {
    const pageReason = await resolveField(
      prompts,
      state,
      "--page-reason",
      options.pageReason,
      required,
      {
        message: "Why does baseline represent complete page?",
        placeholder: "Baseline node represents complete page.",
        initialValue: "Baseline node represents complete page.",
        validate: required,
      },
    );
    const flagStyleCheck = await buildFlagStyleCheck(
      prompts,
      token,
      deps,
      baseline.fileKey,
      options,
    );
    const styleChecks = flagStyleCheck ? [flagStyleCheck] : [];
    if (prompts.interactive && state.prompted) {
      styleChecks.push(
        ...(await collectPageStyleChecks(prompts, state, token, deps, baseline.fileKey)),
      );
    }
    return {
      kind: "page",
      pageReason,
      ...(styleChecks.length > 0 ? { styleChecks } : {}),
    };
  }

  const selector = await resolveField(prompts, state, "--selector", options.selector, required, {
    message: "CSS selector",
    placeholder: "[data-testid=card]",
    validate: required,
  });
  const width =
    options.regionWidth ?? (await positiveIntegerText(prompts, state, "Expected region width"));
  const height =
    options.regionHeight ?? (await positiveIntegerText(prompts, state, "Expected region height"));
  const expectStyle = await tryFetchExpectStyle(
    prompts,
    token,
    deps,
    baseline.fileKey,
    baseline.nodeId,
  );
  return {
    kind: "region",
    selector,
    expectSize: { width, height },
    ...(expectStyle ? { expectStyle } : {}),
  };
}

function applicationPathFromUrl(value: string): string {
  const url = new URL(value);
  return `${url.pathname}${url.search}`;
}

function assertNonInteractiveInputs(
  options: ContractCreateOptions,
  figma: Partial<ParsedFigmaDesignUrl>,
): void {
  const missing: string[] = [];
  if (options.targetPath === undefined && options.targetUrl === undefined) {
    missing.push("--target-path");
  }
  if (options.contractId === undefined) missing.push("--contract-id");
  if (options.name === undefined) missing.push("--name");
  if (figma.fileKey === undefined) missing.push("--file-key or --figma-url");
  if (figma.nodeId === undefined) missing.push("--node-id or --figma-url");
  if (options.viewport === undefined) missing.push("--viewport");
  if (options.viewport === "custom") {
    if (options.viewportName === undefined) missing.push("--viewport-name");
    if (options.viewportWidth === undefined) missing.push("--viewport-width");
    if (options.viewportHeight === undefined) missing.push("--viewport-height");
  }
  if (options.scope === undefined) missing.push("--scope");
  if (options.scope === "page" && options.pageReason === undefined) missing.push("--page-reason");
  if (options.scope === "region") {
    if (options.selector === undefined) missing.push("--selector");
    if (options.regionWidth === undefined) missing.push("--region-width");
    if (options.regionHeight === undefined) missing.push("--region-height");
  }
  if (missing.length > 0) {
    throw new UsageError(
      `MISSING_INPUT: Noninteractive contract create requires ${missing.join(", ")}.`,
    );
  }
}

async function resolveTargetPath(
  options: ContractCreateOptions,
  prompts: PromptAdapter,
  state: InterviewState,
): Promise<string> {
  const fromUrl =
    options.targetUrl === undefined ? undefined : applicationPathFromUrl(options.targetUrl);
  if (options.targetPath !== undefined && fromUrl !== undefined && options.targetPath !== fromUrl) {
    throw new UsageError(
      `--target-path ${JSON.stringify(options.targetPath)} conflicts with the path from --target-url (${JSON.stringify(fromUrl)}).`,
    );
  }
  return resolveField(
    prompts,
    state,
    "--target-path",
    options.targetPath ?? fromUrl,
    (value) => {
      const result = targetPathSchema.safeParse(value);
      return result.success
        ? undefined
        : "Enter an application-relative path beginning with one slash.";
    },
    {
      message: "Target application path",
      placeholder: "/login",
      initialValue: "/",
      validate: (value) => {
        const result = targetPathSchema.safeParse(value);
        return result.success
          ? undefined
          : "Enter an application-relative path beginning with one slash.";
      },
    },
  );
}

async function runInterview(
  options: ContractCreateOptions,
  prompts: PromptAdapter,
  runtime: CliRuntime,
  deps: ContractInterviewDependencies,
): Promise<ContractAnswers> {
  const parsedFlags = contractCreateFlagsSchema.safeParse(options);
  if (!parsedFlags.success) throw usageErrorFromZodError(parsedFlags.error);

  const fromUrl: Partial<ParsedFigmaDesignUrl> = options.figmaUrl
    ? parseFigmaDesignUrl(options.figmaUrl)
    : {};
  const figma = {
    fileKey: options.fileKey ?? fromUrl.fileKey,
    nodeId: options.nodeId ?? fromUrl.nodeId,
  };
  if (!prompts.interactive) assertNonInteractiveInputs(options, figma);

  const state: InterviewState = { prompted: false };
  const targetPath = await resolveTargetPath(options, prompts, state);
  const contractId = await resolveField(
    prompts,
    state,
    "--contract-id",
    options.contractId,
    validateContractId,
    {
      message: "Contract ID",
      placeholder: "home.desktop",
      initialValue: "home.desktop",
      validate: validateContractId,
    },
  );
  const name = await resolveField(prompts, state, "--name", options.name, required, {
    message: "Display name for this contract (e.g. Desktop, Mobile)",
    placeholder: "Desktop",
    validate: required,
  });
  const fileKey = await resolveField(prompts, state, "--file-key", figma.fileKey, required, {
    message: "Figma file key",
    validate: required,
  });
  const nodeId = await resolveField(prompts, state, "--node-id", figma.nodeId, validateNodeId, {
    message: "Figma node ID",
    placeholder: "153:5181",
    validate: validateNodeId,
  });
  const baseline = { kind: "figma" as const, fileKey, nodeId };
  const viewport = await resolveViewport(options, prompts, state);
  const scope = await resolveScope(
    options,
    prompts,
    state,
    optionalFigmaToken(runtime),
    deps,
    baseline,
  );
  return { targetPath, contractId, name, baseline, viewport, scope };
}

export async function collectContractAnswers(
  options: ContractCreateOptions,
  prompts: PromptAdapter,
  runtime: CliRuntime,
  deps: ContractInterviewDependencies = defaultDependencies,
): Promise<ContractInterviewResult> {
  try {
    return { kind: "completed", answers: await runInterview(options, prompts, runtime, deps) };
  } catch (error) {
    if (!(error instanceof InterviewCancelled)) throw error;
    prompts.cancel("Setup cancelled.");
    return { kind: "cancelled" };
  }
}
