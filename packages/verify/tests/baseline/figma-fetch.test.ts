import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { PNG } from "pngjs";
import { afterAll, describe, expect, it } from "vitest";

import { makeSolidPng } from "../../src/compare/png.ts";
import { fetchBaseline } from "../../src/index.ts";

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
      figmaStyle: {
        cornerRadius: { topLeft: 8, topRight: 8, bottomRight: 8, bottomLeft: 8 },
        backgroundColor: "#000000ff",
      },
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

function fetchImplWithVariables(
  png: Buffer,
  document: unknown,
  variablesResponse: { status: number; body?: unknown },
): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/variables/local")) {
      return new Response(variablesResponse.body ? JSON.stringify(variablesResponse.body) : null, {
        status: variablesResponse.status,
      });
    }
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

describe("fetchBaseline bound color variables", () => {
  const boundFillDocument = {
    type: "FRAME",
    fills: [
      {
        type: "SOLID",
        visible: true,
        color: { r: 1, g: 0, b: 0 },
        opacity: 1,
        boundVariables: { color: { type: "VARIABLE_ALIAS", id: "VariableID:1:2" } },
      },
    ],
  };

  const variablesJson = {
    meta: {
      variables: {
        "VariableID:1:2": {
          id: "VariableID:1:2",
          name: "surface/neutral",
          key: "k",
          variableCollectionId: "VariableCollectionId:1:1",
          resolvedType: "COLOR",
          valuesByMode: { "1:0": { r: 229 / 255, g: 229 / 255, b: 229 / 255, a: 1 } },
          remote: false,
          description: "",
          hiddenFromPublishing: false,
          scopes: [],
          codeSyntax: {},
        },
      },
      variableCollections: {
        "VariableCollectionId:1:1": {
          id: "VariableCollectionId:1:1",
          name: "Colors",
          key: "k",
          modes: [{ modeId: "1:0", name: "Light" }],
          defaultModeId: "1:0",
          remote: false,
          hiddenFromPublishing: false,
          variableIds: ["VariableID:1:2"],
        },
      },
    },
  };

  it("fetches variables/local and resolves the bound fill color when the node has a bound variable", async () => {
    const png = PNG.sync.write(makeSolidPng(2, 2, [255, 255, 255, 255]));
    const fetchImpl = fetchImplWithVariables(png, boundFillDocument, {
      status: 200,
      body: variablesJson,
    });

    const result = await fetchBaseline({
      fileKey: "file",
      nodeId: "1:2",
      outPath: path.join(tmp, "figma-baseline-bound-var.png"),
      token: "token",
      fetchImpl,
    });

    expect(result).toMatchObject({
      ok: true,
      fetched: true,
      figmaStyle: { backgroundColor: "#e5e5e5ff" },
      warnings: [],
    });
  });

  it("falls back to the literal color and warns when the variables/local call fails", async () => {
    const png = PNG.sync.write(makeSolidPng(2, 2, [255, 255, 255, 255]));
    const fetchImpl = fetchImplWithVariables(png, boundFillDocument, { status: 403 });

    const result = await fetchBaseline({
      fileKey: "file",
      nodeId: "1:2",
      outPath: path.join(tmp, "figma-baseline-bound-var-403.png"),
      token: "token",
      fetchImpl,
    });

    expect(result).toMatchObject({
      ok: true,
      fetched: true,
      figmaStyle: { backgroundColor: "#ff0000ff" },
    });
    expect(
      result.ok &&
        result.fetched &&
        result.warnings.some((w) => w.includes("bound color variable")),
    ).toBe(true);
  });

  it("never calls variables/local when the node has no bound color variable", async () => {
    const png = PNG.sync.write(makeSolidPng(2, 2, [255, 255, 255, 255]));
    const calls: string[] = [];
    const fetchImpl = ((input: string | URL | Request) => {
      calls.push(String(input));
      return fetchImplWithVariables(png, { type: "FRAME", fills: [] }, { status: 200 })(input);
    }) as typeof fetch;

    await fetchBaseline({
      fileKey: "file",
      nodeId: "1:2",
      outPath: path.join(tmp, "figma-baseline-no-bound-var.png"),
      token: "token",
      fetchImpl,
    });

    expect(calls.some((url) => url.includes("/variables/local"))).toBe(false);
  });
});

function recordingSleep(): { sleep: (ms: number) => Promise<void>; delays: number[] } {
  const delays: number[] = [];
  return {
    delays,
    sleep: async (ms: number) => {
      delays.push(ms);
    },
  };
}

