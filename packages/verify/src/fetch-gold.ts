import * as fs from "node:fs";
import * as path from "node:path";

import type { GetFileNodesResponse, GetImagesResponse } from "@figma/rest-api-spec";

import { GOLD_ARTIFACT } from "./artifacts.ts";
import { compositeOnCanvas, parsePng, writePng } from "./compare/png.ts";
import {
  DEFAULT_IMAGE_SCALE,
  DEFAULT_RETRY_AFTER_MS,
  HTTP_STATUS,
  HTTP_REQUEST_TIMEOUT_MS,
  JSON_INDENT_SPACES,
  MAX_RETRY_AFTER_MS,
  MIN_RETRY_AFTER_MS,
  MS_PER_SECOND,
} from "./constants.ts";
import { resolveToken } from "./figma-api.ts";

export interface FetchGoldOptions {
  fileKey: string;
  nodeId: string;
  outPath: string;
  scale?: number;
  useAbsoluteBounds?: boolean;
  canvasFill?: string;
  token?: string;
  fetchImpl?: typeof fetch;
}

export interface ApiCallLogEntry {
  endpoint: string;
  timestamp: string;
  status: number;
}

export interface GoldMeta {
  nodeId: string;
  fileKey: string;
  lastModified: string | null;
  fetchedAt: string;
  apiCallCount: number;
  apiCallLog: ApiCallLogEntry[];
}

export type FetchGoldOutcome =
  | {
      ok: true;
      fetched: true;
      goldPath: string;
      metaPath: string;
      meta: GoldMeta;
      warnings: string[];
    }
  | { ok: true; fetched: false; errorClass: "retryable"; message: string; warnings: string[] }
  | { ok: false; fetched: false; errorClass: "auth" | "config"; message: string };

