# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A cross-device Snake game: the **desktop** browser hosts and renders the game; a **phone** acts
as a wireless joystick. The two link via a 6-digit session code / QR code. Live demo:
https://go-console-84748.web.app/

## Commands

- `npm install` — install dev tooling (`firebase-tools`, `eslint`, `vitest`, `prettier`).
- `npm start` — serve `public/` locally (`npx serve -s public`). Open the printed URL; append
  `?session=123456` to force the mobile/controller view in a second tab/device.
- `npm run lint` (ESLint) · `npm test` (Vitest — pure-logic unit tests in `tests/`) ·
  `npm run format` (Prettier).
- **Deploy is automatic** on push to `master` via GitHub Actions
  (`.github/workflows/deploy.yml`, "Fast Deploy - CI/CD"), which runs `firebase deploy --only
  hosting,firestore,database` — the static site **and both rule sets** ship together, so
  `firestore.rules` / `database.rules.json` in this repo are the source of truth. Do **not** run
  `firebase deploy` by hand against production; test rule changes on a scratch project first
  (`.agent/workflows/deploy.md`).
- CI is **blocking**: `lint`, `test` (Vitest, incl. the jsdom protocol smoke test in
  `tests/protocol.test.js`), and a `node --check` syntax pass must all succeed before deploy.

## Architecture (the non-obvious parts)

**No bundler, no ES modules.** `public/index.html` loads plain `<script>` files in a fixed
order, all sharing one global scope:

```
utils.js → logic.js → config.js → state.js → leaderboard.js → leaderboard-ui.js → sound.js →
effects.js → network.js → game.js → share.js → controller.js → main.js
```

Functions and the large mutable state objects (`gameState`, `sessionManager`, `joystickState`,
plus `gameConfig` / `colors` / `GameState`) are globals defined in earlier files and consumed by
later ones. **Load order matters; there is no import graph.** When adding code, keep this
pattern and load any new file at the correct point in `index.html`.

**Single page, two roles.** One `index.html` holds both the desktop view (`#desktop-view`) and
the mobile controller (`#mobile-view`). Which one shows is decided at load from
`window.innerWidth <= 768` or the presence of a `?session=` URL param (`main.js` plus an inline
script at the bottom of `index.html`).

**Firebase hybrid, v8 compat API.** Loaded from the gstatic CDN as the legacy **v8 namespaced**
SDK (`firebase.firestore()`, `firebase.database()`), *not* v9 modular:
- **Firestore** `sessions/{code}` — session metadata, game state (score/state), and one-shot
  game actions (start/restart). Written only on state changes.
- **Realtime Database** `controllers/{code}` — the high-frequency joystick stream (throttled).
- **localStorage fallback** — if Firebase init fails, `network.js` / `controller.js` mirror the
  same flow over `storage` events for single-device testing.

**Data flow.** Desktop owns the game loop, physics, and collision (`game.js`) and listens for
joystick input (RTDB) + actions (Firestore). Mobile captures the joystick and writes input
(RTDB) + start/restart (Firestore). Direction is **continuous (radians), not 4-way**; speed
scales with joystick magnitude. Eating again within `gameConfig.comboWindowMs` builds a combo
multiplier (capped at `maxCombo`), surfaced as a draining yellow badge over the board.

**Analytics (GA4).** Firebase Analytics loads alongside the other SDKs; `config.js` creates a
guarded `analytics` handle (its **own** try/catch so an analytics failure never drops the app into
offline mode). Everything goes through one helper — `trackEvent(name, params)` in `utils.js` — which
**no-ops when analytics is unavailable** (ad-block / offline) and **never throws into gameplay**,
auto-tagging every event with `device_role` (`desktop_host` vs `phone_controller`). Custom events
span the funnel (`session_created`, `controller_arrival`, `controller_connected`,
`game_start`/`game_restart`, `game_over`/`post_score`, `share`, `mute_toggle`, `pwa_install`); GA4
auto-captures audience + `utm_*` acquisition. **Never log PII or the 6-digit session code.** Full
reference + how to view: `.agent/system/analytics.md`.

