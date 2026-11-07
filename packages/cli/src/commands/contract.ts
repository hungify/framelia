import { buildCommand, buildRouteMap, numberParser } from "@stricli/core";

import {
  identityParser,
  projectRootFlag,
  SCOPE_KINDS,
  VIEWPORT_PRESETS,
} from "../cli-constants.ts";
import type { CliContext } from "../context.ts";
import type { ContractCreateOptions } from "../internal/contract-create.ts";
import type { ContractListOptions } from "../internal/contract-list.ts";
import type { ContractRefreshBaselineOptions } from "../internal/contract-refresh-baseline.ts";
import type { SuggestMasksOptions } from "../internal/contract-suggest-masks.ts";
import { emitResult } from "../output.ts";

const createCommand = buildCommand({
  loader: async () => {
    // Stricli's loader is the intentional lazy boundary; prompts and Figma load through this.adapters.
    const { contractCreateCommand } = await import("../internal/contract-create.ts");
    return async function (this: CliContext, flags: ContractCreateOptions) {
      emitResult(this, await contractCreateCommand(flags, this));
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
      targetPath: {
        kind: "parsed",
        parse: identityParser,
        optional: true,
        brief: "application-relative target path, e.g. /login?state=error",
        placeholder: "path",
      },
      targetUrl: {
        kind: "parsed",
        parse: identityParser,
        optional: true,
        brief: "absolute URL convenience input; only its path and query are authored",
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
      figmaUrl: {
        kind: "parsed",
        parse: identityParser,
        optional: true,
        brief: "Figma design URL containing file key and node-id",
        placeholder: "url",
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
      t: "targetPath",
      c: "contractId",
      k: "fileKey",
      n: "nodeId",
      N: "name",
      v: "viewport",
    },
  },
  docs: {
    brief: "Author a pinned Figma visual contract; prompts only on an interactive TTY.",
    fullDescription: [
      "Author one pinned Figma visual contract. Interactive terminals are prompted for",
      "missing inputs; otherwise every required flag must be given. Needs",
      "FIGMA_ACCESS_TOKEN.",
      "",
      "Examples:",
      "  framelia contract create",
      "  framelia contract create --target-path /login --contract-id login.desktop \\",
      "    --figma-url <figma-design-url> --viewport desktop --scope page \\",
      '    --page-reason "The frame is the complete page."',
    ].join("\n"),
  },
});

const listCommand = buildCommand({
  loader: async () => {
    const { contractListCommand } = await import("../internal/contract-list.ts");
    return async function (this: CliContext, flags: ContractListOptions) {
      emitResult(this, await contractListCommand(flags, this));
    };
  },
  parameters: {
    flags: { projectRoot: projectRootFlag },
    aliases: { r: "projectRoot" },
  },
  docs: {
    brief: "Reconcile authored contracts with collected Playwright bindings.",
    fullDescription: [
      "Classify every authored contract/project case as configured, executable, unbound",
      "or invalid. Unbound entries carry their defineFigmaTests registration recipe.",
      "",
      "Example:",
      "  framelia contract list",
    ].join("\n"),
  },
});

const refreshBaselineCommand = buildCommand({
  loader: async () => {
    const { contractRefreshBaselineCommand } =
      await import("../internal/contract-refresh-baseline.ts");
    return async function (this: CliContext, flags: ContractRefreshBaselineOptions) {
      emitResult(this, await contractRefreshBaselineCommand(flags, this));
    };
  },
  parameters: {
    flags: {
      projectRoot: projectRootFlag,
      contract: {
        kind: "parsed",
        parse: identityParser,
        optional: true,
        brief: "exact authored contract id",
        placeholder: "id",
      },
    },
    aliases: { r: "projectRoot", c: "contract" },
  },
  docs: {
    brief: "Explicitly reacquire and atomically repin one Figma baseline.",
    fullDescription: [
      "Reacquire one contract's Figma baseline and repin it atomically; the old",
      "snapshot stays usable on any failure. Needs FIGMA_ACCESS_TOKEN.",
      "",
      "Example:",
      "  framelia contract refresh-baseline --contract login.desktop",
    ].join("\n"),
  },
});

const suggestMasksCommand = buildCommand({
  loader: async () => {
    // Stricli's loader is the intentional lazy boundary; keep browser dependencies off startup.
    const { suggestMasksCommand: runSuggestMasksCommand } =
      await import("../internal/contract-suggest-masks.ts");
    return async function (this: CliContext, flags: SuggestMasksOptions) {
      emitResult(this, await runSuggestMasksCommand(flags, this));
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
      projectRoot: projectRootFlag,
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
        brief: "storage-state file (default: the recorded storageStatePath)",
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
      r: "projectRoot",
      w: "viewportWidth",
      H: "viewportHeight",
      s: "storageState",
      e: "headed",
    },
  },
  docs: {
    brief:
      "Scan a live page for common dynamic-content signals and propose mask selectors. Proposals only -- never writes to a contract.",
    fullDescription: [
      "Scan a live page for dynamic content and propose mask selectors. Never writes a",
      "contract. --storage-state defaults to the recorded storageStatePath",
      "(https/loopback only).",
      "",
      "Example:",
      "  framelia contract suggest-masks --target-url https://localhost:3000/",
    ].join("\n"),
  },
});

export const contractRoutes = buildRouteMap({
  routes: {
    create: createCommand,
    list: listCommand,
    "refresh-baseline": refreshBaselineCommand,
    "suggest-masks": suggestMasksCommand,
  },
  docs: { brief: "Create and manage visual contracts." },
});
