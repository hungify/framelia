import type { captureAndPromotePageBaseline } from "@framelia/verify/cli";
import { describe, expect, it, vi } from "vitest";

import { UsageError } from "../src/exit.ts";
import {
  baselinePromoteCommand,
  type BaselinePromoteOptions,
} from "../src/internal/baseline-promote.ts";
import type { CliRuntime } from "../src/runtime-types.ts";

function fakeRuntime(overrides: Partial<CliRuntime> = {}): CliRuntime {
  return {
    cwd: () => "/project",
    env: {},
    stdin: process.stdin,
    stdout: { write: vi.fn<(text: string) => void>() },
    stderr: { write: vi.fn<(text: string) => void>() },
    exitCode: undefined,
    ...overrides,
  };
}

function baseOptions(overrides: Partial<BaselinePromoteOptions> = {}): BaselinePromoteOptions {
  return {
    key: "home.desktop",
    targetUrl: "https://example.com",
    projectRoot: undefined,
    selector: undefined,
    fullPage: undefined,
    viewportWidth: undefined,
    viewportHeight: undefined,
    promotedBy: undefined,
    runId: undefined,
    note: undefined,
    storageState: undefined,
    headed: undefined,
    ...overrides,
  };
}

const okCapture = vi.fn<typeof captureAndPromotePageBaseline>().mockResolvedValue({
  ok: true,
  baselinePath: "/project/.framelia/baselines/home.desktop/current.png",
  metaPath: "/project/.framelia/baselines/home.desktop/current.png.json",
  meta: {
    current: { version: 1, promotedAt: "2026-01-01T00:00:00.000Z", promotedBy: "someone" },
    history: [],
  },
});

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected promise to reject");
}

describe("baselinePromoteCommand: validation", () => {
  it("rejects a malformed --key with the exact historical message", async () => {
    const error = await rejectionOf(
      baselinePromoteCommand(baseOptions({ key: "Home Desktop" }), fakeRuntime(), {
        captureAndPromote: okCapture,
      }),
    );
    expect(error).toBeInstanceOf(UsageError);
    expect((error as Error).message).toBe(
      "--key must use lowercase letters, numbers, dots, or hyphens, e.g. home.desktop.",
    );
  });

  it("rejects a non-http(s) --target-url with the exact historical message", async () => {
    const error = await rejectionOf(
      baselinePromoteCommand(baseOptions({ targetUrl: "ftp://example.com" }), fakeRuntime(), {
        captureAndPromote: okCapture,
      }),
    );
    expect(error).toBeInstanceOf(UsageError);
    expect((error as Error).message).toBe("--target-url must use http:// or https://.");
  });

  it("rejects a lone --viewport-width with the exact historical pairing message", async () => {
    const error = await rejectionOf(
      baselinePromoteCommand(baseOptions({ viewportWidth: 1280 }), fakeRuntime(), {
        captureAndPromote: okCapture,
      }),
    );
    expect(error).toBeInstanceOf(UsageError);
    expect((error as Error).message).toBe(
      "--viewport-width and --viewport-height must be supplied together.",
    );
  });

  it("rejects a lone --viewport-height the same way", async () => {
    await expect(
      baselinePromoteCommand(baseOptions({ viewportHeight: 720 }), fakeRuntime(), {
        captureAndPromote: okCapture,
      }),
    ).rejects.toBeInstanceOf(UsageError);
  });

  it("rejects a non-positive viewport dimension", async () => {
    await expect(
      baselinePromoteCommand(
        baseOptions({ viewportWidth: -1, viewportHeight: 720 }),
        fakeRuntime(),
        { captureAndPromote: okCapture },
      ),
    ).rejects.toBeInstanceOf(UsageError);
  });

  it("collects multiple simultaneous violations into one message", async () => {
    await expect(
      baselinePromoteCommand(
        baseOptions({ key: "Bad Key", targetUrl: "not-a-url" }),
        fakeRuntime(),
        { captureAndPromote: okCapture },
      ),
    ).rejects.toMatchObject({
      message: expect.stringContaining("; "),
    });
  });

  it("accepts a valid paired viewport and does not throw", async () => {
    const result = await baselinePromoteCommand(
      baseOptions({ viewportWidth: 1280, viewportHeight: 720 }),
      fakeRuntime(),
      { captureAndPromote: okCapture },
    );
    expect(result.ok).toBe(true);
  });
});

