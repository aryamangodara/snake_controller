# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A cross-device Snake game: the **desktop** browser hosts and renders the game; a **phone** acts
as a wireless joystick. The two link via a 6-digit session code / QR code. Live demo:
https://go-console-84748.web.app/

## Commands

- `npm install` — install dev deps (only `firebase-tools`).
- `npm start` — serve `public/` locally (`npx serve -s public`). Open the printed URL; append
  `?session=123456` to force the mobile/controller view in a second tab/device.
- **Deploy is automatic** on push to `master` via GitHub Actions
  (`.github/workflows/deploy.yml`), which runs `firebase deploy --only hosting`. Do **not** run
  `firebase deploy` by hand (`.agent/workflows/deploy.md`). Note the Action deploys *hosting
  only* — changes to `database.rules.json` or Firestore rules are **not** shipped by CI.
- No lint or test setup yet.

## Architecture (the non-obvious parts)

**No bundler, no ES modules.** `public/index.html` loads plain `<script>` files in a fixed
order, all sharing one global scope:

```
config.js → state.js → network.js → game.js → controller.js → main.js
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
scales with joystick magnitude.

### File roles (`public/`)
- `js/config.js` — Firebase init + all tunables (`gameConfig`) + `colors` + `GameState` enum.
- `js/state.js` — the global mutable state objects.
- `js/network.js` — desktop session lifecycle, Firestore/RTDB wiring, QR generation, localStorage fallback.
- `js/game.js` — canvas rendering, movement, and collision (desktop only).
- `js/controller.js` — mobile joystick capture and connection.
- `js/main.js` — entry point / device detection.
- `css/` — load order `variables.css` (tokens) → `base.css` → `desktop.css` / `mobile.css`.

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
- The test-mode DB rules recorded in the repo's history carried an **expiry timestamp that has
  already passed**; whatever protects the live databases lives in the Firebase console and is
  not fully captured in version control.
- Everything shares global scope — renaming a function or variable can silently break a consumer
  in another file.
