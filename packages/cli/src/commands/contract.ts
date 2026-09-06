import { buildCommand, buildRouteMap, numberParser } from "@stricli/core";

import {
  identityParser,
  projectRootFlag,
  SCOPE_KINDS,
  VIEWPORT_PRESETS,
} from "../cli-constants.ts";
import type { CliContext } from "../context.ts";
import type { ContractCreateOptions } from "../internal/contract-create.ts";
import type { SuggestMasksOptions } from "../internal/contract-suggest-masks.ts";
import { emitResult } from "../output.ts";

const createCommand = buildCommand({
  loader: async () => {
    // Stricli's loader is the intentional lazy boundary; keep prompt/browser dependencies off startup.
    const [{ contractCreateCommand }, { createClackPrompts }] = await Promise.all([
      import("../internal/contract-create.ts"),
      import("../internal/clack-prompts.ts"),
    ]);
    return async function (this: CliContext, flags: ContractCreateOptions) {
      const result = await contractCreateCommand(
        flags,
        createClackPrompts(this.process),
        this.process,
      );
      emitResult(this, result);
    };
  },
  parameters: {
    flags: {
      projectRoot: projectRootFlag,
      output: {
        kind: "parsed",
        parse: identityParser,
        optional: true,
        brief: "contract path relative to project root",
        placeholder: "path",
      },
      force: { kind: "boolean", optional: true, brief: "replace existing contract" },
      targetUrl: {
        kind: "parsed",
        parse: identityParser,
        optional: true,
        brief: "target application URL",
        placeholder: "url",
      },
      contractId: {
        kind: "parsed",
        parse: identityParser,
        optional: true,
        brief: "contract id, e.g. home.desktop",
        placeholder: "id",
      },
      name: {
        kind: "parsed",
        parse: identityParser,
        optional: true,
        brief: "display name for just this contract, e.g. Login",
        placeholder: "name",
      },
      fileKey: {
        kind: "parsed",
        parse: identityParser,
        optional: true,
        brief: "Figma file key",
        placeholder: "key",
      },
      nodeId: {
        kind: "parsed",
        parse: identityParser,
        optional: true,
        brief: "Figma node id, e.g. 153:5181",
        placeholder: "id",
      },
      viewport: {
        kind: "enum",
        values: VIEWPORT_PRESETS,
        optional: true,
        brief: "desktop, mobile, or custom",
      },
      viewportName: {
        kind: "parsed",
        parse: identityParser,
        optional: true,
        brief: "viewport name (with --viewport custom)",
        placeholder: "name",
      },
      viewportWidth: {
        kind: "parsed",
        parse: numberParser,
        optional: true,
        brief: "viewport width in px (with --viewport custom)",
        placeholder: "n",
      },
      viewportHeight: {
        kind: "parsed",
        parse: numberParser,
        optional: true,
        brief: "viewport height in px (with --viewport custom)",
        placeholder: "n",
      },
      scope: {
        kind: "enum",
        values: SCOPE_KINDS,
        optional: true,
        brief: "page or region",
      },
      pageReason: {
        kind: "parsed",
        parse: identityParser,
        optional: true,
        brief: "why the baseline represents the complete page (with --scope page)",
        placeholder: "text",
      },
      styleCheckSelector: {
        kind: "parsed",
        parse: identityParser,
        optional: true,
        brief:
          "CSS selector for one style check-point (with --scope page; pairs with --style-check-node-id)",
        placeholder: "css",
      },
      styleCheckNodeId: {
        kind: "parsed",
        parse: identityParser,
        optional: true,
        brief: "Figma node id for the style check-point (with --style-check-selector)",
        placeholder: "id",
      },
      selector: {
        kind: "parsed",
        parse: identityParser,
        optional: true,
        brief: "CSS selector for the captured region (with --scope region)",
        placeholder: "css",
      },
      regionWidth: {
        kind: "parsed",
        parse: numberParser,
        optional: true,
        brief: "expected region width in px (with --scope region)",
        placeholder: "n",
      },
      regionHeight: {
        kind: "parsed",
        parse: numberParser,
        optional: true,
        brief: "expected region height in px (with --scope region)",
        placeholder: "n",
      },
    },
    aliases: {
      r: "projectRoot",
      o: "output",
      f: "force",
      t: "targetUrl",
      c: "contractId",
      k: "fileKey",
      n: "nodeId",
      N: "name",
      v: "viewport",
      s: "scope",
    },
  },
  docs: {
    brief: "Create a schema-v5 visual contract. Prompts interactively for any flag left unset.",
  },
});

const suggestMasksCommand = buildCommand({
  loader: async () => {
    // Stricli's loader is the intentional lazy boundary; keep browser dependencies off startup.
    const { suggestMasksCommand: runSuggestMasksCommand } =
      await import("../internal/contract-suggest-masks.ts");
    return async function (this: CliContext, flags: SuggestMasksOptions) {
      emitResult(this, await runSuggestMasksCommand(flags));
    };
  },
  parameters: {
    flags: {
      targetUrl: {
        kind: "parsed",
        parse: identityParser,
        brief: "page URL to scan",
        placeholder: "url",
      },
      viewportWidth: {
        kind: "parsed",
        parse: numberParser,
        optional: true,
        brief: "viewport width in px",
        placeholder: "n",
      },
      viewportHeight: {
        kind: "parsed",
        parse: numberParser,
        optional: true,
        brief: "viewport height in px",
        placeholder: "n",
      },
      storageState: {
        kind: "parsed",
        parse: identityParser,
        optional: true,
        brief: "Playwright storage-state file for an authenticated scan",
        placeholder: "path",
      },
      headed: {
        kind: "boolean",
        optional: true,
        brief: "run the scan browser headed (defaults to headless)",
      },
    },
    aliases: {
      t: "targetUrl",
      w: "viewportWidth",
      H: "viewportHeight",
      s: "storageState",
      e: "headed",
    },
  },
  docs: {
    brief:
      "Scan a live page for common dynamic-content signals and propose mask selectors. Proposals only -- never writes to a contract.",
  },
});

export const contractRoutes = buildRouteMap({
  routes: { create: createCommand, "suggest-masks": suggestMasksCommand },
  docs: { brief: "Create and manage visual contracts." },
});
