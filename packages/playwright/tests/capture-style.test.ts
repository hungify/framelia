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

  it("sets cornerRadius when all four corners are equal", async () => {
    const page = await context.newPage();
    await page.setContent(`<div id="target" style="border-radius:12px">x</div>`);

    const snapshot = await captureElementStyle(page, "#target");

    expect(snapshot.cornerRadius).toBe(12);
  });

  it("leaves cornerRadius undefined when corners differ", async () => {
    const page = await context.newPage();
    await page.setContent(`<div id="target" style="border-radius:12px 4px 12px 12px">x</div>`);

    const snapshot = await captureElementStyle(page, "#target");

    expect(snapshot.cornerRadius).toBeUndefined();
  });

  it("leaves cornerRadius undefined when corners are elliptical (horizontal/vertical radii differ)", async () => {
    const page = await context.newPage();
    await page.setContent(`<div id="target" style="border-radius:12px / 8px">x</div>`);

    const snapshot = await captureElementStyle(page, "#target");

    expect(snapshot.cornerRadius).toBeUndefined();
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
