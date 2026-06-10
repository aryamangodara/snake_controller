# Architecture

## Overview
A cross-device Snake game: the **desktop** browser hosts and renders the game; a **phone** acts as a
wireless analog joystick. They pair over a 6-digit session code / QR code. Built with vanilla JS and
deployed via Firebase Hosting. Live: https://go-console-84748.web.app/

## Tech stack
- **Frontend:** HTML5 Canvas + CSS3 + ES6+ JavaScript — **no bundler, no ES modules**.
- **Realtime backend:** Firebase (v8 compat SDK) — **Firestore** for session metadata / game state /
  actions, **Realtime Database** for the high-frequency joystick stream. `localStorage` fallback for
  single-device use.
- **Analytics:** Firebase Analytics (GA4) via a hardened `trackEvent()` wrapper — see
  `.agent/system/analytics.md`.
- **Delivery:** PWA (installable, network-first service worker) on Firebase Hosting.

## Two roles, one page
`public/index.html` contains both `#desktop-view` and `#mobile-view`. The view is chosen at load by
viewport width (`<= 768px`) or the presence of a `?session=` URL param. The **desktop** owns the game
loop, movement, collision, rendering, and the combo lifecycle; the **phone** captures the joystick and
sends start/restart actions.

## Load order (no import graph)
Plain `<script>`s share **one global scope**, loaded in this fixed order — earlier files define globals
later files consume:

```
utils.js → logic.js → config.js → state.js → leaderboard.js → leaderboard-ui.js → sound.js →
effects.js → network.js → game.js → share.js → controller.js → main.js
```

CSS load order: `variables.css` (tokens) → `base.css` → `desktop.css` / `mobile.css` →
`leaderboard.css`.

## Directory structure
- `public/` — the deployable static app (Firebase Hosting serves only this).
  - `public/js/` — the 13 scripts above. Pure, testable math lives in `logic.js` (covered by `tests/`).
  - `public/css/` — split, token-driven styles (no `style.css`; no concatenated monolith).
  - `public/index.html` — entry point holding both views.
  - `public/sw.js` + `public/manifest.json` — PWA service worker (network-first) + manifest.
- `tests/` — Vitest unit tests for `logic.js`.
- `firebase.json`, `.firebaserc`, `database.rules.json`, `firestore.rules` — Firebase project
  config; both rule sets are **deployed by CI** and are the source of truth.
- `.github/workflows/deploy.yml` — GitHub Actions: lint + tests + syntax check (all blocking) →
  `firebase deploy --only hosting,firestore,database` on push to **`master`**.

## Data flow
Phone writes joystick input (RTDB) + start/restart (Firestore); desktop listens and runs physics.
Direction is **continuous (radians), not 4-way**, and speed scales with joystick magnitude. Eating
within `gameConfig.comboWindowMs` builds a combo multiplier (capped at `maxCombo`). User actions also
emit GA4 events through `trackEvent()` (a no-op when analytics is unavailable); see
`.agent/system/analytics.md`.

## Design principles
1. **Separation of concerns** — input (`controller.js`), sync (`network.js`), simulation (`game.js`),
   pure math (`logic.js`), and presentation (`css/*`) stay in distinct files.
2. **Testable core** — gameplay math is pure and unit-tested; the rest is thin glue around it.
3. **Resilient sync** — Firestore + RTDB with a `localStorage` fallback so it works on one device.
4. **Responsive by role** — desktop vs. mobile layouts via dedicated stylesheets + viewport detection.
