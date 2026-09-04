import { UsageError } from "../errors.ts";

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

/**
 * Rejects a plain-HTTP URL unless its host is loopback. Callers that open this URL
 * before persisting Playwright storage state (session cookies) must not risk sending
 * that state -- or the login page itself -- over a cleartext connection an on-path
 * attacker can observe or modify. HTTPS is always accepted; HTTP is only safe when
 * nothing leaves the local machine.
 */
export function assertSecureUrl(url: string, flagLabel: string): void {
  const parsed = new URL(url);
  if (parsed.protocol === "https:") return;
  if (LOOPBACK_HOSTNAMES.has(parsed.hostname)) return;
  throw new UsageError(
    `${flagLabel} must use https:// (http:// is only allowed for localhost/127.0.0.1/::1) when browser storage state is saved or reused.`,
  );
}
