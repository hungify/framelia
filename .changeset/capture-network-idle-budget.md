---
"@framelia/verify": patch
---

Bound the capture network-idle wait by the capture budget.

- The network-idle wait now uses at most a quarter of the remaining capture budget (still capped at 5s), so a short matcher `timeout` leaves time for fonts, selectors and screenshots instead of ending in a generic matcher timeout.
- When the budget cut the wait short, the "network did not become idle" warning says so. An exhausted budget skips the wait instead of passing Playwright's unbounded `timeout: 0`.
