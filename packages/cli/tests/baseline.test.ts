import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type {
  CaptureAndPromotePageBaselineOptions,
  CaptureAndPromotePageBaselineOutcome,
} from "@framelia/verify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { baselinePromoteCommand } from "../src/commands/baseline.ts";

const { captureAndPromotePageBaselineMock } = vi.hoisted(() => ({
  captureAndPromotePageBaselineMock:
    vi.fn<
      (
        options: CaptureAndPromotePageBaselineOptions,
      ) => Promise<CaptureAndPromotePageBaselineOutcome>
    >(),
}));

vi.mock("@framelia/verify", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@framelia/verify")>();
  return { ...actual, captureAndPromotePageBaseline: captureAndPromotePageBaselineMock };
});

const temporaryDirectories: string[] = [];
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  process.exitCode = 0;
});

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  captureAndPromotePageBaselineMock.mockReset();
  logSpy.mockRestore();
  process.exitCode = 0;
  delete process.env.FRAMELIA_PROMOTED_BY;
});

function tempProjectRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-cli-baseline-"));
  temporaryDirectories.push(dir);
  return dir;
}

function loggedJson(): unknown {
  const call = logSpy.mock.calls.at(-1);
  return call ? JSON.parse(String(call[0])) : undefined;
}

describe("baselinePromoteCommand", () => {
  it("rejects a malformed --key before capturing anything", async () => {
    await expect(
      baselinePromoteCommand({
        key: "Not Valid!",
        targetUrl: "https://example.test",
        projectRoot: tempProjectRoot(),
      }),
    ).rejects.toThrow(/--key must use lowercase/);
    expect(captureAndPromotePageBaselineMock).not.toHaveBeenCalled();
  });

  it("rejects a non-http(s) --target-url before capturing anything", async () => {
    await expect(
      baselinePromoteCommand({
        key: "home.desktop",
        targetUrl: "ftp://example.test",
        projectRoot: tempProjectRoot(),
      }),
    ).rejects.toThrow(/--target-url must use http/);
    expect(captureAndPromotePageBaselineMock).not.toHaveBeenCalled();
  });

  it("requires --viewport-width and --viewport-height together", async () => {
    await expect(
      baselinePromoteCommand({
        key: "home.desktop",
        targetUrl: "https://example.test",
        projectRoot: tempProjectRoot(),
        viewportWidth: 1440,
      }),
    ).rejects.toThrow(/--viewport-width and --viewport-height must be supplied together/);
    expect(captureAndPromotePageBaselineMock).not.toHaveBeenCalled();
  });

  it("captures into .framelia/visual-verifications/<key> and prints the promotion result", async () => {
    const projectRoot = tempProjectRoot();
    captureAndPromotePageBaselineMock.mockResolvedValue({
      ok: true,
      baselinePath: "/baseline.png",
      metaPath: "/baseline.meta.json",
      meta: {
        current: {
          version: 1,
          promotedAt: "2026-08-01T00:00:00.000Z",
          promotedBy: "alice@example.com",
        },
        history: [],
      },
    });

    await baselinePromoteCommand({
      key: "home.desktop",
      targetUrl: "https://example.test",
      projectRoot,
      promotedBy: "alice@example.com",
    });

    expect(captureAndPromotePageBaselineMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://example.test",
        outDir: path.join(projectRoot, ".framelia/visual-verifications/home.desktop"),
        promotedBy: "alice@example.com",
        headless: true,
      }),
    );
    expect(loggedJson()).toMatchObject({
      key: "home.desktop",
      version: 1,
      promotedBy: "alice@example.com",
    });
    expect(process.exitCode).toBe(0);
  });

  it("defaults --promoted-by from the environment when not supplied", async () => {
    process.env.FRAMELIA_PROMOTED_BY = "ci-bot@example.com";
    captureAndPromotePageBaselineMock.mockResolvedValue({
      ok: true,
      baselinePath: "/baseline.png",
      metaPath: "/baseline.meta.json",
      meta: {
        current: {
          version: 1,
          promotedAt: "2026-08-01T00:00:00.000Z",
          promotedBy: "ci-bot@example.com",
        },
        history: [],
      },
    });

    await baselinePromoteCommand({
      key: "home.desktop",
      targetUrl: "https://example.test",
      projectRoot: tempProjectRoot(),
    });

    expect(captureAndPromotePageBaselineMock).toHaveBeenCalledWith(
      expect.objectContaining({ promotedBy: "ci-bot@example.com" }),
    );
  });

  it("reports a non-zero exit code and the failure reason when capture fails", async () => {
    captureAndPromotePageBaselineMock.mockResolvedValue({
      ok: false,
      error: "CAPTURE_NAVIGATION_FAILED",
      message: "navigation to https://example.test failed: timeout",
    });

    await baselinePromoteCommand({
      key: "home.desktop",
      targetUrl: "https://example.test",
      projectRoot: tempProjectRoot(),
      promotedBy: "alice@example.com",
    });

    expect(loggedJson()).toMatchObject({
      key: "home.desktop",
      error: "CAPTURE_NAVIGATION_FAILED",
    });
    expect(process.exitCode).not.toBe(0);
  });
});
