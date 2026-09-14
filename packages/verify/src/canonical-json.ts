import { sha256Hex } from "./hash.ts";

export type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalJsonValue[]
  | { readonly [key: string]: CanonicalJsonValue };

export function canonicalJson(value: CanonicalJsonValue): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError("Canonical JSON cannot encode non-finite numbers.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }

  const object = value as { readonly [key: string]: CanonicalJsonValue };
  const entries = Object.keys(object)
    .toSorted()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key]!)}`);
  return `{${entries.join(",")}}`;
}

export function canonicalJsonDigest(value: CanonicalJsonValue): `sha256:${string}` {
  return `sha256:${sha256Hex(canonicalJson(value))}`;
}
