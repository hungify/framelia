#!/usr/bin/env node
// PreToolUse hook for the tdd subagents: keeps each phase on its side of the test/code line.
//   tests-only: RED (tdd-test-writer) may only write tests and test infrastructure.
//   no-tests:   GREEN/REFACTOR (tdd-implementer, tdd-refactorer) may not touch them.
// Exit code 2 blocks the tool call and feeds stderr back to the subagent.
import { readFileSync } from "node:fs";
import { relative } from "node:path";

const TEST_PATHS = [
  /\.test\.ts$/,
  /^(packages|apps)\/[^/]+\/tests\//,
  /^packages\/playwright\/tests-smoke[^/]*\//,
  /^(packages|apps)\/[^/]+\/(vitest|playwright)(\.[\w-]+)*\.config\.ts$/,
  /^scripts\/consumer-smoke\//,
];

const mode = process.argv[2];
const data = JSON.parse(readFileSync(0, "utf8"));
const filePath = data.tool_input?.file_path ?? data.tool_input?.notebook_path;
if (typeof filePath !== "string") process.exit(0);

const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const path = relative(projectDir, filePath).split("\\").join("/");
const isTestPath = TEST_PATHS.some((pattern) => pattern.test(path));

if (mode === "tests-only" && !isTestPath) {
  process.stderr.write(
    `Blocked by tdd-guard: RED writes tests only, not ${path}. Leave the implementation to the GREEN phase.\n`,
  );
  process.exit(2);
}
if (mode === "no-tests" && isTestPath) {
  process.stderr.write(
    `Blocked by tdd-guard: ${path} is a test. Make the code pass the test as written; if the test is wrong, stop and report why.\n`,
  );
  process.exit(2);
}
