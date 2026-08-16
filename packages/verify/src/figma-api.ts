import * as crypto from "node:crypto";

import type { GetFileNodesResponse, Paint, Rectangle, TypeStyle } from "@figma/rest-api-spec";
import type { ExpectStyle } from "@framelia/contracts";

import { HTTP_REQUEST_TIMEOUT_MS, NODE_META_CACHE_TTL_MS } from "./constants.ts";

export interface NodeMetadata {
  nodeType: string;
  lastModified: string | null;
  absoluteBoundingBox: Rectangle | null;
  typeStyle: TypeStyle | null;
  fills: Paint[] | null;
}

type NodeMetaOutcome = NodeMetadata | { error: string };

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

const NODE_META_CACHE = new Map<string, CacheEntry<NodeMetaOutcome>>();

export function clearNodeMetaCache(): void {
  NODE_META_CACHE.clear();
}

export interface NodeMetadataRequestOptions {
  fetchImpl?: typeof fetch;
  cache?: boolean;
}

function tokenFingerprint(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function cacheKey(fileKey: string, nodeId: string, token: string): string {
  return `${fileKey}:${nodeId}:${tokenFingerprint(token)}`;
}

export function resolveToken(explicit?: string): string | undefined {
  return explicit ?? process.env.FIGMA_ACCESS_TOKEN;
}

export async function getNodeMetadata(
  fileKey: string,
  nodeId: string,
  token: string,
  options: NodeMetadataRequestOptions = {},
): Promise<NodeMetaOutcome> {
  const fetchImpl = options.fetchImpl ?? fetch;
  // An injected fetchImpl means a test double; caching a stub response
  // across calls would leak between test cases. Default cache to "on"
  // only for the real fetch, not when a caller supplies its own.
  const useCache = options.cache ?? options.fetchImpl == null;
  const key = cacheKey(fileKey, nodeId, token);
  const cached = NODE_META_CACHE.get(key);
  if (useCache && cached) {
    if (Date.now() - cached.fetchedAt < NODE_META_CACHE_TTL_MS) return cached.data;
    NODE_META_CACHE.delete(key);
  }
  try {
    const res = await fetchImpl(
      `https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}/nodes?ids=${encodeURIComponent(nodeId)}&depth=1`,
      {
        headers: { "X-Figma-Token": token },
        signal: AbortSignal.timeout(HTTP_REQUEST_TIMEOUT_MS),
      },
    );
    if (!res.ok) {
      return { error: `Figma metadata call returned HTTP ${res.status}.` };
    }
    const json = (await res.json()) as GetFileNodesResponse;
    const node = json.nodes?.[nodeId];
    if (!node) {
      return { error: `Figma metadata call returned no node for "${nodeId}".` };
    }
    const doc = node.document;
    const result: NodeMetaOutcome = {
      nodeType: doc.type,
      lastModified: json.lastModified ?? null,
      absoluteBoundingBox: "absoluteBoundingBox" in doc ? (doc.absoluteBoundingBox ?? null) : null,
      typeStyle: doc.type === "TEXT" ? (doc.style ?? null) : null,
      fills: "fills" in doc ? (doc.fills ?? null) : null,
    };
    if (useCache) {
      NODE_META_CACHE.set(key, { data: result, fetchedAt: Date.now() });
    }
    return result;
  } catch {
    return { error: "network error during Figma metadata call." };
  }
}

export interface ResolveNodeSpecInput {
  fileKey: string;
  nodeId: string;
  token?: string;
  fetchImpl?: typeof fetch;
  gateName: string;
  purpose: string;
}

export type ResolveNodeSpecOutcome =
  | { ok: true; meta: NodeMetadata }
  | { ok: false; warning: string };

/** Used at `framelia contract create` time (see deriveExpectStyle) — not during `framelia verify`, which never calls the Figma API. */
export async function resolveNodeSpec(
  input: ResolveNodeSpecInput,
): Promise<ResolveNodeSpecOutcome> {
  const token = resolveToken(input.token);
  if (!token) {
    return {
      ok: false,
      warning: `${input.gateName} skipped: no Figma token to fetch the ${input.purpose}.`,
    };
  }
  const meta = await getNodeMetadata(input.fileKey, input.nodeId, token, {
    fetchImpl: input.fetchImpl,
  });
  if ("error" in meta) {
    return {
      ok: false,
      warning: `${input.gateName} skipped: could not fetch the ${input.purpose} (${meta.error}).`,
    };
  }
  return { ok: true, meta };
}

/** Baked into a contract at `framelia contract create` time. */
export function deriveExpectStyle(meta: NodeMetadata): ExpectStyle | undefined {
  const style: ExpectStyle = {};

  if (meta.typeStyle) {
    if (meta.typeStyle.fontWeight != null) style.fontWeight = meta.typeStyle.fontWeight;
    if (meta.typeStyle.fontSize != null) style.fontSizePx = meta.typeStyle.fontSize;
    if (meta.typeStyle.lineHeightPx != null) style.lineHeightPx = meta.typeStyle.lineHeightPx;
    if (meta.typeStyle.letterSpacing != null) style.letterSpacingPx = meta.typeStyle.letterSpacing;
  }

  const solidFill = meta.fills?.find((fill) => fill.type === "SOLID" && fill.visible !== false);
  if (solidFill && solidFill.type === "SOLID") {
    const opacity = solidFill.opacity ?? 1;
    style.color = {
      r: Math.round(solidFill.color.r * 255),
      g: Math.round(solidFill.color.g * 255),
      b: Math.round(solidFill.color.b * 255),
      a: (solidFill.color.a ?? 1) * opacity,
    };
    style.colorProperty = meta.nodeType === "TEXT" ? "color" : "backgroundColor";
  }

  return Object.keys(style).length > 0 ? style : undefined;
}
