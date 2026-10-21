---
"@framelia/verify": patch
---

Fix review findings across Figma acquisition, locking, run finalization, and comparison.

- `fetchBaseline` retries 429, 5xx, timeouts, and network errors (3 attempts, capped exponential backoff with jitter, honouring `Retry-After`; tunable/injectable via the new `retry` option). An undecodable PNG reports `errorClass: "invalid-image"` instead of a network error. Image and sidecar are written durably (image first, sidecar last), and the sidecar now records `scale` and `canvasFill`.
- `FigmaBaselineProvider`'s cached-baseline fallback refuses a cache fetched for another fileKey/nodeId/scale/canvasFill (or an older sidecar without them) and adds a `style-gate skipped` warning. A fresh fetch no longer triggers a second Figma request for staleness; the fallback checks staleness offline (new `StalenessOptions.offline`).
- `captureAndPromotePageBaseline` returns `CAPTURE_UNSTABLE` unless its stability samples match; promotion fsyncs the image before switching `meta.json`.
- Run-bundle and page-promotion locks record their owner and are reclaimed when that owner was a dead process on the same host.
- `finalizeRunRecord` rethrows the original error if the error seal fails, seals under the run lock, and does not seal on `RUN_BUNDLE_LOCK_TIMEOUT`.
- The selected-run gate judges size gaps with `compare()`'s own per-axis `areaGap()`.
- SSIM shrinks its window for images narrower than 11px and downsamples comparisons above ~4MP; `compare()` flattens alpha onto one background (new optional `CompareOptions.canvasFill`) before every metric; diff clustering uses a typed-array stack.
- `compareStyles` flags color alpha differences beyond `ALPHA_TOLERANCE`.
- Capture gives web fonts half of the remaining budget, and removes its animation-freeze style from the caller's page after capturing.
