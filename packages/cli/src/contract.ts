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

export async function runCreateContract(options: {
  projectRoot: string;
  outputPath?: string;
  force?: boolean;
}): Promise<void> {
  p.intro("Create Framelia visual contract");

  const targetUrl = await text({
    message: "Target application URL",
    placeholder: "http://127.0.0.1:3000",
    initialValue: "http://127.0.0.1:3000",
    validate: validateHttpUrl,
  });
  if (!targetUrl) return;

  const contractId = await text({
    message: "Contract ID",
    placeholder: "home.desktop",
    initialValue: "home.desktop",
    validate: (value) =>
      /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(value ?? "")
        ? undefined
        : "Use lowercase letters, numbers, dots, or hyphens.",
  });
  if (!contractId) return;

  const fileKey = await text({ message: "Figma file key", validate: required });
  if (!fileKey) return;
  const nodeId = await text({
    message: "Figma node ID",
    placeholder: "153:5181",
    validate: (value) =>
      FIGMA_NODE_ID.test(value ?? "") ? undefined : "Enter a Figma node ID such as 153:5181.",
  });
  if (!nodeId) return;
  const baseline: BaselineAnswers = { kind: "figma", fileKey, nodeId };

  const viewportPreset = await select<"desktop" | "mobile" | "custom">({
    message: "Viewport",
    options: [
      { value: "desktop", label: "Desktop", hint: "1440 × 1024" },
      { value: "mobile", label: "Mobile", hint: "390 × 844" },
      { value: "custom", label: "Custom" },
    ],
  });
  if (!viewportPreset) return;

  let viewport: ContractAnswers["viewport"];
  if (viewportPreset === "custom") {
    const name = await text({
      message: "Viewport name",
      placeholder: "tablet",
      validate: required,
    });
    if (!name) return;
    const width = await positiveIntegerText("Viewport width");
    if (width === undefined) return;
    const height = await positiveIntegerText("Viewport height");
    if (height === undefined) return;
    viewport = { name, width, height };
  } else {
    viewport =
      viewportPreset === "desktop"
        ? { name: "desktop", width: 1440, height: 1024 }
        : { name: "mobile", width: 390, height: 844 };
  }

  const scopeKind = await select<"page" | "region">({
    message: "Capture scope",
    options: [
      { value: "page", label: "Full page" },
      { value: "region", label: "Element or region" },
    ],
  });
  if (!scopeKind) return;

  let scope: ContractAnswers["scope"];
  if (scopeKind === "page") {
    const pageReason = await text({
      message: "Why does baseline represent complete page?",
      placeholder: "Baseline node represents complete page.",
      initialValue: "Baseline node represents complete page.",
      validate: required,
    });
    if (!pageReason) return;
    scope = { kind: "page", pageReason };
  } else {
    const selector = await text({
      message: "CSS selector",
      placeholder: "[data-testid=card]",
      validate: required,
    });
    if (!selector) return;
    const width = await positiveIntegerText("Expected region width");
    if (width === undefined) return;
    const height = await positiveIntegerText("Expected region height");
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