describe("baselinePromoteCommand: defaultPromotedBy precedence", () => {
  it("uses an explicit --promoted-by over every env fallback", async () => {
    const capture = vi.fn<typeof captureAndPromotePageBaseline>().mockResolvedValue({
      ok: true,
      baselinePath: "/x",
      metaPath: "/x.json",
      meta: { current: { version: 1, promotedAt: "t", promotedBy: "explicit" }, history: [] },
    });
    await baselinePromoteCommand(
      baseOptions({ promotedBy: "explicit" }),
      fakeRuntime({ env: { FRAMELIA_PROMOTED_BY: "env-var", USER: "user" } }),
      { captureAndPromote: capture },
    );
    expect(capture).toHaveBeenCalledWith(expect.objectContaining({ promotedBy: "explicit" }));
  });

  it("falls back to FRAMELIA_PROMOTED_BY first", async () => {
    const capture = vi.fn<typeof captureAndPromotePageBaseline>().mockResolvedValue({
      ok: true,
      baselinePath: "/x",
      metaPath: "/x.json",
      meta: { current: { version: 1, promotedAt: "t", promotedBy: "x" }, history: [] },
    });
    await baselinePromoteCommand(
      baseOptions(),
      fakeRuntime({
        env: {
          FRAMELIA_PROMOTED_BY: "framelia-var",
          GIT_AUTHOR_EMAIL: "git@example.com",
          USER: "user",
          USERNAME: "username",
        },
      }),
      { captureAndPromote: capture },
    );
    expect(capture).toHaveBeenCalledWith(expect.objectContaining({ promotedBy: "framelia-var" }));
  });

  it("falls back to GIT_AUTHOR_EMAIL when FRAMELIA_PROMOTED_BY is unset", async () => {
    const capture = vi.fn<typeof captureAndPromotePageBaseline>().mockResolvedValue({
      ok: true,
      baselinePath: "/x",
      metaPath: "/x.json",
      meta: { current: { version: 1, promotedAt: "t", promotedBy: "x" }, history: [] },
    });
    await baselinePromoteCommand(
      baseOptions(),
      fakeRuntime({
        env: { GIT_AUTHOR_EMAIL: "git@example.com", USER: "user", USERNAME: "username" },
      }),
      { captureAndPromote: capture },
    );
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({ promotedBy: "git@example.com" }),
    );
  });

  it("falls back to USER when FRAMELIA_PROMOTED_BY and GIT_AUTHOR_EMAIL are unset", async () => {
    const capture = vi.fn<typeof captureAndPromotePageBaseline>().mockResolvedValue({
      ok: true,
      baselinePath: "/x",
      metaPath: "/x.json",
      meta: { current: { version: 1, promotedAt: "t", promotedBy: "x" }, history: [] },
    });
    await baselinePromoteCommand(
      baseOptions(),
      fakeRuntime({ env: { USER: "user", USERNAME: "username" } }),
      {
        captureAndPromote: capture,
      },
    );
    expect(capture).toHaveBeenCalledWith(expect.objectContaining({ promotedBy: "user" }));
  });

  it("falls back to USERNAME when USER is unset", async () => {
    const capture = vi.fn<typeof captureAndPromotePageBaseline>().mockResolvedValue({
      ok: true,
      baselinePath: "/x",
      metaPath: "/x.json",
      meta: { current: { version: 1, promotedAt: "t", promotedBy: "x" }, history: [] },
    });
    await baselinePromoteCommand(baseOptions(), fakeRuntime({ env: { USERNAME: "username" } }), {
      captureAndPromote: capture,
    });
    expect(capture).toHaveBeenCalledWith(expect.objectContaining({ promotedBy: "username" }));
  });

  it("falls back to 'unknown' when nothing is set", async () => {
    const capture = vi.fn<typeof captureAndPromotePageBaseline>().mockResolvedValue({
      ok: true,
      baselinePath: "/x",
      metaPath: "/x.json",
      meta: { current: { version: 1, promotedAt: "t", promotedBy: "x" }, history: [] },
    });
    await baselinePromoteCommand(baseOptions(), fakeRuntime({ env: {} }), {
      captureAndPromote: capture,
    });
    expect(capture).toHaveBeenCalledWith(expect.objectContaining({ promotedBy: "unknown" }));
  });
});

describe("baselinePromoteCommand: result shape", () => {
  it("maps a successful capture to the documented success body", async () => {
    const capture = vi.fn<typeof captureAndPromotePageBaseline>().mockResolvedValue({
      ok: true,
      baselinePath: "/project/.framelia/baselines/home.desktop/current.png",
      metaPath: "/project/.framelia/baselines/home.desktop/current.png.json",
      archivedPath: "/project/.framelia/baselines/home.desktop/archive/1.png",
      meta: {
        current: { version: 2, promotedAt: "2026-01-01T00:00:00.000Z", promotedBy: "alice" },
        history: [],
      },
    });
    const result = await baselinePromoteCommand(
      baseOptions({ key: "home.desktop", promotedBy: "alice" }),
      fakeRuntime(),
      { captureAndPromote: capture },
    );
    expect(result.ok).toBe(true);
    expect(result.body).toMatchObject({
      key: "home.desktop",
      baselinePath: "/project/.framelia/baselines/home.desktop/current.png",
      version: 2,
      promotedAt: "2026-01-01T00:00:00.000Z",
      promotedBy: "alice",
      archivedPath: "/project/.framelia/baselines/home.desktop/archive/1.png",
    });
  });

  it("maps a failed capture to the documented failure body without an archivedPath field", async () => {
    const capture = vi.fn<typeof captureAndPromotePageBaseline>().mockResolvedValue({
      ok: false,
      error: "capture-failed",
      message: "Could not load the target URL.",
    });
    const result = await baselinePromoteCommand(baseOptions(), fakeRuntime(), {
      captureAndPromote: capture,
    });
    expect(result.ok).toBe(false);
    expect(result.body).toEqual({
      key: "home.desktop",
      error: "capture-failed",
      message: "Could not load the target URL.",
    });
  });

  it("resolves --project-root against the injected runtime's cwd, not global process.cwd()", async () => {
    const capture = vi.fn<typeof captureAndPromotePageBaseline>().mockResolvedValue({
      ok: true,
      baselinePath: "/x",
      metaPath: "/x.json",
      meta: { current: { version: 1, promotedAt: "t", promotedBy: "x" }, history: [] },
    });
    await baselinePromoteCommand(baseOptions(), fakeRuntime({ cwd: () => "/injected/root" }), {
      captureAndPromote: capture,
    });
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({ outDir: expect.stringMatching(/^\/injected\/root/) }),
    );
  });
});
