import { isLoopbackHostname, isWildcardHostname } from "@framelia/contracts";

export interface NetworkUrl {
  readonly url: string;
  readonly interfaceName: string | undefined;
}

export interface DashboardUrls {
  readonly local: readonly string[];
  readonly network: readonly NetworkUrl[];
  readonly browser: string;
}

export interface DashboardUrlInput {
  readonly hostname: string;
  readonly port: number;
  readonly localhostAlias?: string;
  readonly networkInterfaces: NodeJS.Dict<
    readonly { readonly address?: string; readonly family: string | number }[]
  >;
}

function httpUrl(hostname: string, port: number): string {
  const urlHostname = hostname.includes(":") ? `[${hostname}]` : hostname;
  return `http://${urlHostname}:${port}/`;
}

export function resolveDashboardUrls(input: DashboardUrlInput): DashboardUrls {
  const local: string[] = [];
  const network: NetworkUrl[] = [];
  if (!isWildcardHostname(input.hostname)) {
    const displayHost =
      input.hostname === "localhost" ? (input.localhostAlias ?? input.hostname) : input.hostname;
    const url = httpUrl(displayHost, input.port);
    if (isLoopbackHostname(input.hostname)) {
      local.push(url);
    } else {
      let interfaceName: string | undefined;
      outer: for (const [name, details] of Object.entries(input.networkInterfaces)) {
        for (const detail of details ?? []) {
          if (detail.address === input.hostname) {
            interfaceName = name;
            break outer;
          }
        }
      }
      network.push({ url, interfaceName });
    }
  } else {
    for (const [name, details] of Object.entries(input.networkInterfaces)) {
      for (const detail of details ?? []) {
        if (!detail.address || detail.family !== "IPv4") continue;
        const loopback = isLoopbackHostname(detail.address);
        const url = httpUrl(loopback ? "localhost" : detail.address, input.port);
        if (loopback) local.push(url);
        else network.push({ url, interfaceName: name });
      }
    }
  }
  return {
    local,
    network,
    browser: local[0] ?? network[0]?.url ?? httpUrl(input.hostname, input.port),
  };
}
