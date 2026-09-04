import { DEFAULT_DASHBOARD_PORT as DASHBOARD_SERVER_DEFAULT_PORT } from "@framelia/dashboard-server";
import {
  EXIT_OK,
  EXIT_USAGE_ERROR,
  EXIT_VISUAL_FAIL,
  JSON_INDENT_SPACES as VERIFY_JSON_INDENT_SPACES,
} from "@framelia/verify";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_DASHBOARD_PORT,
  EXIT_OK as CLI_EXIT_OK,
  EXIT_USAGE_ERROR as CLI_EXIT_USAGE_ERROR,
  EXIT_VISUAL_FAIL as CLI_EXIT_VISUAL_FAIL,
  JSON_INDENT_SPACES,
} from "../src/cli-constants.ts";

/**
 * `cli-constants.ts` duplicates these values as plain literals on purpose: importing
 * `@framelia/verify` or `@framelia/dashboard-server` from a file that every command
 * declaration imports statically would pull Playwright/Hono into `status`'s import graph
 * and defeat lazy loading (see chunk-graph.test.ts). The duplication is only safe while
 * drift is caught -- exit codes and the advertised default port are user-visible
 * contracts, and a divergence would be silent in both directions. This test is the one
 * place allowed to import the heavy packages, because tests are never bundled.
 */
describe("cli-constants: parity with the packages whose values they mirror", () => {
  it("mirrors @framelia/verify's exit codes and JSON indent width", () => {
    expect({
      exitOk: CLI_EXIT_OK,
      exitVisualFail: CLI_EXIT_VISUAL_FAIL,
      exitUsageError: CLI_EXIT_USAGE_ERROR,
      jsonIndentSpaces: JSON_INDENT_SPACES,
    }).toEqual({
      exitOk: EXIT_OK,
      exitVisualFail: EXIT_VISUAL_FAIL,
      exitUsageError: EXIT_USAGE_ERROR,
      jsonIndentSpaces: VERIFY_JSON_INDENT_SPACES,
    });
  });

  it("mirrors @framelia/dashboard-server's DEFAULT_DASHBOARD_PORT", () => {
    expect(DEFAULT_DASHBOARD_PORT).toBe(DASHBOARD_SERVER_DEFAULT_PORT);
  });
});
