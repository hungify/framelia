---
"@framelia/contracts": minor
"@framelia/verify": minor
"@framelia/playwright": minor
"@framelia/dashboard-server": minor
"framelia": minor
---

Make one immutable selected run the durable source of truth for reporting and authoritative gating.

- Publish and structurally validate versioned run plans, full case plans, attempts, selected-attempt reconciliation, portable evidence paths, and persisted publication diagnostics. Remove the legacy `VerificationArtifact` authority path.
- Freeze authored contracts, exact project/repeat membership, browser runtime identity, baseline bytes, policy and registration identities, retry acceptance, and the policy-selected 2–5 screenshot stability count. Generic low-level capture remains single-shot unless an explicit count is supplied.
- Project the exact selected run into live, archived, and static dashboards, including honest subset coverage, retry history, per-attempt evidence and diagnostics, and source/policy/binding/spec provenance.
- Require `done-gate` to load the selected run itself and verify a protected Ed25519-signed CI/deployment requirements envelope against a public key pinned outside the checkout, including run, short-lived time window, protected job identity, audience, served origin, and build identity.
- Seal exact case/attempt membership for every terminal run state (`finalized`, `incomplete`, and `error`). Keep strict bundle reads fail-fast while tolerant selected-run reads retain valid mismatches alongside per-attempt malformed-publication diagnostics. Export relocatable reports without writer-machine paths and return structured incomplete verdicts for unavailable or tampered authority inputs.
