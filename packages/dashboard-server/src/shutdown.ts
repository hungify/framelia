/**
 * The minimal slice of `NodeJS.Process`'s `EventEmitter` surface this module
 * needs. Deliberately its own interface rather than `Pick<NodeJS.Process,
 * "once" | "off">`: the real methods return `this` (i.e. `NodeJS.Process`),
 * which would force every fake in tests to fabricate a process-shaped
 * return value for no reason. `unknown` return keeps assignability of the
 * real `process` object (its richer return type is a valid subtype) while
 * letting a plain two-method fake object satisfy the interface directly.
 */
export interface ShutdownSignalSource {
  once(signal: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  off(signal: "SIGINT" | "SIGTERM", listener: () => void): unknown;
}

/**
 * Resolves once SIGINT or SIGTERM fires. Defaults to the real `process`;
 * tests inject a fake `ShutdownSignalSource` instead of sending real OS
 * signals into the shared vitest worker process.
 */
export async function waitForDashboardShutdown(
  signals: ShutdownSignalSource = process,
): Promise<void> {
  await new Promise<void>((resolve) => {
    // Whichever signal fires first must also remove the other's listener —
    // `once()` only self-removes the one that actually fired, leaking the rest.
    const onSignal = (): void => {
      signals.off("SIGINT", onSignal);
      signals.off("SIGTERM", onSignal);
      resolve();
    };
    signals.once("SIGINT", onSignal);
    signals.once("SIGTERM", onSignal);
  });
}
