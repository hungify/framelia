import { httpUrlSchema } from "@framelia/contracts";

import { UsageError } from "../exit.ts";

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

export const VIEWPORT_PAIR_MESSAGE =
  "--viewport-width and --viewport-height must be supplied together.";

/** Prompt-shaped message: `undefined` when the value is an acceptable http(s) URL. */
export function targetUrlValidationMessage(value: string | undefined): string | undefined {
  return value !== undefined && httpUrlSchema.safeParse(value).success
    ? undefined
    : "Enter an http:// or https:// URL.";
}

export function viewportPairMessage(
  width: number | undefined,
  height: number | undefined,
): string | undefined {
  return (width === undefined) === (height === undefined) ? undefined : VIEWPORT_PAIR_MESSAGE;
}

/**
 * One rule for every URL a browser will actually visit: it must be http(s), and
 * plaintext http is only tolerated on loopback when the run also carries
 * Playwright storage state (a real session cookie) into the page.
 */
export function targetUrlMessage(
  url: string,
  label: string,
  options: { carriesBrowserStorageState: boolean },
): string | undefined {
  if (targetUrlValidationMessage(url)) return `${label} must use http:// or https://.`;
  if (!options.carriesBrowserStorageState) return undefined;

  const parsed = new URL(url);
  // WHATWG URL keeps IPv6 hosts bracketed ("http://[::1]/".hostname === "[::1]").
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  if (parsed.protocol === "https:" || LOOPBACK_HOSTNAMES.has(hostname)) return undefined;
  return `${label} must use https:// (http:// is only allowed for localhost/127.0.0.1/::1) when browser storage state is saved or reused.`;
}

export function assertTargetUrl(
  url: string,
  label: string,
  options: { carriesBrowserStorageState: boolean },
): void {
  const message = targetUrlMessage(url, label, options);
  if (message) throw new UsageError(message);
}
