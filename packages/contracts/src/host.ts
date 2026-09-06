/**
 * What counts as a loopback or wildcard host.
 *
 * One owner, because the answer is load-bearing in two different ways: the dashboard
 * decides whether a URL is worth printing as "Local", and the browser-input rule decides
 * whether plaintext http is safe enough to carry a real session cookie into. Those two
 * used to keep their own hostname sets, and the sets disagreed.
 *
 * Both predicates accept a bare or bracketed hostname, since WHATWG keeps IPv6 hosts
 * bracketed (`new URL("http://[::1]/").hostname === "[::1]"`).
 */

const IPV4_OCTETS = 4;
const IPV6_GROUPS = 8;
const IPV4_LOOPBACK_PREFIX = 127;
const MAX_OCTET = 255;
const HEX_RADIX = 16;
const BRACKETS = /^\[|\]$/g;

/** Null unless `host` is a dotted-quad; each octet is already range-checked. */
function ipv4Octets(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== IPV4_OCTETS) return null;
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN));
  return octets.every((octet) => !Number.isNaN(octet) && octet <= MAX_OCTET) ? octets : null;
}

/**
 * Null unless `host` is an IPv6 literal, else its 8 groups with the `::` run expanded --
 * so `::1`, `0:0:0:0:0:0:0:1` and `0000:0000:0000:0000:0000:0000:0000:0001` all compare
 * equal instead of each needing its own entry in a hand-kept set.
 */
function ipv6Groups(host: string): number[] | null {
  if (!host.includes(":")) return null;
  const halves = host.split("::");
  if (halves.length > 2) return null;
  const parsed = halves.map((half) =>
    half === ""
      ? []
      : half
          .split(":")
          .map((group) =>
            /^[0-9a-f]{1,4}$/.test(group) ? Number.parseInt(group, HEX_RADIX) : Number.NaN,
          ),
  );
  if (parsed.flat().some(Number.isNaN)) return null;
  const head = parsed[0] ?? [];
  if (halves.length === 1) return head.length === IPV6_GROUPS ? head : null;
  const tail = parsed[1] ?? [];
  const elided = IPV6_GROUPS - head.length - tail.length;
  if (elided < 1) return null;
  return [...head, ...(Array<number>(elided).fill(0) as number[]), ...tail];
}

/**
 * True for `localhost`, anything in 127.0.0.0/8, and every spelling of the IPv6 loopback.
 */
export function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.replace(BRACKETS, "").toLowerCase();
  if (host === "localhost") return true;
  const octets = ipv4Octets(host);
  if (octets) return octets[0] === IPV4_LOOPBACK_PREFIX;
  const groups = ipv6Groups(host);
  return (
    groups !== null && groups.slice(0, -1).every((group) => group === 0) && groups.at(-1) === 1
  );
}

/** True for the "bind every interface" hosts: `0.0.0.0`, `::`, and expanded equivalents. */
export function isWildcardHostname(hostname: string): boolean {
  const host = hostname.replace(BRACKETS, "").toLowerCase();
  const octets = ipv4Octets(host) ?? ipv6Groups(host);
  return octets !== null && octets.every((part) => part === 0);
}

/** Human-readable form of the loopback rule, so an error message can't drift from it. */
export const LOOPBACK_HOSTNAME_DESCRIPTION = "localhost, 127.0.0.0/8, or ::1";