describe("fetchBaseline transient-failure retry", () => {
  const png = PNG.sync.write(makeSolidPng(2, 2, [255, 255, 255, 255]));

  /** Serves the happy path, but answers the first `failures` calls for `stage` with `fail()`. */
  function flakyFetch(
    stage: "/v1/files/" | "/v1/images/" | "cdn",
    failures: number,
    fail: () => Response | Promise<Response>,
  ): { fetchImpl: typeof fetch; calls: string[] } {
    const calls: string[] = [];
    const ok = figmaFetchImpl(png, { type: "FRAME" });
    let remaining = failures;
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      const matches = stage === "cdn" ? url.startsWith("https://cdn.") : url.includes(stage);
      if (matches && remaining > 0) {
        remaining -= 1;
        return fail();
      }
      return ok(input);
    }) as typeof fetch;
    return { fetchImpl, calls };
  }

  it("retries 5xx with capped exponential backoff and jitter, then succeeds", async () => {
    const { fetchImpl, calls } = flakyFetch(
      "/v1/files/",
      2,
      () => new Response("down", { status: 503 }),
    );
    const { sleep, delays } = recordingSleep();
    const result = await fetchBaseline({
      fileKey: "file",
      nodeId: "1:2",
      outPath: path.join(tmp, "retry-5xx", "figma-baseline.png"),
      token: "token",
      fetchImpl,
      retry: { sleep, random: () => 0.5, baseDelayMs: 100 },
    });
    // nodes x3 (503, 503, 200), then images and the CDN download.
    expect(result).toMatchObject({
      ok: true,
      fetched: true,
      meta: {
        apiCallLog: [503, 503, 200, 200, 200].map((status) => ({ status })),
      },
    });
    expect(calls.filter((url) => url.includes("/v1/files/"))).toHaveLength(3);
    // Equal jitter: step/2 + random * step/2 -> 75 for the 100ms step, 150 for 200ms.
    expect(delays).toEqual([75, 150]);
  });

  it("honours Retry-After on 429 instead of the computed backoff", async () => {
    const { fetchImpl } = flakyFetch(
      "/v1/images/",
      1,
      () => new Response("slow down", { status: 429, headers: { "retry-after": "2" } }),
    );
    const { sleep, delays } = recordingSleep();
    const result = await fetchBaseline({
      fileKey: "file",
      nodeId: "1:2",
      outPath: path.join(tmp, "retry-429", "figma-baseline.png"),
      token: "token",
      fetchImpl,
      retry: { sleep, random: () => 0 },
    });
    expect(result).toMatchObject({ ok: true, fetched: true });
    expect(delays).toEqual([2_000]);
  });

  it("retries network errors and timeouts on the image CDN download", async () => {
    let failures = 0;
    const { fetchImpl } = flakyFetch("cdn", 2, () => {
      failures += 1;
      if (failures === 1) throw new TypeError("fetch failed: ECONNRESET");
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    });
    const { sleep, delays } = recordingSleep();
    const result = await fetchBaseline({
      fileKey: "file",
      nodeId: "1:2",
      outPath: path.join(tmp, "retry-network", "figma-baseline.png"),
      token: "token",
      fetchImpl,
      retry: { sleep, random: () => 1 },
    });
    expect(result).toMatchObject({ ok: true, fetched: true });
    expect(delays).toHaveLength(2);
  });

  it("gives up after maxAttempts and reports a retryable outcome", async () => {
    const { fetchImpl, calls } = flakyFetch(
      "/v1/files/",
      10,
      () => new Response("down", { status: 500 }),
    );
    const { sleep } = recordingSleep();
    const result = await fetchBaseline({
      fileKey: "file",
      nodeId: "1:2",
      outPath: path.join(tmp, "retry-exhausted", "figma-baseline.png"),
      token: "token",
      fetchImpl,
      retry: { sleep },
    });
    expect(result).toMatchObject({ ok: true, fetched: false, errorClass: "retryable" });
    expect(calls).toHaveLength(3);
  });

  it("never retries a non-transient status", async () => {
    const { fetchImpl, calls } = flakyFetch(
      "/v1/files/",
      10,
      () => new Response("nope", { status: 403 }),
    );
    const { sleep, delays } = recordingSleep();
    const result = await fetchBaseline({
      fileKey: "file",
      nodeId: "1:2",
      outPath: path.join(tmp, "retry-403", "figma-baseline.png"),
      token: "token",
      fetchImpl,
      retry: { sleep },
    });
    expect(result).toMatchObject({ ok: false, errorClass: "auth" });
    expect(calls).toHaveLength(1);
    expect(delays).toEqual([]);
  });
});

describe("fetchBaseline image validation and durability", () => {
  it("classifies an undecodable download as invalid-image, not a network error, and keeps the old baseline", async () => {
    const outPath = path.join(tmp, "corrupt", "figma-baseline.png");
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, "previous-baseline");
    const result = await fetchBaseline({
      fileKey: "file",
      nodeId: "1:2",
      outPath,
      token: "token",
      fetchImpl: figmaFetchImpl(Buffer.from("definitely not a png"), { type: "FRAME" }),
    });
    expect(result).toMatchObject({ ok: true, fetched: false, errorClass: "invalid-image" });
    expect(result.fetched ? "" : result.message).not.toMatch(/Network error/);
    expect(fs.readFileSync(outPath, "utf8")).toBe("previous-baseline");
    expect(fs.readdirSync(path.dirname(outPath))).toEqual(["figma-baseline.png"]);
  });

  it("records scale and canvasFill in the sidecar and leaves no temp files behind", async () => {
    const outPath = path.join(tmp, "identity", "figma-baseline.png");
    const png = PNG.sync.write(makeSolidPng(2, 2, [0, 0, 0, 0]));
    const result = await fetchBaseline({
      fileKey: "file",
      nodeId: "1:2",
      outPath,
      scale: 2,
      canvasFill: "#ffffff",
      token: "token",
      fetchImpl: figmaFetchImpl(png, { type: "FRAME" }),
    });
    expect(result).toMatchObject({
      ok: true,
      fetched: true,
      meta: { scale: 2, canvasFill: "#ffffff" },
    });
    const written = PNG.sync.read(fs.readFileSync(outPath));
    expect([...written.data.subarray(0, 4)]).toEqual([255, 255, 255, 255]);
    expect(fs.readdirSync(path.dirname(outPath)).toSorted()).toEqual([
      "figma-baseline.meta.json",
      "figma-baseline.png",
    ]);
  });
});
