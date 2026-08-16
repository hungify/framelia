import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveArtifactPath } from "../src/index.ts";
import { compositeOnCanvas, makeSolidPng, parseHexRgb } from "../src/internal.ts";

describe("resolveArtifactPath", () => {
  it("keeps absolute paths", () => {
    const abs = path.resolve("/tmp/artifacts/out");
    expect(resolveArtifactPath(abs, "/other")).toBe(path.normalize(abs));
  });

  it("resolves relative against cwd", () => {
    expect(resolveArtifactPath(".framelia/artifacts/x", "/repo")).toBe(
      path.resolve("/repo", ".framelia/artifacts/x"),
    );
  });
});

describe("canvas composite", () => {
  it("parseHexRgb accepts short and long forms", () => {
    expect(parseHexRgb("#fff")).toEqual([255, 255, 255]);
    expect(parseHexRgb("#112233")).toEqual([0x11, 0x22, 0x33]);
  });

  it("parseHexRgb rejects malformed hexadecimal input", () => {
    expect(() => parseHexRgb("#zzz")).toThrow(/Invalid hex color/);
    expect(() => parseHexRgb("#12345g")).toThrow(/Invalid hex color/);
  });

  it("compositeOnCanvas flattens alpha onto fill", () => {
    const src = makeSolidPng(2, 2, [255, 0, 0, 128]);
    const out = compositeOnCanvas(src, "#000000");
    expect(out.data[0]).toBeGreaterThan(100);
    expect(out.data[0]).toBeLessThan(160);
    expect(out.data[1]).toBe(0);
    expect(out.data[3]).toBe(255);
  });
});
