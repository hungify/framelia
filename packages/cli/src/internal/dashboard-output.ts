import pc from "picocolors";

import type { NetworkUrl } from "../dashboard/urls.ts";
import type { CliRuntime } from "../runtime-types.ts";

const MAX_NETWORK_INTERFACE_NAME_LENGTH = 20;

export interface ReadyInfo {
  readonly elapsedMs: number;
  readonly localUrls: readonly string[];
  readonly networkUrls: readonly NetworkUrl[];
  readonly hostExplicit: boolean;
}

export interface ShortcutDescription {
  readonly key: string;
  readonly description: string;
}

export interface DashboardOutput {
  ready(info: ReadyInfo): void;
  localUrl(url: string): void;
  shortcutHint(): void;
  shortcuts(list: readonly ShortcutDescription[]): void;
  restarting(): void;
  clear(): void;
}

function colorUrl(url: string): string {
  return pc.cyan(url.replace(/:(\d+)\//, (_match, port: string) => `:${pc.bold(port)}/`));
}

function formatLocalUrl(url: string): string {
  return `  ${pc.green("➜")}  ${pc.bold("Local:")}   ${colorUrl(url)}\n`;
}

export function createDashboardOutput(
  runtime: Pick<CliRuntime, "stdout" | "stderr">,
): DashboardOutput {
  const write = (text: string): void => runtime.stderr.write(text);
  return {
    ready({ elapsedMs, localUrls, networkUrls, hostExplicit }) {
      write(`\n  ${pc.bold(pc.green("FRAMELIA"))} ${pc.dim(`ready in ${elapsedMs}ms`)}\n\n`);
      for (const url of localUrls) write(formatLocalUrl(url));
      const networkUrlMaxLength = Math.max(0, ...networkUrls.map(({ url }) => url.length));
      for (const { url, interfaceName } of networkUrls) {
        const label =
          interfaceName === undefined
            ? ""
            : interfaceName.length > MAX_NETWORK_INTERFACE_NAME_LENGTH
              ? `${interfaceName.slice(0, MAX_NETWORK_INTERFACE_NAME_LENGTH - 1)}…`
              : interfaceName;
        const suffix = label
          ? `${" ".repeat(networkUrlMaxLength - url.length + 2)}${pc.dim(label)}`
          : "";
        write(`  ${pc.green("➜")}  ${pc.bold("Network:")} ${colorUrl(url)}${suffix}\n`);
      }
      if (networkUrls.length === 0 && !hostExplicit)
        write(
          `${pc.dim(`  ${pc.green("➜")}  ${pc.bold("Network:")} use `)}${pc.bold("--host")}${pc.dim(" to expose")}\n`,
        );
    },
    localUrl(url) {
      write(formatLocalUrl(url));
    },
    shortcutHint() {
      write(
        `${pc.dim(pc.green("  ➜"))}${pc.dim("  press ")}${pc.bold("h + enter")}${pc.dim(" to show help")}\n`,
      );
    },
    shortcuts(list) {
      write(`\n  ${pc.bold("Shortcuts")}\n`);
      for (const { key, description } of list)
        write(`${pc.dim("  press ")}${pc.bold(`${key} + enter`)}${pc.dim(` to ${description}`)}\n`);
    },
    restarting() {
      write(`\n${pc.dim("  restarting server...")}\n`);
    },
    clear() {
      // Same stream the dashboard renders to: clearing stdout would reset a
      // redirected file instead of the terminal showing the banner.
      write("\x1Bc");
    },
  };
}
