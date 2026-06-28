# Improvement Roadmap — snake_controller

This folder holds **one spec per improvement initiative** for the app. Each spec is a self‑contained
mini‑PRD: the problem (grounded in real `file:line` evidence), goals/non‑goals, a concrete solution
reusing existing patterns, **testable acceptance criteria**, affected files, dependencies, risks, and
a verification plan that respects this repo's constraints.

**How this was produced.** A 10‑dimension read‑only audit (gameplay, multiplayer netcode,
performance, architecture, testing, security, accessibility, PWA, analytics/growth, visual design)
surfaced 80 findings, synthesized into 23 ranked initiatives. Direction set by the owner:
**optimize for _fun · growth · polish_**, breadth **_full tiered roadmap_**, intent **_pushing for
real users_** (so reliability / security / privacy are in scope as launch‑readiness, not deferred).

## Status legend
`Not started` · `In progress` · `In review` · `Done` — update the `Status` line at the top of each
spec as work moves. (This index doesn't track status; the specs do.)

---

## Guardrails (every spec respects these)
- **No bundler / no ES modules.** One global scope; the `<script>` load order in
  [index.html](../../../public/index.html) is load‑bearing; renaming a top‑level decl can break a
  consumer in another file. ESLint `no-undef` is on with a hand‑maintained `globals` list in
  `.eslintrc.json`.
- **No local Node** → iteration is **CI‑bound** (lint + Vitest + `node --check`, all blocking, then
  auto‑deploy to prod on push to `master` — **including both rule sets**). Visual checks via local
  `python -m http.server` + Claude_Preview eval/snapshot.
- **Two code paths per feature:** Firebase **and** localStorage fallback; **solo** **and** **multi**.
  Sync/state/action changes must be validated against both, or explicitly scoped to one.
- **All instrumentation routes through the hardened `trackEvent()`** ([utils.js](../../../public/js/utils.js)).
  Never log the 6‑digit code or PII.

## Cross‑cutting principles (read before executing any cluster)
1. **One no‑auth threat‑model ledger** — every security/abuse fix (M1, M7, M8, Q8) traces to "anyone
   matching a 6‑digit code can do anything." Keep [firebase_schema.md](../../system/firebase_schema.md)
   as the single accepted‑risk record.
2. **Solo/MP engine duplication is a force multiplier** — `moveSnake`/`movePlayer` are twins, so
   gameplay (B2/Q4), analytics (M2), and tests (M6) all fork. **B1 dedup unblocks them** — sequence it
   as a prerequisite, not a peer.
3. **One palette contract** — Q1's token bug, the hardcoded status hex (Q3), and the canvas palette
   are the same root issue: CSS tokens, JS‑injected colors, and canvas colors must derive from one
   source.

---

## Tier 1 — Quick wins (ship first; zero/low risk, mostly pure additions)

| ID | Spec | Focus | Impact | Effort | Pri | Depends |
|----|------|-------|:------:|:------:|:---:|---------|
| Q1 | [Fix the `--color-primary-rgb` brand token](./q1-color-primary-rgb-token.md) | Polish | High | S | 90 | none |
| Q2 | [Social share preview (OG/Twitter cards) + UTM](./q2-social-share-og-cards.md) | Growth | High | S | 88 | none |
| Q4 | [Combo‑scaled juice + milestone moments](./q4-combo-juice-milestones.md) | Fun | High | S | 86 | none *(Phase 1 of B2)* |
| Q3 | [First‑run controller guidance + numeric keypad + status](./q3-controller-first-run-guidance.md) | Growth / Polish | High | S | 84 | none |
| Q6 | [Privacy policy + analytics consent gate](./q6-privacy-consent-gate.md) | Launch‑readiness | Med | S | 72 | **gates M2** |
| Q7 | [Global error trap + listener recovery](./q7-global-error-trap.md) | Launch‑readiness | Med | S | 70 | none |
| Q5 | [Joystick stream efficiency](./q5-joystick-stream-efficiency.md) | Launch‑readiness | Med | S | 68 | complements M4 |
| Q8 | [Honest 2‑device fallback + pairing nudges](./q8-honest-fallback-and-pairing.md) | Growth | Med | S | 66 | none |

## Tier 2 — Medium (1–2 days each)

| ID | Spec | Focus | Impact | Effort | Pri | Depends |
|----|------|-------|:------:|:------:|:---:|---------|
| M3 | [Baseline accessibility pass](./m3-a11y-baseline.md) | Polish | High | S‑M | 80 | pairs w/ Q1 |
| M1 | [Test the Firebase security rules](./m1-firebase-rules-unit-tests.md) | Launch / Security | High | M | 78 | pairs w/ M7 |
| M4 | [Per‑slot RTDB listeners (more‑players unlock)](./m4-per-slot-rtdb-listeners.md) | Launch‑readiness | High | M | 74 | **after M6** |
| M7 | [Tighten rules: field bounds + SRI + cost tripwires](./m7-rules-tighten-sri-cost.md) | Launch / Security | Med | S | 70 | land w/ M1 |
| M5 | [Canvas render performance](./m5-canvas-render-performance.md) | Polish / Perf | High | M | 66 | none |
| M6 | [Test the multiplayer engine + factories](./m6-multiplayer-engine-tests.md) | Launch / Quality | High | M | 64 | none *(de‑risks M4, B1)* |
| M11 | [Architecture guards: globals CI check, hook registry, JSDoc](./m11-architecture-ci-guards.md) | Launch / Quality | High | M | 60 | globals check first |
| M9 | [Modal & name‑edit a11y/UX hardening](./m9-modal-name-edit-a11y.md) | Polish | Med | M | 58 | after M3 |
| M10 | [SW update UX + PWA install/manifest polish](./m10-pwa-update-install-polish.md) | Growth / Polish | Med | M | 56 | none |
| M2 | [Analytics funnel completeness](./m2-analytics-funnel-completeness.md) | Growth | Med | S‑M | 54 | **needs Q6** |
| M8 | [Action/write rate‑limiting + abuse hardening](./m8-action-rate-limiting.md) | Launch / Security | Med | M | 50 | complements M7 |
| M12 | [MP presence & host‑resilience fixes](./m12-mp-presence-host-resilience.md) | Launch‑readiness | Med | M | 46 | with/after M4 |
| M13 | [Cross‑device capability smoke + support matrix](./m13-capability-support-matrix.md) | Launch‑readiness | Low | M | 38 | none |

## Tier 3 — Big bets (multi‑day; do last, after the safety nets are green)

| ID | Spec | Focus | Impact | Effort | Pri | Depends |
|----|------|-------|:------:|:------:|:---:|---------|
| B2 | [Gameplay depth: difficulty, combo, modes, variety](./b2-gameplay-depth.md) | Fun | High | L | 50 | **gated by B1** *(Phase 1 = Q4)* |
| B1 | [Engine dedup + split `game.js` + CI shape guards](./b1-engine-dedup-and-game-split.md) | Launch / Quality | Med | L | 42 | **after M11 + M6**; prereq for B2 |

---

## Recommended execution order

- **Phase 0 — Ship this week** (parallel, zero/low risk): **Q1, Q2, Q3, Q4, Q5, Q7, Q8**.
  _Correct colors, branded share previews, a controller that explains itself, combo that feels good,
  a crash safety net, honest pairing._
- **Phase 1 — Legal + safety nets** (make everything after verifiable):
  **Q6** (consent — gates analytics) → **M11** (globals CI guard) → **M1** (rules tests) → **M6** (MP/engine tests).
- **Phase 2 — Growth + polish + readiness:** **M2, M3, M10, M5, M7, M8**.
- **Phase 3 — Scale multiplayer:** **M4 + M12** together (now covered by M6) → raise `maxPlayers`; then **M9, M13**.
- **Phase 4 — Big bets** (only after Phase 1 guards are green): **B1** → **B2**.

**If you only do five:** Q1 · Q2 · M1 · M3 · M4.

## Out of scope (explicit)
True multiplayer **host handoff/migration** · a **build step / ES‑module / TypeScript migration**
(the no‑bundler choice is intentional; M11's JSDoc + CI guards give most of the safety without it).
