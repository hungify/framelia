import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { PNG } from "pngjs";
import { afterAll, describe, expect, it } from "vitest";

import { fetchBaseline } from "../src/index.ts";
import { makeSolidPng } from "../src/internal.ts";

function figmaFetchImpl(png: Buffer, document: unknown): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/v1/files/")) {
      return new Response(
        JSON.stringify({
          lastModified: "2026-08-01T00:00:00Z",
          nodes: { "1:2": { document } },
        }),
        { status: 200 },
      );
    }
    if (url.includes("/v1/images/")) {
      return new Response(
        JSON.stringify({ images: { "1:2": "https://cdn.example/baseline.png" } }),
        {
          status: 200,
        },
      );
    }
    return new Response(Uint8Array.from(png).buffer, {
      status: 200,
      headers: { "content-type": "image/png" },
    });
  }) as typeof fetch;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-fetch-baseline-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("fetchBaseline requests", () => {
  it("encodes file keys and bounds every outbound request with a timeout signal", async () => {
    const calls: Array<{ url: string; signal?: AbortSignal | null }> = [];
    const png = PNG.sync.write(makeSolidPng(2, 2, [255, 255, 255, 255]));
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, signal: init?.signal });
      if (url.includes("/v1/files/")) {
        return new Response(
          JSON.stringify({
            lastModified: "2026-08-01T00:00:00Z",
            nodes: { "1:2": { document: { type: "FRAME" } } },
          }),
          { status: 200 },
        );
      }
      if (url.includes("/v1/images/")) {
        return new Response(
          JSON.stringify({ images: { "1:2": "https://cdn.example/baseline.png" } }),
          {
            status: 200,
          },
        );
      }
      return new Response(Uint8Array.from(png).buffer, {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    }) as typeof fetch;

    const result = await fetchBaseline({
      fileKey: "file/with?reserved",
      nodeId: "1:2",
      outPath: path.join(tmp, "figma-baseline.png"),
      token: "token",
      fetchImpl,
    });

    expect(result).toMatchObject({ ok: true, fetched: true });
    expect(calls[0]?.url).toContain("/v1/files/file%2Fwith%3Freserved/nodes");
    expect(calls[1]?.url).toContain("/v1/images/file%2Fwith%3Freserved");
    expect(calls).toHaveLength(3);
    expect(calls.every((call) => call.signal instanceof AbortSignal)).toBe(true);
  });
});

describe("fetchBaseline figmaStyle", () => {
  it("extracts a normalized style snapshot from the fetched node document", async () => {
    const png = PNG.sync.write(makeSolidPng(2, 2, [255, 255, 255, 255]));
    const fetchImpl = figmaFetchImpl(png, {
      type: "FRAME",
      cornerRadius: 8,
      fills: [{ type: "SOLID", visible: true, color: { r: 0, g: 0, b: 0 }, opacity: 1 }],
    });

    const result = await fetchBaseline({
      fileKey: "file",
      nodeId: "1:2",
      outPath: path.join(tmp, "figma-baseline-style.png"),
      token: "token",
      fetchImpl,
    });

    expect(result).toMatchObject({
      ok: true,
      fetched: true,
      figmaStyle: { cornerRadius: 8, backgroundColor: "#000000ff" },
    });
  });

  it("falls back to an empty style snapshot when the node response has no document", async () => {
    const png = PNG.sync.write(makeSolidPng(2, 2, [255, 255, 255, 255]));
    const fetchImpl = figmaFetchImpl(png, undefined);

    const result = await fetchBaseline({
      fileKey: "file",
      nodeId: "1:2",
      outPath: path.join(tmp, "figma-baseline-no-doc.png"),
      token: "token",
      fetchImpl,
    });

    expect(result).toMatchObject({ ok: true, fetched: true, figmaStyle: {} });
  });
});
