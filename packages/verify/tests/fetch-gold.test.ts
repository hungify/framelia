import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { PNG } from "pngjs";
import { afterAll, describe, expect, it } from "vitest";

import { fetchGold } from "../src/index.ts";
import { makeSolidPng } from "../src/internal.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-fetch-gold-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("fetchGold requests", () => {
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
        return new Response(JSON.stringify({ images: { "1:2": "https://cdn.example/gold.png" } }), {
          status: 200,
        });
      }
      return new Response(Uint8Array.from(png).buffer, {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    }) as typeof fetch;

    const result = await fetchGold({
      fileKey: "file/with?reserved",
      nodeId: "1:2",
      outPath: path.join(tmp, "figma-gold.png"),
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
