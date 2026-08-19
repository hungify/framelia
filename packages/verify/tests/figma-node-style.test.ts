import type { Node, Paint } from "@figma/rest-api-spec";
import { describe, expect, it } from "vitest";

import { extractFigmaStyle } from "../src/figma-node-style.ts";

function solidPaint(r: number, g: number, b: number, overrides: Partial<Paint> = {}): Paint {
  return {
    type: "SOLID",
    color: { r, g, b, a: 1 },
    blendMode: "NORMAL",
    ...overrides,
  } as Paint;
}

function frameNode(overrides: Record<string, unknown> = {}): Node {
  return {
    id: "1:2",
    name: "Frame",
    type: "FRAME",
    scrollBehavior: "SCROLLS",
    ...overrides,
  } as unknown as Node;
}

function textNode(overrides: Record<string, unknown> = {}): Node {
  return {
    id: "1:3",
    name: "Text",
    type: "TEXT",
    scrollBehavior: "SCROLLS",
    characters: "Hello",
    style: {},
    ...overrides,
  } as unknown as Node;
}

describe("extractFigmaStyle", () => {
  it("extracts a normalized lowercase 8-digit hex color (opaque alpha) from the first visible SOLID fill", () => {
    const node = frameNode({ fills: [solidPaint(229 / 255, 229 / 255, 229 / 255)] });

    const snapshot = extractFigmaStyle(node);

    expect(snapshot.color).toBe("#e5e5e5ff");
  });

  it("encodes a semi-transparent fill's opacity into the alpha byte", () => {
    const node = frameNode({ fills: [solidPaint(0, 0, 0, { opacity: 0.5 })] });

    const snapshot = extractFigmaStyle(node);

    expect(snapshot.color).toBe("#00000080");
  });

  it("extracts auto-layout padding as spacing", () => {
    const node = frameNode({
      layoutMode: "VERTICAL",
      paddingTop: 8,
      paddingRight: 16,
      paddingBottom: 8,
      paddingLeft: 16,
    });

    const snapshot = extractFigmaStyle(node);

    expect(snapshot.spacing).toEqual({ top: 8, right: 16, bottom: 8, left: 16 });
  });

  it("leaves spacing undefined when only some padding fields are present", () => {
    const node = frameNode({
      layoutMode: "VERTICAL",
      paddingTop: 8,
      // paddingRight, paddingBottom, paddingLeft deliberately omitted --
      // a partial/malformed node must not fabricate 0 for the rest.
    });

    const snapshot = extractFigmaStyle(node);

    expect(snapshot.spacing).toBeUndefined();
  });

  it("extracts fontSize and fontWeight from a TEXT node's style", () => {
    const node = textNode({ style: { fontSize: 16, fontWeight: 700, fontFamily: "Inter" } });

    const snapshot = extractFigmaStyle(node);

    expect(snapshot.fontSize).toBe(16);
    expect(snapshot.fontWeight).toBe(700);
  });

  it("extracts a uniform cornerRadius", () => {
    const node = frameNode({ cornerRadius: 8 });

    const snapshot = extractFigmaStyle(node);

    expect(snapshot.cornerRadius).toBe(8);
  });

  it("still returns the resolved literal color when the fill is bound to a Figma variable", () => {
    const node = frameNode({
      fills: [
        solidPaint(229 / 255, 229 / 255, 229 / 255, {
          boundVariables: { color: { type: "VARIABLE_ALIAS", id: "VariableID:1:2" } },
        }),
      ],
    });

    const snapshot = extractFigmaStyle(node);

    expect(snapshot.color).toBe("#e5e5e5ff");
  });

  it("skips invisible and non-solid fills to find the first visible SOLID fill", () => {
    const node = frameNode({
      fills: [
        {
          type: "GRADIENT_LINEAR",
          blendMode: "NORMAL",
          gradientHandlePositions: [],
          gradientStops: [],
        },
        solidPaint(1, 0, 0, { visible: false }),
        solidPaint(0, 1, 0),
      ],
    });

    const snapshot = extractFigmaStyle(node);

    expect(snapshot.color).toBe("#00ff00ff");
  });

  it("returns an empty snapshot without throwing for a node missing every optional style field", () => {
    const node = frameNode({ fills: [] });

    expect(() => extractFigmaStyle(node)).not.toThrow();
    expect(extractFigmaStyle(node)).toEqual({});
  });

  it("omits only the missing fields on a partially-populated node", () => {
    const node = frameNode({
      fills: [solidPaint(229 / 255, 229 / 255, 229 / 255)],
      cornerRadius: 4,
    });

    const snapshot = extractFigmaStyle(node);

    expect(snapshot).toEqual({ color: "#e5e5e5ff", cornerRadius: 4 });
    expect(snapshot.spacing).toBeUndefined();
    expect(snapshot.fontSize).toBeUndefined();
    expect(snapshot.fontWeight).toBeUndefined();
  });
});
