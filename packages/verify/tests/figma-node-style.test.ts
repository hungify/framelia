import type { Node, Paint } from "@figma/rest-api-spec";
import type { ExpectStyle } from "@framelia/contracts";
import { describe, expect, it } from "vitest";

import { expectStyleToSnapshot, extractFigmaStyle } from "../src/figma-node-style.ts";

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
  it("extracts a FRAME's fill as backgroundColor, not color", () => {
    const node = frameNode({ fills: [solidPaint(229 / 255, 229 / 255, 229 / 255)] });

    const snapshot = extractFigmaStyle(node);

    expect(snapshot.backgroundColor).toBe("#e5e5e5ff");
    expect(snapshot.color).toBeUndefined();
  });

  it("extracts a TEXT node's fill as color, not backgroundColor", () => {
    const node = textNode({ fills: [solidPaint(229 / 255, 229 / 255, 229 / 255)] });

    const snapshot = extractFigmaStyle(node);

    expect(snapshot.color).toBe("#e5e5e5ff");
    expect(snapshot.backgroundColor).toBeUndefined();
  });

  it("encodes a semi-transparent fill's opacity into the alpha byte", () => {
    const node = frameNode({ fills: [solidPaint(0, 0, 0, { opacity: 0.5 })] });

    const snapshot = extractFigmaStyle(node);

    expect(snapshot.backgroundColor).toBe("#00000080");
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

  it("expands a uniform cornerRadius to all four corners", () => {
    const node = frameNode({ cornerRadius: 8 });

    const snapshot = extractFigmaStyle(node);

    expect(snapshot.cornerRadius).toEqual({
      topLeft: 8,
      topRight: 8,
      bottomRight: 8,
      bottomLeft: 8,
    });
  });

  it("prefers per-corner rectangleCornerRadii over a uniform cornerRadius when both are present", () => {
    const node = frameNode({ cornerRadius: 8, rectangleCornerRadii: [8, 4, 8, 2] });

    const snapshot = extractFigmaStyle(node);

    expect(snapshot.cornerRadius).toEqual({
      topLeft: 8,
      topRight: 4,
      bottomRight: 8,
      bottomLeft: 2,
    });
  });

  it("extracts lineHeightPx and letterSpacing from a TEXT node's style", () => {
    const node = textNode({ style: { lineHeightPx: 24, letterSpacing: 0.5 } });

    const snapshot = extractFigmaStyle(node);

    expect(snapshot.lineHeightPx).toBe(24);
    expect(snapshot.letterSpacingPx).toBe(0.5);
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

    expect(snapshot.backgroundColor).toBe("#e5e5e5ff");
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

    expect(snapshot.backgroundColor).toBe("#00ff00ff");
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

    expect(snapshot).toEqual({
      backgroundColor: "#e5e5e5ff",
      cornerRadius: { topLeft: 4, topRight: 4, bottomRight: 4, bottomLeft: 4 },
    });
    expect(snapshot.spacing).toBeUndefined();
    expect(snapshot.fontSize).toBeUndefined();
    expect(snapshot.fontWeight).toBeUndefined();
  });
});

describe("expectStyleToSnapshot", () => {
  it("returns an empty snapshot for an empty ExpectStyle", () => {
    expect(expectStyleToSnapshot({})).toEqual({});
  });

  it("maps fontWeight straight through", () => {
    expect(expectStyleToSnapshot({ fontWeight: 700 })).toEqual({ fontWeight: 700 });
  });

  it("maps fontSizePx to fontSize", () => {
    expect(expectStyleToSnapshot({ fontSizePx: 16 })).toEqual({ fontSize: 16 });
  });

  it("maps a color with colorProperty 'color' to snapshot.color as lowercase hex", () => {
    const expectStyle: ExpectStyle = {
      color: { r: 0, g: 0, b: 0, a: 1 },
      colorProperty: "color",
    };

    expect(expectStyleToSnapshot(expectStyle)).toEqual({ color: "#000000ff" });
  });

  it("maps a color with colorProperty 'backgroundColor' to snapshot.backgroundColor", () => {
    const expectStyle: ExpectStyle = {
      color: { r: 255, g: 255, b: 255, a: 0 },
      colorProperty: "backgroundColor",
    };

    expect(expectStyleToSnapshot(expectStyle)).toEqual({ backgroundColor: "#ffffff00" });
  });

  it("omits color when colorProperty is absent (can't tell which field it belongs to)", () => {
    const expectStyle: ExpectStyle = { color: { r: 0, g: 0, b: 0, a: 1 } };

    expect(expectStyleToSnapshot(expectStyle)).toEqual({});
  });

  it("does not fabricate spacing or cornerRadius, which ExpectStyle never carries", () => {
    const expectStyle: ExpectStyle = { fontWeight: 400, fontSizePx: 14 };

    const snapshot = expectStyleToSnapshot(expectStyle);

    expect(snapshot.spacing).toBeUndefined();
    expect(snapshot.cornerRadius).toBeUndefined();
  });

  it("combines every mappable field in one call", () => {
    const expectStyle: ExpectStyle = {
      fontWeight: 600,
      fontSizePx: 20,
      lineHeightPx: 24,
      letterSpacingPx: 0.5,
      color: { r: 229, g: 229, b: 229, a: 1 },
      colorProperty: "backgroundColor",
    };

    expect(expectStyleToSnapshot(expectStyle)).toEqual({
      fontWeight: 600,
      fontSize: 20,
      lineHeightPx: 24,
      letterSpacingPx: 0.5,
      backgroundColor: "#e5e5e5ff",
    });
  });

  it("maps lineHeightPx and letterSpacingPx straight through", () => {
    expect(expectStyleToSnapshot({ lineHeightPx: 24, letterSpacingPx: 0.5 })).toEqual({
      lineHeightPx: 24,
      letterSpacingPx: 0.5,
    });
  });
});
