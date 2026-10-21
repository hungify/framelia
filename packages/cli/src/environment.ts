import type { deriveExpectStyle, fetchBaseline, resolveNodeSpec } from "@framelia/verify";
import type {
  captureAndPromotePageBaseline,
  recordStorageState,
  suggestMasksForUrl,
} from "@framelia/verify/cli";

import type { DashboardHost } from "./internal/dashboard-runtime.ts";
import type { PlaywrightTransportDependencies } from "./internal/playwright-transport.ts";
import type { PromptAdapter } from "./internal/prompts.ts";
import type { CliRuntime } from "./runtime-types.ts";

/** Figma REST access. */
export interface FigmaAdapter {
  readonly fetchBaseline: typeof fetchBaseline;
  readonly resolveNodeSpec: typeof resolveNodeSpec;
  readonly deriveExpectStyle: typeof deriveExpectStyle;
}

/** A real browser driven outside the consumer's Playwright suite. */
export interface BrowserAdapter {
  readonly recordStorageState: typeof recordStorageState;
  readonly captureAndPromote: typeof captureAndPromotePageBaseline;
  readonly suggestMasksForUrl: typeof suggestMasksForUrl;
}

/**
 * Every system outside this process a command can reach. Each entry is a lazy factory so
 * the default adapters import their heavy runtime only when a command first asks for them.
 */
export interface CliAdapters {
  readonly figma: () => Promise<FigmaAdapter>;
  readonly browser: () => Promise<BrowserAdapter>;
  readonly playwright: () => Promise<PlaywrightTransportDependencies>;
  readonly dashboard: () => Promise<DashboardHost>;
  readonly prompts: (runtime: CliRuntime) => Promise<PromptAdapter>;
}

/** Where termination signals (SIGINT/SIGTERM) come from; Node's `process` in production. */
export type SignalSource = Pick<NodeJS.Process, "on" | "once" | "off" | "removeListener">;

/**
 * What every internal command receives as its second argument. Stricli's `CliContext`
 * extends it, so a command loader passes its own `this` straight through.
 */
export interface CommandEnvironment {
  readonly process: CliRuntime;
  readonly version: string;
  readonly adapters: CliAdapters;
  readonly now: () => Date;
  readonly signals: SignalSource;
  /** The host platform; decides whether child processes can be signalled gracefully. */
  readonly platform: NodeJS.Platform;
  /** Ends this process immediately (a forced interrupt with nothing left to stop). */
  readonly exit: (code: number) => void;
}

/** The parts of the environment a caller of `run()` may replace. */
export type EnvironmentOverrides = Partial<
  Pick<CommandEnvironment, "now" | "signals" | "platform" | "exit">
>;

export const defaultAdapters: CliAdapters = {
  async figma() {
    const { deriveExpectStyle, fetchBaseline, resolveNodeSpec } = await import("@framelia/verify");
    return { deriveExpectStyle, fetchBaseline, resolveNodeSpec };
  },
  async browser() {
    const verify = await import("@framelia/verify/cli");
    return {
      recordStorageState: verify.recordStorageState,
      captureAndPromote: verify.captureAndPromotePageBaseline,
      suggestMasksForUrl: verify.suggestMasksForUrl,
    };
  },
  async playwright() {
    return (await import("./internal/playwright-transport.ts")).productionPlaywrightDependencies;
  },
  async dashboard() {
    return (await import("./internal/dashboard-runtime.ts")).productionDashboardHost;
  },
  async prompts(runtime) {
    return (await import("./internal/clack-prompts.ts")).createClackPrompts(runtime);
  },
};

export function buildEnvironment(options: {
  process?: CliRuntime;
  version: string;
  adapters?: Partial<CliAdapters>;
  overrides?: EnvironmentOverrides;
}): CommandEnvironment {
  return {
    process: options.process ?? process,
    version: options.version,
    adapters: { ...defaultAdapters, ...options.adapters },
    now: options.overrides?.now ?? (() => new Date()),
    signals: options.overrides?.signals ?? process,
    platform: options.overrides?.platform ?? process.platform,
    exit: options.overrides?.exit ?? ((code) => process.exit(code)),
  };
}
