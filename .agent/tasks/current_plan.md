# Current Objective

**State**: Audit-remediation pass (June 2026) — hardening the pipeline and fixing the audit's
correctness findings across six PRs.

## Tasks
- [x] CI gates made blocking (lint, tests, real `node --check` syntax pass).
- [x] jsdom protocol smoke test over the localStorage fallback (`tests/protocol.test.js`).
- [x] Device-role race fixed — `detectDevice()` is the single source of truth.
- [x] Quick wins: state factory, state-driven center button, SW shell/fallback fixes, rank cap.
- [x] Security rules shipped by CI (`--only hosting,firestore,database`) + docs reconciled.
- [ ] ESLint `no-undef` re-enabled with explicit globals; production log gating; SRI + headers.
- [ ] Owner console actions: pre-deploy rules diff, Firestore TTL on `lastActivity`, budget alert.

*(This file changes week to week depending on the active PRD / Sprint)*
