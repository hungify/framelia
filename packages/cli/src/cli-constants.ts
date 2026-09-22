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