export async function fetchGold(options: FetchGoldOptions): Promise<FetchGoldOutcome> {
  const token = resolveToken(options.token);
  if (!token) {
    return {
      ok: false,
      fetched: false,
      errorClass: "config",
      message: "No Figma token found (set FIGMA_ACCESS_TOKEN).",
    };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const warnings: string[] = [];
  const apiCallLog: ApiCallLogEntry[] = [];
  const scale = options.scale ?? DEFAULT_IMAGE_SCALE;
  let tempGoldPath: string | undefined;
  let tempMetaPath: string | undefined;
  let goldCommitted = false;
  let previousGold: Buffer | null = null;

  // Shared by every outbound request in this flow -- the api.figma.com JSON calls and the
  // final CDN image download alike -- so a transient 429/5xx self-heals the same way
  // everywhere instead of only on the two calls that happen to route through `call()`.
  const fetchWithRetry = async (
    url: string,
    init: RequestInit,
    logEndpoint: string,
  ): Promise<Response> => {
    const doFetch = async () => {
      const res = await fetchImpl(url, {
        ...init,
        signal: AbortSignal.timeout(HTTP_REQUEST_TIMEOUT_MS),
      });
      apiCallLog.push({
        endpoint: logEndpoint,
        timestamp: new Date().toISOString(),
        status: res.status,
      });
      return res;
    };
    let res = await doFetch();
    if (res.status === HTTP_STATUS.TOO_MANY_REQUESTS) {
      await sleep(parseRetryAfterMs(res.headers.get("retry-after")));
      res = await doFetch();
    }
    return res;
  };

  const call = (endpoint: string): Promise<Response> =>
    fetchWithRetry(
      `https://api.figma.com${endpoint}`,
      { headers: { "X-Figma-Token": token } },
      endpoint.split("?")[0] ?? endpoint,
    );

  const classify = (status: number, context: string): FetchGoldOutcome | null => {
    if (status === HTTP_STATUS.UNAUTHORIZED || status === HTTP_STATUS.FORBIDDEN) {
      return {
        ok: false,
        fetched: false,
        errorClass: "auth",
        message: `Figma API rejected the token (${status}) during ${context}. Check FIGMA_ACCESS_TOKEN scopes.`,
      };
    }
    if (status === HTTP_STATUS.NOT_FOUND) {
      return {
        ok: false,
        fetched: false,
        errorClass: "config",
        message: `nodeId not found in file (404) during ${context}; verify fileKey "${options.fileKey}" and nodeId "${options.nodeId}" (not an auth problem).`,
      };
    }
    if (status === HTTP_STATUS.TOO_MANY_REQUESTS || status >= HTTP_STATUS.INTERNAL_SERVER_ERROR) {
      return {
        ok: true,
        fetched: false,
        errorClass: "retryable",
        message: `Figma API unavailable (${status}) during ${context}; existing gold on disk remains usable.`,
        warnings,
      };
    }
    return null;
  };

  try {
    const metaRes = await call(
      `/v1/files/${encodeURIComponent(options.fileKey)}/nodes?ids=${encodeURIComponent(options.nodeId)}&depth=1`,
    );
    if (!metaRes.ok) {
      return (
        classify(metaRes.status, "metadata fetch") ?? {
          ok: true,
          fetched: false,
          errorClass: "retryable",
          message: `Unexpected Figma API status ${metaRes.status} during metadata fetch.`,
          warnings,
        }
      );
    }
    const metaJson = (await metaRes.json()) as GetFileNodesResponse;
    const nodeEntry = metaJson.nodes?.[options.nodeId];
    if (nodeEntry === null || nodeEntry === undefined) {
      return {
        ok: false,
        fetched: false,
        errorClass: "config",
        message: `nodeId not found in file; Figma returned no node for "${options.nodeId}" (not an auth problem).`,
      };
    }

    const useAbsoluteBounds = options.useAbsoluteBounds ?? true;
    const imgRes = await call(
      `/v1/images/${encodeURIComponent(options.fileKey)}?ids=${encodeURIComponent(options.nodeId)}&format=png&scale=${scale}&use_absolute_bounds=${useAbsoluteBounds}`,
    );
    if (!imgRes.ok) {
      return (
        classify(imgRes.status, "image render") ?? {
          ok: true,
          fetched: false,
          errorClass: "retryable",
          message: `Unexpected Figma API status ${imgRes.status} during image render.`,
          warnings,
        }
      );
    }
    const imgJson = (await imgRes.json()) as GetImagesResponse & { err?: string | null };
    const imageUrl = imgJson.images?.[options.nodeId];
    if (imgJson.err || !imageUrl) {
      return {
        ok: false,
        fetched: false,
        errorClass: "config",
        message: `Figma could not render nodeId "${options.nodeId}" (${imgJson.err ?? "no image URL returned"}).`,
      };
    }

    const pngRes = await fetchWithRetry(imageUrl, {}, "figma-image-cdn");
    if (!pngRes.ok) {
      return {
        ok: true,
        fetched: false,
        errorClass: "retryable",
        message: `Image download failed (${pngRes.status}); existing gold on disk remains usable.`,
        warnings,
      };
    }
    const buf = Buffer.from(await pngRes.arrayBuffer());
    const outDir = path.dirname(options.outPath);
    fs.mkdirSync(outDir, { recursive: true });
    previousGold = fs.existsSync(options.outPath) ? fs.readFileSync(options.outPath) : null;
    const tempSuffix = `.tmp-${process.pid}-${Date.now()}`;
    tempGoldPath = `${options.outPath}${tempSuffix}`;
    tempMetaPath = `${goldMetaPath(options.outPath)}${tempSuffix}`;
    fs.writeFileSync(tempGoldPath, buf);
    // Validate the download is a well-formed PNG before committing it (throws on
    // corruption); parse the buffer already in memory instead of reading it back off disk.
    const downloaded = parsePng(buf);

    if (options.canvasFill) {
      const composited = compositeOnCanvas(downloaded, options.canvasFill);
      writePng(tempGoldPath, composited);
      warnings.push(
        `composited gold onto canvasFill ${options.canvasFill} (alpha/shadow flattened).`,
      );
    }

    const meta: GoldMeta = {
      nodeId: options.nodeId,
      fileKey: options.fileKey,
      lastModified: metaJson.lastModified ?? null,
      fetchedAt: new Date().toISOString(),
      apiCallCount: apiCallLog.length,
      apiCallLog,
    };
    const metaPath = goldMetaPath(options.outPath);
    fs.writeFileSync(tempMetaPath, `${JSON.stringify(meta, null, JSON_INDENT_SPACES)}\n`);
    fs.renameSync(tempGoldPath, options.outPath);
    goldCommitted = true;
    fs.renameSync(tempMetaPath, metaPath);
    tempGoldPath = undefined;
    tempMetaPath = undefined;

    return { ok: true, fetched: true, goldPath: options.outPath, metaPath, meta, warnings };
  } catch (err) {
    if (goldCommitted) {
      if (previousGold) fs.writeFileSync(options.outPath, previousGold);
      else fs.rmSync(options.outPath, { force: true });
    }
    for (const tempPath of [tempGoldPath, tempMetaPath]) {
      if (tempPath) fs.rmSync(tempPath, { force: true });
    }
    return {
      ok: true,
      fetched: false,
      errorClass: "retryable",
      message: `Network error during fetch-gold (${sanitizeError(err)}); existing gold on disk remains usable.`,
      warnings,
    };
  }
}

export function goldMetaPath(goldPath: string): string {
  return path.join(path.dirname(goldPath), GOLD_ARTIFACT.meta);
}

export function readGoldMeta(goldPath: string): GoldMeta | null {
  const p = goldMetaPath(goldPath);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as GoldMeta;
  } catch {
    return null;
  }
}

function sanitizeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replaceAll(/x-figma-token[^\s,;]*/gi, "[redacted]").slice(0, 300);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(headerValue: string | null): number {
  if (!headerValue) return DEFAULT_RETRY_AFTER_MS;
  const asSeconds = Number(headerValue);
  if (Number.isFinite(asSeconds)) {
    return Math.min(Math.max(asSeconds * MS_PER_SECOND, MIN_RETRY_AFTER_MS), MAX_RETRY_AFTER_MS);
  }
  const asDateMs = Date.parse(headerValue);
  if (Number.isFinite(asDateMs)) {
    return Math.min(Math.max(asDateMs - Date.now(), MIN_RETRY_AFTER_MS), MAX_RETRY_AFTER_MS);
  }
  return DEFAULT_RETRY_AFTER_MS;
}
