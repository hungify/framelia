import * as path from "node:path";

import * as p from "@clack/prompts";
import {
  FIGMA_NODE_ID,
  httpUrlSchema,
  VISUAL_CONTRACT_FILE,
  visualArtifactPath,
  type ExpectStyle,
} from "@framelia/contracts";
import { deriveExpectStyle, resolveNodeSpec } from "@framelia/verify/internal";

import {
  createContractRequest,
  writeContractRequest,
  type ContractAnswers,
} from "./contract/scaffold.ts";

export { createContractRequest, writeContractRequest } from "./contract/scaffold.ts";

type BaselineAnswers = ContractAnswers["baseline"];

function cancelled(value: unknown): value is symbol {
  if (!p.isCancel(value)) return false;
  p.cancel("Setup cancelled.");
  process.exitCode = 1;
  return true;
}

const CONTRACT_ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

function validateHttpUrl(value: string | undefined): string | undefined {
  if (value == null) return "Required.";
  return httpUrlSchema.safeParse(value).success ? undefined : "Enter an http:// or https:// URL.";
}

function positiveInteger(value: string | undefined): string | undefined {
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

async function text(options: Parameters<typeof p.text>[0]): Promise<string | undefined> {
  const value = await p.text(options);
  return cancelled(value) ? undefined : value;
}

async function select<T extends string>(
  options: Parameters<typeof p.select<T>>[0],
): Promise<T | undefined> {
  const value = await p.select<T>(options);
  return cancelled(value) ? undefined : value;
}

async function positiveIntegerText(
  message: string,
  placeholder?: string,
): Promise<number | undefined> {
  const value = await text({ message, placeholder, validate: positiveInteger });
  return value === undefined ? undefined : Number(value);
}

/**
 * Best-effort: bakes the Figma node's expected text style into the contract.
 * Never blocks contract creation — a missing token or network error just means
 * the contract ships without expectStyle, same as before this existed.
 */
async function tryFetchExpectStyle(baseline: BaselineAnswers): Promise<ExpectStyle | undefined> {
  const resolved = await resolveNodeSpec({
    fileKey: baseline.fileKey,
    nodeId: baseline.nodeId,
    gateName: "contract create",
    purpose: "expected component style",
  });
  if (!resolved.ok) {
    p.log.warn(`Skipping expected-style bake-in: ${resolved.warning}`);
    return undefined;
  }
  return deriveExpectStyle(resolved.meta);
}

export interface CreateContractOptions {
  projectRoot: string;
  outputPath?: string;
  force?: boolean;
  /** Non-interactive overrides: any field left undefined still prompts interactively. */
  targetUrl?: string;
  contractId?: string;
  fileKey?: string;
  nodeId?: string;
  viewport?: "desktop" | "mobile" | "custom";
  viewportName?: string;
  viewportWidth?: number;
  viewportHeight?: number;
  scope?: "page" | "region";
  pageReason?: string;
  selector?: string;
  regionWidth?: number;
  regionHeight?: number;
}

export async function runCreateContract(options: CreateContractOptions): Promise<void> {
  p.intro("Create Framelia visual contract");

  const targetUrl = options.targetUrl
    ? requireFlag("--target-url", options.targetUrl, validateHttpUrl)
    : await text({
        message: "Target application URL",
        placeholder: "http://127.0.0.1:3000",
        initialValue: "http://127.0.0.1:3000",
        validate: validateHttpUrl,
      });
  if (!targetUrl) return;

  const contractId = options.contractId
    ? requireFlag("--contract-id", options.contractId, (value) =>
        CONTRACT_ID_PATTERN.test(value ?? "")
          ? undefined
          : "Use lowercase letters, numbers, dots, or hyphens.",
      )
    : await text({
        message: "Contract ID",
        placeholder: "home.desktop",
        initialValue: "home.desktop",
        validate: (value) =>
          CONTRACT_ID_PATTERN.test(value ?? "")
            ? undefined
            : "Use lowercase letters, numbers, dots, or hyphens.",
      });
  if (!contractId) return;

  const fileKey = options.fileKey
    ? requireFlag("--file-key", options.fileKey, required)
    : await text({ message: "Figma file key", validate: required });
  if (!fileKey) return;

  const nodeId = options.nodeId
    ? requireFlag("--node-id", options.nodeId, (value) =>
        FIGMA_NODE_ID.test(value ?? "") ? undefined : "Enter a Figma node ID such as 153:5181.",
      )
    : await text({
        message: "Figma node ID",
        placeholder: "153:5181",
        validate: (value) =>
          FIGMA_NODE_ID.test(value ?? "") ? undefined : "Enter a Figma node ID such as 153:5181.",
      });
  if (!nodeId) return;
  const baseline: BaselineAnswers = { kind: "figma", fileKey, nodeId };

  const viewportPreset =
    options.viewport ??
    (await select<"desktop" | "mobile" | "custom">({
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
    const name = options.viewportName
      ? requireFlag("--viewport-name", options.viewportName, required)
      : await text({ message: "Viewport name", placeholder: "tablet", validate: required });
    if (!name) return;
    const width = options.viewportWidth ?? (await positiveIntegerText("Viewport width"));
    if (width === undefined) return;
    const height = options.viewportHeight ?? (await positiveIntegerText("Viewport height"));
    if (height === undefined) return;
    viewport = { name, width, height };
  } else {
    viewport =
      viewportPreset === "desktop"
        ? { name: "desktop", width: 1440, height: 1024 }
        : { name: "mobile", width: 390, height: 844 };
  }

  const scopeKind =
    options.scope ??
    (await select<"page" | "region">({
      message: "Capture scope",
      options: [
        { value: "page", label: "Full page" },
        { value: "region", label: "Element or region" },
      ],
    }));
  if (!scopeKind) return;

  let scope: ContractAnswers["scope"];
  if (scopeKind === "page") {
    const pageReason = options.pageReason
      ? requireFlag("--page-reason", options.pageReason, required)
      : await text({
          message: "Why does baseline represent complete page?",
          placeholder: "Baseline node represents complete page.",
          initialValue: "Baseline node represents complete page.",
          validate: required,
        });
    if (!pageReason) return;
    scope = { kind: "page", pageReason };
  } else {
    const selector = options.selector
      ? requireFlag("--selector", options.selector, required)
      : await text({
          message: "CSS selector",
          placeholder: "[data-testid=card]",
          validate: required,
        });
    if (!selector) return;
    const width = options.regionWidth ?? (await positiveIntegerText("Expected region width"));
    if (width === undefined) return;
    const height = options.regionHeight ?? (await positiveIntegerText("Expected region height"));
    if (height === undefined) return;
    const expectStyle = await tryFetchExpectStyle(baseline);
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
    baseline,
    viewport,
    scope,
  });
  const featureName = contractId.split(".")[0] ?? contractId;
  const outputPath = path.resolve(
    options.projectRoot,
    options.outputPath ?? visualArtifactPath(featureName, VISUAL_CONTRACT_FILE),
  );
  writeContractRequest(outputPath, request, options.force);
  p.outro(`Created ${outputPath}`);
}
