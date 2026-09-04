/**
 * Dashboard-specific host capabilities: DNS/network-interface lookup, browser opening,
 * readline/TTY, clock, and shutdown signals. Not part of Stricli's process contract, so
 * it is a separate seam from `CliRuntime`. `internal/dashboard-runtime.ts` supplies the
 * production adapter; dashboard tests supply a deterministic fake. Deliberately does not
 * import `@stricli/core`.
 */
export interface DashboardHost {
  readonly startServer: (options: {
    source: unknown;
    hostname: string;
    port: number;
  }) => Promise<{ url: string; close: () => Promise<void> }>;
  readonly lookupLocalhost: () => Promise<string | undefined>;
  readonly networkInterfaces: () => NodeJS.Dict<
    readonly { address?: string; family: string | number }[]
  >;
  readonly openBrowser: (url: string) => Promise<unknown>;
  readonly isTTY: () => boolean;
  readonly stdin: NodeJS.ReadableStream;
  readonly createReadline: () => {
    on(event: string, listener: (line: string) => void): unknown;
    close(): void;
  };
  readonly now: () => number;
  readonly waitForShutdown: () => Promise<void>;
}
