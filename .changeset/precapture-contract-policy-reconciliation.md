---
"@framelia/verify": patch
"@framelia/playwright": patch
---

Fix `defineFigmaTests`: reconcile contract, project policy, and pinned baseline identity immediately before capture, not just at run finalization.

`defineFigmaTests` loaded each contract file once, at Playwright test _collection_ time, and closed over the resulting `AuthoredContract` for every later execution of the registered test callback -- nothing re-validated that the file on disk still matched what was registered by the time the callback actually ran. A contract edited (and possibly reverted) between collection and execution could be captured against a stale or never-verified identity while `finalizeRunRecord`'s own `reconcileCasePlan` (framelia/#77, #87) only re-derives _current_ digests at the very end of the run, so an edit-then-revert sequence around the capture window went undetected and could still be selected as an authoritative pass. The project policy (`framelia.config.*`) had the same shape of gap, plus its own module-type-dependent wrinkle: a CommonJS-scoped config resolves through Node's `require()` cache, which never invalidates on content change for the life of the process, so an async, semantic policy-digest check alone can be permanently blind to drift for that config type, not just racing a narrow window for an ESM-scoped one. The pinned baseline had a third, related gap: its verified image/style bytes were read a second time, well after verification, from the same shared, externally-writable `.framelia/baselines/<digest>/` location -- a swap-then-revert of those shared files during the real, unbounded wall-clock time between verification and the actual comparison went undetected by everything, including finalization.

The registered test callback now, immediately before any observable work (skip decisions, viewport reconciliation, capture):

- Reloads the contract file and compares its digest against the one captured at registration time.
- Re-resolves the project policy (`resolveProjectPolicy`) and compares its digest against the one captured at registration time, **and** independently hashes the project config file's raw bytes synchronously (immune to both the async import race and the CommonJS require-cache blind spot) and compares that too -- the two checks are complementary, not redundant.
- Copies the pinned baseline's just-verified image (and style, if present) bytes into the current attempt's own private, per-test work directory immediately after verification, and uses that private copy for comparison and evidence attachment instead of re-reading the shared baseline path a second time later.

Each check throws a clear error and refuses to run rather than silently capturing against drifted, unverified, or swapped content. `options.maxMaskedAreaRatio`/`fontPolicy`/`animationPolicy`/`devtoolsSelector`/`timeoutMs`/`prepare`/`projectRoot` are literal call-site values, not file-backed, so they have no equivalent live-process drift window and are unaffected.

`@framelia/verify`'s `project-policy` subpath now also re-exports `fileHash`, so a caller resolving a project's config path can hash that file's raw bytes the same way `reconcile.ts` already does for a spec file.
