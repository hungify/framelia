#!/usr/bin/env node
// PreToolUse hook: block .env* access (except .env.example).
// Exit code 2 blocks the tool call and feeds stderr back to Claude.
import { readFileSync } from "node:fs";
import { basename } from "node:path";

const PATH_KEYS = ["file_path", "notebook_path", "path", "glob"];
const ENV_TOKEN = /(?<![A-Za-z0-9_])\.env(?:\.[\w.-]+)?(?!\w)/g;

const isBlockedEnv = (name) => name !== ".env.example";

const checkPath = (value) => {
  const name = basename(value);
  if (name.startsWith(".env") && isBlockedEnv(name)) {
    return `access to ${name} is blocked (only .env.example is allowed)`;
  }
  return null;
};

const checkEnvInCommand = (cmd) => {
  for (const [token] of cmd.matchAll(ENV_TOKEN)) {
    if (isBlockedEnv(token)) {
      return `command touches ${token} (only .env.example is allowed)`;
    }
  }
  return null;
};

const main = () => {
  const data = JSON.parse(readFileSync(0, "utf8"));
  const toolInput = data.tool_input ?? {};
  let reason = null;

  if (data.tool_name === "Bash") {
    reason = checkEnvInCommand(toolInput.command ?? "");
  } else {
    for (const key of PATH_KEYS) {
      const value = toolInput[key];
      if (typeof value === "string" && value) {
        reason = checkPath(value);
        if (reason) break;
      }
    }
  }

  if (reason) {
    process.stderr.write(`Blocked by .claude/hooks/guard.mjs: ${reason}\n`);
    process.exit(2);
  }
};

main();
