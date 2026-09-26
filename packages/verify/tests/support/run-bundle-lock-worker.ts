// Standalone worker process for run-bundle.test.ts's cross-process lock regression test.
// Runs as a genuinely separate OS process (not just a separate async task in the same
// event loop) so `publishAttempt`/`finalizeRunRecord`'s `withRunLock` is exercised the
// same way it would be across two real Playwright workers/coordinators -- a same-process
// `Promise.all` over two synchronous-at-heart functions can't reproduce this race at all.
import type { AttemptRecord } from "@framelia/contracts/workflow";

import { finalizeRunRecord, publishAttempt } from "../../src/run-bundle/index.ts";

async function main(): Promise<void> {
  const [, , mode, root, runId, payloadJson] = process.argv;
  if (!mode || !root || !runId || !payloadJson) {
    throw new Error(
      "usage: run-bundle-lock-worker.ts <publish|finalize> <root> <runId> <payloadJson>",
    );
  }
  const payload: Record<string, unknown> = JSON.parse(payloadJson);

  if (mode === "publish") {
    const attemptInput = payload.attempt;
    if (!attemptInput || typeof attemptInput !== "object") {
      throw new Error('publish payload missing an "attempt" object');
    }
    // `publishAttempt` itself re-validates via `attemptRecordSchema.parse`, so this is a
    // structural cast, not a trust boundary -- the caller (run-bundle.test.ts) always
    // serializes a real `attemptFixture(...)` result here.
    const attempt = attemptInput as Omit<AttemptRecord, "evidence">;
    const rawFiles = (payload.files ?? {}) as Record<string, string>;
    const files = Object.fromEntries(
      Object.entries(rawFiles).map(([key, value]) => [key, Buffer.from(value, "base64")]),
    );
    await publishAttempt(root, runId, attempt, files);
  } else if (mode === "finalize") {
    const retryAcceptance = payload.retryAcceptance;
    if (
      retryAcceptance !== "require-first-attempt" &&
      retryAcceptance !== "allow-passed-after-retry"
    ) {
      throw new Error(`finalize payload has invalid retryAcceptance: ${String(retryAcceptance)}`);
    }
    await finalizeRunRecord(root, runId, { retryAcceptance });
  } else {
    throw new Error(`unknown mode: ${mode}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exit(1);
  });
