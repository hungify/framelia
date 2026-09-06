import { buildCommand, buildRouteMap, numberParser } from "@stricli/core";

import { identityParser, projectRootFlag } from "../cli-constants.ts";
import type { CliContext } from "../context.ts";
import type { BaselinePromoteOptions } from "../internal/baseline-promote.ts";
import { emitResult } from "../output.ts";

const promoteCommand = buildCommand({
  loader: async () => {
    const { baselinePromoteCommand } = await import("../internal/baseline-promote.ts");
    return async function (this: CliContext, flags: BaselinePromoteOptions) {
      emitResult(this, await baselinePromoteCommand(flags, this.process));
    };
  },
  parameters: {
    flags: {
      key: { kind: "parsed", parse: identityParser, brief: "baseline key, e.g. home.desktop" },
      targetUrl: {
        kind: "parsed",
        parse: identityParser,
        brief: "page URL to capture",
        placeholder: "url",
      },
      projectRoot: projectRootFlag,
      selector: {
        kind: "parsed",
        parse: identityParser,
        optional: true,
        brief: "CSS selector to scope the capture to (region instead of full page)",
        placeholder: "css",
      },
      fullPage: {
        kind: "boolean",
        optional: true,
        brief: "capture the full scrollable page",
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
      promotedBy: {
        kind: "parsed",
        parse: identityParser,
        optional: true,
        brief: "who is accepting this baseline (defaults to $USER)",
        placeholder: "who",
      },
      runId: {
        kind: "parsed",
        parse: identityParser,
        optional: true,
        brief: "CI run id/URL to record alongside this promotion",
        placeholder: "id",
      },
      note: {
        kind: "parsed",
        parse: identityParser,
        optional: true,
        brief: "why this baseline was promoted",
        placeholder: "text",
      },
      storageState: {
        kind: "parsed",
        parse: identityParser,
        optional: true,
        brief: "Playwright storage-state file for an authenticated capture",
        placeholder: "path",
      },
      headed: {
        kind: "boolean",
        optional: true,
        brief: "run the capture browser headed (defaults to headless)",
      },
    },
    aliases: {
      k: "key",
      t: "targetUrl",
      r: "projectRoot",
      c: "selector",
      f: "fullPage",
      w: "viewportWidth",
      H: "viewportHeight",
      b: "promotedBy",
      i: "runId",
      n: "note",
      s: "storageState",
      e: "headed",
    },
  },
  docs: {
    brief:
      "Capture the target URL's current state and accept it as the new toMatchPageBaseline baseline.",
  },
});

export const baselineRoutes = buildRouteMap({
  routes: { promote: promoteCommand },
  docs: { brief: "Manage promoted page-to-page baselines used by toMatchPageBaseline." },
});
