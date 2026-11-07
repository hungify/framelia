---
"@framelia/verify": patch
---

Clamp SSIM to [0, 1] so pixel-identical captures no longer fail attempt publication on a floating-point score of 1.0000000000000002.
