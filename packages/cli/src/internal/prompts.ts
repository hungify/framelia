export const PROMPT_CANCELLED = Symbol("prompt-cancelled");
export type PromptResult<T> = T | typeof PROMPT_CANCELLED;

export interface TextPromptOptions {
  readonly message: string;
  readonly placeholder?: string;
  readonly initialValue?: string;
  readonly validate?: (value: string | undefined) => string | undefined;
}

export interface SelectPromptOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly hint?: string;
}

export interface SelectPromptOptions<T extends string> {
  readonly message: string;
  readonly options: readonly SelectPromptOption<T>[];
}

export interface PromptAdapter {
  readonly interactive: boolean;
  readonly intro: (message: string) => void;
  readonly outro: (message: string) => void;
  readonly note: (message: string, title: string) => void;
  readonly warn: (message: string) => void;
  readonly cancel: (message: string) => void;
  readonly confirm: (message: string, initialValue: boolean) => Promise<PromptResult<boolean>>;
  readonly text: (options: TextPromptOptions) => Promise<PromptResult<string>>;
  readonly select: <T extends string>(options: SelectPromptOptions<T>) => Promise<PromptResult<T>>;
}

function unexpectedPrompt(kind: string): never {
  throw new Error(`Unexpected interactive prompt: ${kind}`);
}

export const nonInteractivePrompts: PromptAdapter = {
  interactive: false,
  intro: () => undefined,
  outro: () => undefined,
  note: () => undefined,
  warn: () => undefined,
  cancel: () => undefined,
  confirm: async () => unexpectedPrompt("confirm"),
  text: async () => unexpectedPrompt("text"),
  select: async () => unexpectedPrompt("select"),
};
