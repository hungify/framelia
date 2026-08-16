export const FRAMELIA_DIR = ".framelia";
export const VISUAL_VERIFICATIONS_DIR = "visual-verifications";
export const VISUAL_CONTRACT_FILE = "visual-contract.json";
export const VISUAL_VERIFICATION_FILE = "visual-verification.json";
export const DISCOVERY_DIR_NAME = ".discovery";
export const AUTH_STATE_RELATIVE_PATH = "auth/user.json";

export const VISUAL_VERIFICATIONS_ROOT = `${FRAMELIA_DIR}/${VISUAL_VERIFICATIONS_DIR}`;
export const DEFAULT_DISCOVERY_DIR = `${FRAMELIA_DIR}/${DISCOVERY_DIR_NAME}`;
export const DEFAULT_AUTH_STATE_PATH = `${FRAMELIA_DIR}/${AUTH_STATE_RELATIVE_PATH}`;

export function visualArtifactPath(...segments: string[]): string {
  return [VISUAL_VERIFICATIONS_ROOT, ...segments].join("/");
}

const ESCAPED_VISUAL_ROOT = VISUAL_VERIFICATIONS_ROOT.replaceAll(".", "\\.");

// Contract outDir must resolve safely under VISUAL_VERIFICATIONS_ROOT: reject an
// absolute path, any backslash (Windows-style separator ambiguity), and any ".."
// path-traversal segment, before requiring the visual-root prefix plus a subpath.
export const VISUAL_ARTIFACT_DIR_PATTERN = new RegExp(
  `^(?!\\/)(?!.*\\\\)(?!.*(?:^|\\/)\\.\\.(?:\\/|$))${ESCAPED_VISUAL_ROOT}\\/.+`,
);
