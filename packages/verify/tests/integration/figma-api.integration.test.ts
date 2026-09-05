import { beforeAll, describe, expect, it } from "vitest";

import {
  clearNodeMetaCache,
  deriveExpectStyle,
  getNodeMetadata,
  type NodeMetadata,
  resolveToken,
} from "../../src/figma-api.ts";

// Real Figma file: framelia design system, "login form" node.
// https://www.figma.com/design/q2MZbYDBibNKYDm7ESfvKF/framelia?node-id=6006-1028
const FILE_KEY = "q2MZbYDBibNKYDm7ESfvKF";
// The URL's node-id uses "-"; the REST API expects ":".
const NODE_ID = "6006:1028";

const token = resolveToken();

// Requires a real FIGMA_ACCESS_TOKEN with read access to the file above.
// Skipped by default (see `pnpm test:integration`) so it never runs in the
// regular `pnpm test` / CI-on-every-PR path, where the secret isn't present.
describe.runIf(Boolean(token))("Figma API integration (real network)", () => {
  // Fetched once and shared across every test in this file -- each `it`
  // calling getNodeMetadata separately doubled real network calls and made
  // the suite flaky under back-to-back requests.
  let meta: NodeMetadata;

  beforeAll(async () => {
    clearNodeMetaCache();
    const result = await getNodeMetadata(FILE_KEY, NODE_ID, token!, { cache: false });
    if ("error" in result) throw new Error(`Figma API error: ${result.error}`);
    meta = result;
  });

  it("fetches real node metadata for the login form node", () => {
    // The login form node is a top-level FRAME (auto-layout container).
    expect(meta.nodeType).toBe("FRAME");
    expect(meta.lastModified).not.toBeNull();
    // Figma returns ISO 8601 without milliseconds ("...49Z"); Date always
    // re-serializes with them ("...49.000Z"), so compare parsed validity
    // instead of exact string equality.
    expect(Number.isNaN(new Date(meta.lastModified!).getTime())).toBe(false);

    // absoluteBoundingBox is always present for a FRAME.
    expect(meta.absoluteBoundingBox).not.toBeNull();
    expect(meta.absoluteBoundingBox!.width).toBeGreaterThan(0);
    expect(meta.absoluteBoundingBox!.height).toBeGreaterThan(0);

    // FRAMEs (not TEXT) never carry a TypeStyle.
    expect(meta.typeStyle).toBeNull();
    expect(Array.isArray(meta.fills)).toBe(true);
  });

  it("derives an ExpectStyle shape from the real response", () => {
    // This frame currently has no visible SOLID fill, so there's nothing to
    // derive a color from -- update this assertion if the design gains one.
    expect(deriveExpectStyle(meta)).toBeUndefined();
  });
});
