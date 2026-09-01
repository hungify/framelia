import { SCHEMA_VERSION, verificationRequestSchema } from "@framelia/contracts";
import { describe, expect, it } from "vitest";

import { unionArea } from "../src/capture/masks.ts";

const target = { kind: "web" as const, url: "http://localhost:3000" };
const base = {
  id: "mask.desktop",
  name: "Mask · Desktop",
  baseline: { kind: "figma" as const, fileKey: "file", nodeId: "1:2" },
  viewport: { preset: "desktop", width: 100, height: 100 },
  outDir: ".framelia/visual-verifications/mask",
  scope: { kind: "page" as const, pageReason: "full page" },
};

describe("visual mask contract", () => {
  it("accepts typed mask", () => {
    expect(
      verificationRequestSchema.parse({
        schemaVersion: SCHEMA_VERSION,
        target,
        contracts: [
          {
            ...base,
            masks: [{ selector: "[data-testid=clock]", reason: "server time", maxMatches: 2 }],
          },
        ],
      }),
    ).toMatchObject({ contracts: [{ masks: [{ maxMatches: 2 }] }] });
  });

  it("rejects missing reason, invalid maxMatches, and broad selectors", () => {
    expect(() =>
      verificationRequestSchema.parse({
        schemaVersion: SCHEMA_VERSION,
        target,
        contracts: [{ ...base, masks: [{ selector: ".clock" }] }],
      }),
    ).toThrow(/expected string|reason/i);
    expect(() =>
      verificationRequestSchema.parse({
        schemaVersion: SCHEMA_VERSION,
        target,
        contracts: [{ ...base, masks: [{ selector: ".clock", reason: "time", maxMatches: 0 }] }],
      }),
    ).toThrow(/too small|must be >0|positive/i);
    expect(() =>
      verificationRequestSchema.parse({
        schemaVersion: SCHEMA_VERSION,
        target,
        contracts: [{ ...base, masks: [{ selector: "body", reason: "too broad" }] }],
      }),
    ).toThrow(/broad|root|app shell|document/i);
  });

  it("only rejects app/shell as a whole word, not as a substring of an unrelated class", () => {
    const stillBroad = [".app", ".shell", ".app-shell", ".header-app", ".shell-modal"];
    for (const selector of stillBroad) {
      expect(() =>
        verificationRequestSchema.parse({
          schemaVersion: SCHEMA_VERSION,
          target,
          contracts: [{ ...base, masks: [{ selector, reason: "still broad" }] }],
        }),
      ).toThrow(/broad|root|app shell|document/i);
    }

    const legitimate = [
      ".appointment-badge",
      ".approval-count",
      ".shellfish-icon",
      ".snapshot-approval-tag",
      ".dropshell",
    ];
    for (const selector of legitimate) {
      expect(
        verificationRequestSchema.parse({
          schemaVersion: SCHEMA_VERSION,
          target,
          contracts: [{ ...base, masks: [{ selector, reason: "dynamic content" }] }],
        }),
      ).toMatchObject({ contracts: [{ masks: [{ selector }] }] });
    }
  });
});

describe("shared capture mask behavior", () => {
  it("unions overlapping bounds instead of summing them", () => {
    expect(
      unionArea([
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 5, y: 0, width: 10, height: 10 },
      ]),
    ).toBe(150);
  });
});
