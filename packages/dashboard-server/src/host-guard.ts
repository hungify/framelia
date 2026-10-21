import { isLoopbackHostname } from "@framelia/contracts";
import type { MiddlewareHandler } from "hono";

/**
 * Parses a `Host` header value or an `Origin` into a lowercased hostname (IPv6 kept
 * bracketed, as WHATWG does) and a numeric port, or `undefined` when it isn't one.
 */
function parseAuthority(
  value: string,
  withScheme: boolean,
): { host: string; port: number } | undefined {
  try {
    const url = new URL(withScheme ? value : `http://${value}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    if (!withScheme && (url.pathname !== "/" || url.search || url.username)) return undefined;
    const defaultPort = url.protocol === "https:" ? 443 : 80;
    return { host: url.hostname.toLowerCase(), port: url.port ? Number(url.port) : defaultPort };
  } catch {
    return undefined;
  }
}

function normalizeHostname(hostname: string): string {
  const lower = hostname.toLowerCase();
  return lower.includes(":") && !lower.startsWith("[") ? `[${lower}]` : lower;
}

/**
 * DNS-rebinding guard for a loopback-bound dashboard.
 *
 * A page on `attacker.example` can re-point its own DNS name at 127.0.0.1 and then read
 * this server same-origin -- screenshots, run metadata, the live event stream. The
 * browser still sends `Host: attacker.example:<port>`, so a loopback-bound server only
 * answers requests addressed to a loopback name/literal or to the hostname it was
 * explicitly bound to, on its own port. A cross-site `Origin` is refused too (any port:
 * a local dev proxy such as Vite's legitimately sits on another one).
 *
 * A non-loopback bind (`--host`, `0.0.0.0`) was an explicit choice to be reachable under
 * other names, so the guard stands aside there.
 */
export function hostGuard(options: {
  hostname: string;
  /** The bound port; read lazily because it's only known once the listener is up. */
  port: () => number | undefined;
}): MiddlewareHandler {
  const configuredHost = normalizeHostname(options.hostname);
  const enforced = isLoopbackHostname(options.hostname);
  const allowedName = (host: string) => isLoopbackHostname(host) || host === configuredHost;

  return async (context, next) => {
    if (!enforced) return next();
    const host = parseAuthority(context.req.header("host") ?? "", false);
    const port = options.port();
    if (!host || !allowedName(host.host) || (port !== undefined && host.port !== port)) {
      return context.text("Forbidden: unexpected Host header.", 403);
    }
    const originHeader = context.req.header("origin");
    if (originHeader !== undefined) {
      const origin = parseAuthority(originHeader, true);
      if (!origin || !allowedName(origin.host)) {
        return context.text("Forbidden: cross-origin request.", 403);
      }
    }
    return next();
  };
}

/** Stops browsers from MIME-sniffing an artifact or API body into something executable. */
export const noSniff: MiddlewareHandler = async (context, next) => {
  await next();
  context.header("X-Content-Type-Options", "nosniff");
};