### File roles (`public/`)
- `js/utils.js` — small shared helpers, incl. `trackEvent()` (the hardened GA4 analytics wrapper).
- `js/logic.js` — **pure, testable** game math: joystick→angle/speed mapping, collision, turn step.
  Unit-tested in `tests/` (the only code with real coverage).
- `js/config.js` — Firebase init (incl. the guarded `analytics` / GA4 handle) + all tunables
  (`gameConfig`) + `colors` + `GameState` enum.
- `js/state.js` — the global mutable state objects.
- `js/leaderboard.js` — local high scores (`localStorage`) **plus** the global Firestore
  leaderboard: per-device id/handle, score submission (monotonic, rules-validated), and the
  capped rank query.
- `js/leaderboard-ui.js` — the desktop trophy-modal UI for the global board (XSS-safe rendering).
- `js/sound.js` — synthesized Web Audio SFX (food/crash/start) + mute toggle; food pitch rises with the combo.
- `js/effects.js` — juice: particle bursts, ripples, score pops, screen shake (desktop render).
- `js/network.js` — desktop session lifecycle, Firestore/RTDB wiring, QR generation, localStorage fallback.
- `js/game.js` — desktop game loop: canvas rendering, movement, collision, and the combo lifecycle.
- `js/share.js` — the phone game-over card + social share intents (WhatsApp / X / Facebook / Instagram).
- `js/controller.js` — mobile joystick capture, connection, and game-over-card wiring.
- `js/main.js` — entry point / device detection.
- `css/` — load order `variables.css` (tokens) → `base.css` → `desktop.css` / `mobile.css` →
  `leaderboard.css`.
- `sw.js` + `manifest.json` — PWA: installable + offline shell. The SW is **network-first** for
  same-origin requests (cache = offline fallback only); bump `CACHE` when shell assets change.

## Conventions

- **Commits:** Conventional Commits `type(scope): desc`, types `feat | fix | refactor | style`
  (`.agent/SOPs/commit_guidelines.md`).
- **Branches:** `feature/…`, `bugfix/…`, `docs/…`, `refactor/…`. Default branch is `master`.
- **`.agent/`** is the project's semantic index — architecture truth, SOPs, workflows, and the
  active task plan (`.agent/tasks/current_plan.md`). Consult it before large changes, but note
  some entries lag the tree (e.g. they may still reference a pre-split monolithic `app.js`).

## Gotchas

- The Firebase **web `apiKey` in `config.js` is public by design** — not a leaked secret.
  Security must come from Firestore/RTDB rules, not from hiding the key.
- The security rules in this repo (`firestore.rules`, `database.rules.json`) **are deployed by
  CI on every master push** — do not hand-edit rules in the Firebase console; the next push
  overwrites them. The security model is no-auth by design; accepted risks + mitigations are
  documented in `.agent/system/firebase_schema.md`.
- Everything shares global scope — renaming a function or variable can break a consumer in
  another file. ESLint's `no-undef` is **on** (error) with every cross-file global declared in
  `.eslintrc.json` `globals`: when you add/rename/remove a top-level function or `let`/`const`
  in `public/js/*`, update that list or CI fails (that failure is the feature).
- **ESLint `no-unused-vars` false positives** are expected for cross-file *functions* (e.g.
  `submitGlobalScore` is defined in `leaderboard.js` but called from `game.js`): ESLint lints each
  file alone, so it can't see those reads. They're **warnings** (the lint command still exits 0) —
  safe to ignore. The `config.js` globals carry explicit `eslint-disable-next-line` directives
  (`/* exported */` would be idiomatic but is ignored when `env.node` is enabled).
- Production `console.log` is gated behind `debugLog()` / `DEBUG` in `utils.js` — use `debugLog`
  for dev chatter; reserve `console.warn`/`console.error` (never gated) for real problems.
- The PWA **service worker is network-first**, so online users always get fresh code — but an
  already-installed SW still needs one reload to update after a deploy. When you change shell
  assets, bump `const CACHE` in `sw.js`. (Local preview can serve stale assets; see
  `.claude` memory / unregister the SW + clear caches when verifying.)
