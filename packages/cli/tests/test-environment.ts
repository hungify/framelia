import { EventEmitter } from "node:events";

import {
  defaultAdapters,
  type BrowserAdapter,
  type CommandEnvironment,
  type FigmaAdapter,
} from "../src/environment.ts";
import type { DashboardHost } from "../src/internal/dashboard-runtime.ts";
import {
  productionPlaywrightDependencies,
  type PlaywrightTransportDependencies,
} from "../src/internal/playwright-transport.ts";
import { nonInteractivePrompts, type PromptAdapter } from "../src/internal/prompts.ts";
import type { CliRuntime } from "../src/runtime-types.ts";

/** Fakes for the adapters a test cares about; Figma and browser fakes merge over the real ones. */
export interface TestAdapters {
  readonly figma?: Partial<FigmaAdapter>;
  readonly browser?: Partial<BrowserAdapter>;
  readonly playwright?: Partial<PlaywrightTransportDependencies>;
  readonly dashboard?: DashboardHost;
  readonly prompts?: PromptAdapter;
}

/**
 * The command environment a test passes as an internal command's second argument. Prompts
 * default to non-interactive and signals to a private emitter, so no test touches the real
 * terminal or process listeners by accident. `exit` throws rather than ending the test run.
 */
export function testEnvironment(
  runtime: CliRuntime,
  adapters: TestAdapters = {},
  overrides: Partial<
    Pick<CommandEnvironment, "now" | "signals" | "version" | "platform" | "exit">
  > = {},
): CommandEnvironment {
  return {
    process: runtime,
    version: overrides.version ?? "0.0.0-test",
    now: overrides.now ?? (() => new Date()),
    signals: overrides.signals ?? (new EventEmitter() as unknown as CommandEnvironment["signals"]),
    platform: overrides.platform ?? process.platform,
    exit:
      overrides.exit ??
      ((code) => {
        throw new Error(`Unexpected process exit ${code} in a test.`);
      }),
    adapters: {
      figma: async () => ({ ...(await defaultAdapters.figma()), ...adapters.figma }),
      browser: async () => ({ ...(await defaultAdapters.browser()), ...adapters.browser }),
      playwright: async () => ({ ...productionPlaywrightDependencies, ...adapters.playwright }),
      dashboard: async () => adapters.dashboard ?? (await defaultAdapters.dashboard()),
      prompts: async () => adapters.prompts ?? nonInteractivePrompts,
    },
  };
}
