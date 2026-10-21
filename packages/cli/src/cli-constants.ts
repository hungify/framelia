export const TRUSTED_REQUIREMENTS_PUBLIC_KEY_ENV = "FRAMELIA_TRUSTED_REQUIREMENTS_PUBLIC_KEY";
export const PROTECTED_JOB_IDENTITY_ENV = "FRAMELIA_PROTECTED_JOB_IDENTITY";
export const AUTHORITY_AUDIENCE_ENV = "FRAMELIA_AUTHORITY_AUDIENCE";
export const MAX_SIGNED_REQUIREMENTS_VALIDITY_MS = 15 * 60 * 1_000;

export const VIEWPORT_PRESETS = ["desktop", "mobile", "custom"] as const;
export type ViewportPreset = (typeof VIEWPORT_PRESETS)[number];

export const SCOPE_KINDS = ["page", "region"] as const;
export type ScopeKind = (typeof SCOPE_KINDS)[number];
export const SCHEMA_TARGETS = ["contract", "requirements"] as const;
export type SchemaTarget = (typeof SCHEMA_TARGETS)[number];
/** Shells `@stricli/auto-complete` can install completion for; it supports only bash today. */
export const COMPLETION_SHELLS = ["bash"] as const;
export type CompletionShell = (typeof COMPLETION_SHELLS)[number];
/** The executable bash runs on <TAB>; shipped as a bin beside `framelia`. */
export const BASH_COMPLETION_COMMAND = "__framelia_bash_complete";

export function identityParser(input: string): string {
  return input;
}

export const projectRootFlag = {
  kind: "parsed",
  parse: identityParser,
  optional: true,
  brief: "target project root",
  placeholder: "dir",
} as const;
