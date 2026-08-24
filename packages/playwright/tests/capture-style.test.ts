import { chromium } from "@playwright/test";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { captureElementStyle, normalizeFontWeight } from "../src/capture-style.ts";

const browser = await chromium.launch();
afterAll(() => browser.close());

let context: Awaited<ReturnType<typeof browser.newContext>>;
beforeEach(async () => {
  context = await browser.newContext();
});
afterEach(() => context.close());

describe("captureElementStyle", () => {
  it("normalizes an rgb() color to lowercase 8-digit hex, defaulting alpha to opaque (ff)", async () => {
    const page = await context.newPage();
    await page.setContent(`<div id="target" style="color: rgb(37, 99, 235)">x</div>`);

    const snapshot = await captureElementStyle(page, "#target");

    expect(snapshot.color).toBe("#2563ebff");
  });

  it("normalizes a fully-opaque rgba() color to lowercase 8-digit hex", async () => {
    const page = await context.newPage();
    await page.setContent(`<div id="target" style="color: rgba(229, 229, 229, 1)">x</div>`);

    const snapshot = await captureElementStyle(page, "#target");

    expect(snapshot.color).toBe("#e5e5e5ff");
  });

  it("normalizes a semi-transparent rgba() color, encoding alpha instead of dropping it", async () => {
    const page = await context.newPage();
    await page.setContent(`<div id="target" style="color: rgba(0, 0, 0, 0.5)">x</div>`);

    const snapshot = await captureElementStyle(page, "#target");

    expect(snapshot.color).toBe("#00000080");
  });

  it("normalizes background-color independently of text color", async () => {
    const page = await context.newPage();
    await page.setContent(
      `<div id="target" style="color: rgb(37, 99, 235); background-color: rgb(0, 0, 0)">x</div>`,
    );

    const snapshot = await captureElementStyle(page, "#target");

    expect(snapshot.color).toBe("#2563ebff");
    expect(snapshot.backgroundColor).toBe("#000000ff");
  });

  it("parses padding into a numeric spacing box", async () => {
    const page = await context.newPage();
    await page.setContent(
      `<div id="target" style="padding-top:16px;padding-right:8px;padding-bottom:24px;padding-left:4px">x</div>`,
    );

    const snapshot = await captureElementStyle(page, "#target");

    expect(snapshot.spacing).toEqual({ top: 16, right: 8, bottom: 24, left: 4 });
  });

  it("parses fontSize into a number", async () => {
    const page = await context.newPage();
    await page.setContent(`<div id="target" style="font-size:18px">x</div>`);

    const snapshot = await captureElementStyle(page, "#target");

    expect(snapshot.fontSize).toBe(18);
  });

  it("parses a numeric fontWeight directly", async () => {
    const page = await context.newPage();
    await page.setContent(`<div id="target" style="font-weight:600">x</div>`);

    const snapshot = await captureElementStyle(page, "#target");

    expect(snapshot.fontWeight).toBe(600);
  });

  it("normalizes keyword fontWeight values to their numeric equivalent", async () => {
    const page = await context.newPage();
    await page.setContent(`<div id="target" style="font-weight:bold">x</div>`);

    const snapshot = await captureElementStyle(page, "#target");

    expect(snapshot.fontWeight).toBe(700);
  });

  it("sets cornerRadius per-corner when all four corners are equal", async () => {
    const page = await context.newPage();
    await page.setContent(`<div id="target" style="border-radius:12px">x</div>`);

    const snapshot = await captureElementStyle(page, "#target");

    expect(snapshot.cornerRadius).toEqual({
      topLeft: 12,
      topRight: 12,
      bottomRight: 12,
      bottomLeft: 12,
    });
  });

  it("reports each corner's own radius when corners differ, instead of dropping to undefined", async () => {
    const page = await context.newPage();
    // CSS border-radius shorthand order: top-left, top-right, bottom-right, bottom-left.
    await page.setContent(`<div id="target" style="border-radius:12px 4px 6px 2px">x</div>`);

    const snapshot = await captureElementStyle(page, "#target");

    expect(snapshot.cornerRadius).toEqual({
      topLeft: 12,
      topRight: 4,
      bottomRight: 6,
      bottomLeft: 2,
    });
  });

  it("reports an elliptical corner's horizontal radius (horizontal/vertical radii differ)", async () => {
    const page = await context.newPage();
    await page.setContent(`<div id="target" style="border-radius:12px / 8px">x</div>`);

    const snapshot = await captureElementStyle(page, "#target");

    expect(snapshot.cornerRadius).toEqual({
      topLeft: 12,
      topRight: 12,
      bottomRight: 12,
      bottomLeft: 12,
    });
  });

  it("resolves a percentage border-radius against the element's border-box width, not the raw percentage number", async () => {
    const page = await context.newPage();
    await page.setContent(
      `<div id="target" style="width:200px;height:100px;border-radius:50%">x</div>`,
    );

    const snapshot = await captureElementStyle(page, "#target");

    expect(snapshot.cornerRadius).toEqual({
      topLeft: 100,
      topRight: 100,
      bottomRight: 100,
      bottomLeft: 100,
    });
  });

  it("resolves a percentage border-radius against the untransformed layout width, not the CSS-transformed rendered width", async () => {
    const page = await context.newPage();
    // getBoundingClientRect() would report 400px here (200px scaled 2x); the
    // percentage must still resolve against the untransformed 200px layout width.
    await page.setContent(
      `<div id="target" style="width:200px;height:100px;border-radius:50%;transform:scaleX(2)">x</div>`,
    );

    const snapshot = await captureElementStyle(page, "#target");

    expect(snapshot.cornerRadius).toEqual({
      topLeft: 100,
      topRight: 100,
      bottomRight: 100,
      bottomLeft: 100,
    });
  });

  it("resolves an asymmetric percentage border-radius per corner", async () => {
    const page = await context.newPage();
    await page.setContent(
      `<div id="target" style="width:200px;height:100px;border-radius:50% 10% 50% 10%">x</div>`,
    );

    const snapshot = await captureElementStyle(page, "#target");

    expect(snapshot.cornerRadius).toEqual({
      topLeft: 100,
      topRight: 20,
      bottomRight: 100,
      bottomLeft: 20,
    });
  });

  it("resolves a percentage border-radius against a fractional border-box width without rounding it", async () => {
    const page = await context.newPage();
    await page.setContent(
      `<div id="target" style="width:200.5px;height:100px;border-radius:50%">x</div>`,
    );

    const snapshot = await captureElementStyle(page, "#target");

    expect(snapshot.cornerRadius).toEqual({
      topLeft: 100.25,
      topRight: 100.25,
      bottomRight: 100.25,
      bottomLeft: 100.25,
    });
  });

  it("parses line-height into a number", async () => {
    const page = await context.newPage();
    await page.setContent(`<div id="target" style="line-height:24px;font-size:16px">x</div>`);

    const snapshot = await captureElementStyle(page, "#target");

    expect(snapshot.lineHeightPx).toBe(24);
  });

  it("leaves lineHeightPx undefined for the 'normal' keyword (no fixed px value)", async () => {
    const page = await context.newPage();
    await page.setContent(`<div id="target" style="line-height:normal">x</div>`);

    const snapshot = await captureElementStyle(page, "#target");

    expect(snapshot.lineHeightPx).toBeUndefined();
  });

  it("parses letter-spacing into a number", async () => {
    const page = await context.newPage();
    await page.setContent(`<div id="target" style="letter-spacing:0.5px">x</div>`);

    const snapshot = await captureElementStyle(page, "#target");

    expect(snapshot.letterSpacingPx).toBe(0.5);
  });

  it("normalizes 'normal' letter-spacing to 0, not undefined", async () => {
    const page = await context.newPage();
    await page.setContent(`<div id="target" style="letter-spacing:normal">x</div>`);

    const snapshot = await captureElementStyle(page, "#target");

    expect(snapshot.letterSpacingPx).toBe(0);
  });

  it("parses border-top-width into a number", async () => {
    const page = await context.newPage();
    await page.setContent(`<div id="target" style="border-style:solid;border-width:3px">x</div>`);

    const snapshot = await captureElementStyle(page, "#target");

    expect(snapshot.borderWidth).toBe(3);
  });

  it("parses opacity into a number", async () => {
    const page = await context.newPage();
    await page.setContent(`<div id="target" style="opacity:0.5">x</div>`);

    const snapshot = await captureElementStyle(page, "#target");

    expect(snapshot.opacity).toBe(0.5);
  });

  it("parses a symmetric flex gap into a number", async () => {
    const page = await context.newPage();
    await page.setContent(`<div id="target" style="display:flex;gap:12px">x</div>`);

    const snapshot = await captureElementStyle(page, "#target");

    expect(snapshot.gap).toBe(12);
  });

  it("normalizes an unset gap ('normal') to 0, not undefined", async () => {
    const page = await context.newPage();
    await page.setContent(`<div id="target" style="display:flex">x</div>`);

    const snapshot = await captureElementStyle(page, "#target");

    expect(snapshot.gap).toBe(0);
  });

  it("uses column-gap (not row-gap) as the primary-axis gap for flex-direction: row", async () => {
    const page = await context.newPage();
    await page.setContent(
      `<div id="target" style="display:flex;flex-direction:row;row-gap:4px;column-gap:12px">x</div>`,
    );

    const snapshot = await captureElementStyle(page, "#target");

    expect(snapshot.gap).toBe(12);
  });

  it("uses row-gap (not column-gap) as the primary-axis gap for flex-direction: column", async () => {
    const page = await context.newPage();
    await page.setContent(
      `<div id="target" style="display:flex;flex-direction:column;row-gap:4px;column-gap:12px">x</div>`,
    );

    const snapshot = await captureElementStyle(page, "#target");

    expect(snapshot.gap).toBe(4);
  });

  it("leaves gap undefined when row/column gaps differ on a non-flex element (e.g. grid)", async () => {
    const page = await context.newPage();
    await page.setContent(
      `<div id="target" style="display:grid;row-gap:4px;column-gap:12px">x</div>`,
    );

    const snapshot = await captureElementStyle(page, "#target");

    expect(snapshot.gap).toBeUndefined();
  });

  it("parses a single box-shadow into its structural components", async () => {
    const page = await context.newPage();
    await page.setContent(
      `<div id="target" style="box-shadow: 0px 4px 8px 0px rgba(0, 0, 0, 0.25)">x</div>`,
    );

    const snapshot = await captureElementStyle(page, "#target");

    expect(snapshot.boxShadow).toEqual({
      offsetX: 0,
      offsetY: 4,
      blurRadius: 8,
      spreadRadius: 0,
      color: "#00000040",
      inset: false,
    });
  });

  it("parses an inset box-shadow, distinguishing it from an outer shadow with the same geometry", async () => {
    const page = await context.newPage();
    await page.setContent(
      `<div id="target" style="box-shadow: inset 0px 4px 8px 0px rgba(0, 0, 0, 0.25)">x</div>`,
    );

    const snapshot = await captureElementStyle(page, "#target");

    expect(snapshot.boxShadow).toEqual({
      offsetX: 0,
      offsetY: 4,
      blurRadius: 8,
      spreadRadius: 0,
      color: "#00000040",
      inset: true,
    });
  });

  it("leaves boxShadow undefined when box-shadow is 'none'", async () => {
    const page = await context.newPage();
    await page.setContent(`<div id="target" style="box-shadow:none">x</div>`);

    const snapshot = await captureElementStyle(page, "#target");

    expect(snapshot.boxShadow).toBeUndefined();
  });

  it("captures only the first shadow when multiple are stacked", async () => {
    const page = await context.newPage();
    await page.setContent(
      `<div id="target" style="box-shadow: 0px 1px 2px 0px rgb(0, 0, 0), 0px 8px 16px 0px rgb(255, 0, 0)">x</div>`,
    );

    const snapshot = await captureElementStyle(page, "#target");

    expect(snapshot.boxShadow).toEqual({
      offsetX: 0,
      offsetY: 1,
      blurRadius: 2,
      spreadRadius: 0,
      color: "#000000ff",
      inset: false,
    });
  });
});

describe("normalizeFontWeight", () => {
  // Chromium always resolves font-weight to a numeric computed value, so a
  // browser-driven test never reaches the keyword branch below — exercise it
  // directly with the raw keyword strings instead.
  it('maps the "normal" keyword to 400', () => {
    expect(normalizeFontWeight("normal")).toBe(400);
  });

  it('maps the "bold" keyword to 700', () => {
    expect(normalizeFontWeight("bold")).toBe(700);
  });

  it("passes a numeric string through unchanged", () => {
    expect(normalizeFontWeight("600")).toBe(600);
  });
});
