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
