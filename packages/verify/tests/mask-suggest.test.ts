import { chromium } from "@playwright/test";
import { afterAll, describe, expect, it } from "vitest";

import { suggestMasks } from "../src/mask-suggest.ts";

const browser = await chromium.launch();
afterAll(() => browser.close());

async function suggestFor(html: string) {
  const page = await browser.newPage();
  try {
    await page.setContent(html);
    return await suggestMasks(page);
  } finally {
    await page.close();
  }
}

describe("suggestMasks", () => {
  it("flags nothing on a page with no dynamic-content signals", async () => {
    const suggestions = await suggestFor(`
      <h1>Welcome</h1>
      <p class="content">Static marketing copy that never changes.</p>
      <div class="card"><img src="/logo.png" alt="Company logo" /></div>
    `);
    expect(suggestions).toEqual([]);
  });

  it("flags a <time> element and prefers its own selector when there's nothing more specific", async () => {
    const suggestions = await suggestFor(`<p>Posted <time datetime="2026-01-01">Jan 1</time></p>`);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      selector: "time",
      heuristic: "time-element",
      matchedCount: 1,
    });
    expect(suggestions[0]!.maxMatches).toBeUndefined();
  });

  it("groups multiple unlabeled matches of the same heuristic into one selector with maxMatches", async () => {
    const suggestions = await suggestFor(`
      <time datetime="2026-01-01">Jan 1</time>
      <time datetime="2026-01-02">Jan 2</time>
      <time datetime="2026-01-03">Jan 3</time>
    `);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({ selector: "time", matchedCount: 3, maxMatches: 3 });
  });

  it("prefers data-testid over the heuristic's own selector when present", async () => {
    const suggestions = await suggestFor(
      `<div data-dynamic data-testid="last-updated">3 minutes ago</div>`,
    );
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      selector: '[data-testid="last-updated"]',
      heuristic: "data-dynamic",
      matchedCount: 1,
    });
  });

  it("reports the true match count (and maxMatches) when the same specific selector repeats (PR #51 review)", async () => {
    const suggestions = await suggestFor(`
      <div data-dynamic data-testid="row-status">A</div>
      <div data-dynamic data-testid="row-status">B</div>
      <div data-dynamic data-testid="row-status">C</div>
    `);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      selector: '[data-testid="row-status"]',
      matchedCount: 3,
      maxMatches: 3,
    });
  });

  it("falls back to #id when no data-testid is present", async () => {
    const suggestions = await suggestFor(`<div id="clock" data-dynamic>12:00</div>`);
    expect(suggestions[0]).toMatchObject({ selector: "#clock" });
  });

  it("flags an avatar image by data-testid, alt text, or src convention", async () => {
    const suggestions = await suggestFor(`
      <img data-testid="user-avatar" src="/u/42.png" alt="avatar" />
    `);
    expect(suggestions.some((s) => s.heuristic === "avatar-image")).toBe(true);
  });

  it("does not flag a plain content image as an avatar", async () => {
    const suggestions = await suggestFor(`<img src="/hero.png" alt="Product hero shot" />`);
    expect(suggestions.some((s) => s.heuristic === "avatar-image")).toBe(false);
  });

  it("flags an ad slot by class/id convention", async () => {
    const suggestions = await suggestFor(`<div id="google_ads_slot_1" class="ad-unit"></div>`);
    expect(suggestions.some((s) => s.heuristic === "ad-slot")).toBe(true);
  });

  it("flags an aria-live region", async () => {
    const suggestions = await suggestFor(`<div aria-live="polite" id="toast">Saved!</div>`);
    expect(suggestions.some((s) => s.heuristic === "aria-live-region")).toBe(true);
  });

  it("every suggestion carries a human-readable reason naming the heuristic that matched", async () => {
    const suggestions = await suggestFor(`<time>now</time>`);
    expect(suggestions[0]!.reason.length).toBeGreaterThan(0);
  });
});
