import * as http from "node:http";

import { describe, expect, it } from "vitest";

import { suggestMasksForUrl } from "../src/suggest-masks.ts";

async function withTestServer(html: string, run: (url: string) => Promise<void>): Promise<void> {
  const server = http.createServer((_request, response) => {
    response.setHeader("content-type", "text/html");
    response.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Test server did not expose a TCP port.");
    await run(`http://127.0.0.1:${address.port}/`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

describe("suggestMasksForUrl", () => {
  it("navigates, settles, and returns candidate mask selectors for dynamic content", async () => {
    await withTestServer(
      `<p>Last seen <time datetime="2026-01-01">just now</time></p>
       <div data-testid="user-avatar" data-dynamic>A</div>`,
      async (url) => {
        const result = await suggestMasksForUrl({ url, headless: true, timeoutMs: 10_000 });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.suggestions.map((s) => s.heuristic).toSorted()).toEqual(
          ["avatar-image", "data-dynamic", "time-element"].toSorted(),
        );
      },
    );
  }, 30_000);

  it("returns no suggestions for a fully static page", async () => {
    await withTestServer(`<h1>Static heading</h1><p>Static copy.</p>`, async (url) => {
      const result = await suggestMasksForUrl({ url, headless: true, timeoutMs: 10_000 });
      expect(result).toMatchObject({ ok: true, suggestions: [] });
    });
  }, 30_000);

  it("reports a structured failure when navigation fails", async () => {
    const result = await suggestMasksForUrl({
      url: "http://127.0.0.1:1/unreachable",
      headless: true,
      timeoutMs: 2_000,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("CAPTURE_NAVIGATION_FAILED");
    expect(result.message).toBeTruthy();
  }, 30_000);
});
