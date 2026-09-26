---
"@framelia/verify": patch
"@framelia/playwright": patch
---

Fix `readPinnedBaseline`/`defineFigmaTests`: eliminate the second, independent read of the shared pinned baseline image (and style) file that the precapture-reconciliation fix (framelia/#77, #88, PR #89) reintroduced.

`readPinnedBaseline` already read each referenced file's bytes into memory to compute and verify its digest, then discarded those bytes and returned only a path. `defineFigmaTests`'s registered test callback then called `fs.copyFileSync(pinnedBaseline.imagePath, privateImagePath)` to produce its race-free private copy -- a second, independent read of the same shared, externally-writable path, reopening (in a much smaller window) the same TOCTOU class PR #89 exists to close.

`PinnedBaseline` now also carries `imageBytes: Buffer` (and `styleBytes?: Buffer`, mirroring `stylePath`) -- the exact buffers `readPinnedBaseline` read once and verified the digest against. `imagePath`/`stylePath` are unchanged for existing callers (e.g. `reconcile.ts`'s and `run-bundle-projection.ts`'s validate-only calls). `defineFigmaTests` now writes those verified bytes directly (`fs.writeFileSync(privateImagePath, pinnedBaseline.imageBytes)`) instead of re-reading the shared path via `fs.copyFileSync`. Each shared baseline file's bytes are now read from disk exactly once, ever, in the whole call chain.
