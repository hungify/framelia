/** Mac's Option key still fires `event.altKey`, so this only affects display labels. */
export function isMacPlatform(): boolean {
  const uaData = (navigator as { userAgentData?: { platform?: string } }).userAgentData;
  return (uaData?.platform ?? navigator.userAgent).toLowerCase().includes("mac");
}

export function altKeyLabel(): string {
  return isMacPlatform() ? "⌥" : "Alt";
}
