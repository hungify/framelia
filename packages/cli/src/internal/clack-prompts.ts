import type { Readable, Writable } from "node:stream";

import * as clack from "@clack/prompts";

import type { CliRuntime } from "../runtime-types.ts";
import {
  PROMPT_CANCELLED,
  type PromptAdapter,
  type PromptResult,
  type SelectPromptOptions,
  type TextPromptOptions,
} from "./prompts.ts";

function normalize<T>(value: T | symbol): PromptResult<T> {
  return clack.isCancel(value) ? PROMPT_CANCELLED : value;
}

export function createClackPrompts(runtime: CliRuntime): PromptAdapter {
  // CliRuntime stays minimal for tests; this production adapter receives Node's real process streams.
  const input = runtime.stdin as Readable;
  const output = runtime.stdout as Writable;
  const interactive = "isTTY" in runtime.stdin && runtime.stdin.isTTY === true;
  return {
    interactive,
    intro: (message) => clack.intro(message, { output }),
    outro: (message) => clack.outro(message, { output }),
    note: (message, title) => clack.note(message, title, { output }),
    warn: (message) => clack.log.warn(message, { output }),
    cancel: (message) => clack.cancel(message, { output }),
    confirm: async (message, initialValue) =>
      normalize(await clack.confirm({ message, initialValue, input, output })),
    text: async (options: TextPromptOptions) =>
      normalize(await clack.text({ ...options, input, output })),
    select: async <T extends string>(options: SelectPromptOptions<T>) => {
      const selected = await clack.select<string>({
        message: options.message,
        options: options.options.map(({ value, label, hint }) => ({
          value: value as string,
          label,
          ...(hint === undefined ? {} : { hint }),
        })),
        input,
        output,
      });
      if (clack.isCancel(selected)) return PROMPT_CANCELLED;
      // clack returns one of the values it was given, and every one of them is a T.
      const value = selected as T;
      return value;
    },
  };
}
