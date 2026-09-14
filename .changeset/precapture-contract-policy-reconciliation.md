---
"@framelia/playwright": patch
---

Fix `defineFigmaTests`: reconcile the contract and project policy identity immediately before capture, not just at run finalization.

`defineFigmaTests` loaded each contract file once, at Playwright test _collection_ time, and closed over the resulting `AuthoredContract` for every later execution of the registered test callback -- nothing re-validated that the file on disk still matched what was registered by the time the callback actually ran. A contract edited (and possibly reverted) between collection and execution could be captured against a stale or never-verified identity while `finalizeRunRecord`'s own `reconcileCasePlan` (framelia/#77, #87) only re-derives _current_ digests at the very end of the run, so an edit-then-revert sequence around the capture window went undetected and could still be selected as an authoritative pass. The project policy (`framelia.config.*`) had the same shape of gap: file-backed, re-readable mid-process, and never checked by `defineFigmaTests` at all.

The registered test callback now reloads the contract file and re-resolves the project policy fresh, immediately before any observable work (skip decisions, viewport reconciliation, capture), and compares each against the digest captured at registration time -- throwing a clear error and refusing to run rather than silently capturing against drifted or unverified content. `options.maxMaskedAreaRatio`/`fontPolicy`/`animationPolicy`/`devtoolsSelector`/`timeoutMs`/`prepare`/`projectRoot` are literal call-site values, not file-backed, so they have no equivalent live-process drift window and are unaffected. `readPinnedBaseline` was already read fresh on every execution and already digest-verified internally, so it needed no change.
