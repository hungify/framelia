export const VIEWPORT_PRESETS = ["desktop", "mobile", "custom"] as const;
export type ViewportPreset = (typeof VIEWPORT_PRESETS)[number];

export const SCOPE_KINDS = ["page", "region"] as const;
export type ScopeKind = (typeof SCOPE_KINDS)[number];
export const SCHEMA_TARGETS = ["contract", "artifact"] as const;
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
