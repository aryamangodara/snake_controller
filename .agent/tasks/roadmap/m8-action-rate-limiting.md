# M8 · Action/write rate-limiting + abuse hardening for the no-auth keyspace

> **Tier** medium · **Focus** Launch-readiness / Security · **Impact** Medium · **Effort** M · **Priority** 50/100
> **Status** `Not started` · **Depends on** complements M7 · **Part of** [Roadmap](./README.md)

## 1. Problem — what we're solving

The Firestore/RTDB security rules validate **shape and range** (a 6-digit code path, the joystick
`{x, y}` numeric range, the per-slot key pattern `p[1-6]`, leaderboard score bounds) but they place
**no limit on write FREQUENCY**. With no authentication (security is path/shape-scoped only —
`.agent/system/firebase_schema.md:85-105`) and an enumerable 900,000-code keyspace
(`randomCode()` at `public/js/network.js:39` produces `100000–999999`), any client that
guesses/enumerates an active code can hammer the session's writable fields. This is the realistic
griefing vector and it currently has **no owner**.

Concrete evidence of the unbounded write paths:

- **`sendGameAction()` has no debounce** — `public/js/controller.js:558-574`. Every center-button
  tap or programmatic call writes `gameActions.{slot}` (multiplayer) or `gameAction` (legacy solo)
  to the session doc. A scripted client can flip start/restart hundreds of times per second. The
  center-button handler `handleCenterButtonPress()` (`controller.js:212-221`) gates by
  `centerBtn.disabled`, but that is **UI-only** — `sendGameAction()` itself is unguarded and is the
  exact line the brief flags (`controller.js ~212`/`558`).
- **`sendJoystickInput()` is only loosely throttled at the SENDER** —
  `public/js/controller.js:155-159` throttles to `gameConfig.joystickThrottleMs` (33ms ≈ 30Hz,
  `config.js:90`) but that throttle is **cooperative**: it lives on the honest client. A malicious
  client writes `controllers/{code}/{slot}` directly at any rate the rules allow (unbounded).
- **Host-side action handling is idempotent only by GAME STATE, not by repetition** —
  `mpHandleAction()` (`public/js/mp-net.js:31-38`) and `handleGameActionFromMobile()`
  (`public/js/network.js:352-360`) both no-op once `currentState` has advanced, but a flood of
  `start` actions arriving in the `WAITING_FOR_START` window, or a flood of distinct
  `gameActions.{slot}` keys, still triggers repeated `mpStartRound()`/`startGame()` evaluation and,
  worse, repeated **clearing writes** back to Firestore (`mp-net.js:144-153`,
  `network.js:156-159`) — a write-amplification loop the host pays for.
- **Every writable field touches `lastActivity`** (`network.js`, `mp-net.js`, `controller.js`,
  `mp-client.js` — 11 files reference it). High-frequency action/feedback writes therefore also
  inflate the host's Firestore write bill, which is the actual cost surface behind the
  "annoyance only" risk already logged at `firebase_schema.md:89-101`.

The threat ledger (`firebase_schema.md:85-105`) acknowledges "session griefing" and "multiplayer
slot griefing" as accepted risks but offers **only console-side mitigations** (TTL, budget alert,
future App Check). There is no client/host defense-in-depth layer and the **write-frequency**
dimension is not separately documented.

## 2. Why it matters

This is a **Launch-readiness / Security** item. As the live demo (https://go-console-84748.web.app/)
is pushed toward real users, the no-auth model means the only thing standing between a curious
script-kiddie and a degraded session is the rules' shape validation — which says nothing about
rate. A griefer who enumerates a live code can today: spam start/restart to yank a lobby in and out
of rounds, or flood `gameActions`/`feedback` to force the host into a write-amplification clearing
loop that burns the owner's Firestore quota.

Rules-level rate limiting is **genuinely impractical without auth** (Firestore/RTDB rules cannot
count writes-per-second per anonymous caller). So the honest framing is: this is **defense-in-depth
at the client and host**, reducing self-inflicted write amplification and blunting the most casual
abuse, plus an **honest threat-ledger entry** so the residual risk is owned rather than silent. It
directly supports "pushing for real users" by capping the blast radius of the realistic griefing
vector and protecting the billing surface that a budget alert would otherwise trip.

## 3. Goals

- **Client-side action debounce:** `sendGameAction()` cannot emit the same action more than once per
  a configurable window (`gameConfig.actionDebounceMs`), in **both** hybrid (Firestore) and
  localStorage transports.
- **Host-side ignore-window + idempotency key:** the host ignores a repeated action for a given slot
  within `gameConfig.actionIgnoreMs`, tracked as last-handled-per-slot (`mpHandleAction`) and a
  single last-handled key for the legacy solo field (`handleGameActionFromMobile`), so an action
  flood collapses to one handled action and **does not** re-trigger the clearing-write loop.
- **No behavioral regression:** legitimate start → play → restart still works first-press, in solo
  and multiplayer, over both transports; the existing `tests/protocol.test.js` flow still passes.
- **Honest documentation:** a new "write-frequency abuse" subsection in `firebase_schema.md` that
  states the residual model plainly (client/host mitigation = annoyance-reduction; rules cannot
  rate-limit without auth; console-side App Check/budget alert remain the real backstops).
- **Zero new always-on cost:** purely in-memory guards (timestamps), no new Firestore reads, no new
  always-running timers; guards reset cleanly so tests load with a clean slate.

## 4. Non-goals

- **NOT** adding authentication, App Check, or Anonymous Auth (those are console/owner actions
  already tracked in the ledger; this is the client/host layer that complements them — see M7).
- **NOT** attempting rules-level (Firestore/RTDB) rate limiting — explicitly impractical without
  per-caller identity; the spec frames this honestly rather than pretending otherwise.
- **NOT** re-architecting the joystick stream throttle. `sendJoystickInput()` already throttles at
  `joystickThrottleMs`; tightening the *malicious-client* joystick rate is out of scope (rules
  can't, and a stricter honest-client throttle hurts input feel). We only DOCUMENT this residual.
- **NOT** changing the security rules (`firestore.rules`, `database.rules.json`) — no rule edit is
  proposed, so **CI does not deploy a rules change** and no scratch-project rules test is required.
- **NOT** removing the open `delete` grant (the host's `beforeunload` cleanup depends on it —
  `network.js:416-423`, ledger `firebase_schema.md:91-92`).
- **NOT** adding a visible UI rate-limit error/toast; a debounced action silently no-ops (the UI
  already disables the button during `PLAYING`).

## 5. Proposed solution

Three small, additive changes plus a doc update. All guards are **in-memory timestamps** that mirror
the existing cooperative throttle pattern already proven at `controller.js:155-159`
(`now - joystickState.lastInputTime > gameConfig.joystickThrottleMs`) and the
"fire-once-per-session" guard pattern at `network.js:135` (`sessionManager.controllerTracked`).

### 5.1 Config tunables (reuse the `gameConfig` "Connection settings" block)

Add to `gameConfig` in `public/js/config.js` (alongside `connectionRetries` / `retryDelayMs` at
`config.js:93-95`), so the windows are tunable in one place exactly like `joystickThrottleMs`:

```
actionDebounceMs: 400,  // client: ignore a repeat of the SAME action within this window
actionIgnoreMs:   400,  // host: ignore a repeat action for the same slot within this window
```

These are **data** keys on the existing `gameConfig` object — they do **not** add new top-level
declarations, so **no `.eslintrc.json` globals change** is needed for them (`gameConfig` is already
declared `readonly`).

### 5.2 Client debounce in `sendGameAction()` (`public/js/controller.js`)

Add a module-scoped guard `let lastActionSent = { action: null, at: 0 };` near the other
controller-side trackers (`lastFeedbackAt`/`lastSyncedState`, `controller.js:223-228`). At the top
of `sendGameAction()` (`controller.js:558`), short-circuit when the same action repeats inside the
window:

```
const now = Date.now();
if (action === lastActionSent.action && now - lastActionSent.at < gameConfig.actionDebounceMs) return;
lastActionSent = { action, at: now };
```

Place this **after** the existing `if (!sessionManager.connectedSession) return;` guard and **before**
the transport branch, so it covers **both** the hybrid Firestore write and the localStorage write
(`controller.js:562-573`). `lastActionSent` is a new top-level `let` → it **must be added to
`.eslintrc.json` `globals`** as `"writable"` (same as `lastFeedbackAt`/`lastSyncedState` at
`.eslintrc.json:218-219`).

### 5.3 Host ignore-window + idempotency key (`public/js/mp-net.js` + `public/js/network.js`)

- **Multiplayer (`mpHandleAction`, `mp-net.js:31-38`):** add a last-handled-per-slot map on the
  existing `mpSession` state object (`state.js:73-79`) — e.g. extend the literal with
  `lastAction: {}` (a `slot -> { action, at }` map). At the top of `mpHandleAction(slot, action)`,
  before the roster check resolves to a handler, drop the action when it repeats for that slot
  inside `gameConfig.actionIgnoreMs`:

  ```
  const prev = mpSession.lastAction[slot];
  if (prev && prev.action === action && Date.now() - prev.at < gameConfig.actionIgnoreMs) return;
  mpSession.lastAction[slot] = { action, at: Date.now() };
  ```

  Crucially, gate this **inside `mpHandleDocSnapshot`** so the **clearing write** is also suppressed:
  in `mp-net.js:144-153` the loop currently clears `gameActions.{slot}` for every present action.
  The ignore-window must make a repeated, already-handled action **not re-enter** the
  `clear[...] = null` branch on every snapshot, collapsing the write-amplification loop. (Because
  the host clears the field after handling, the steady-state remains one handled action → one clear;
  the guard defends against a malicious client *re-writing* the same key faster than the clear lands.)

- **Legacy solo (`handleGameActionFromMobile`, `network.js:352-360`):** add a module-scoped
  `let lastSoloAction = { action: null, at: 0 };` near `desktopStorageListenerAttached`
  (`network.js:205-207`) and short-circuit the same way at the top of the handler, **before**
  `startGame()`/`restartGame()` are reached. This is the host-side mirror for the single-field path
  used by old cached phones and the localStorage transport (`network.js:235-240`).

`mpSession.lastAction` is a **new field on an existing global object** (no new global → no eslintrc
change). `lastSoloAction` is a **new top-level `let`** → **add to `.eslintrc.json` `globals`** as
`"writable"` (mirroring `desktopStorageListenerAttached` at `.eslintrc.json:165`).

### 5.4 Both-transports / both-modes coverage

| Path | Client guard | Host guard |
| --- | --- | --- |
| Hybrid solo (legacy `gameAction`) | `sendGameAction` debounce (5.2) | `handleGameActionFromMobile` (5.3) |
| Hybrid multiplayer (`gameActions.{slot}`) | `sendGameAction` debounce (5.2) | `mpHandleAction` + clear-loop gate (5.3) |
| localStorage fallback | `sendGameAction` debounce (5.2, same branch) | `handleGameActionFromMobile` via the `storage` listener (`network.js:235-240`) |

### 5.5 Documentation (`.agent/system/firebase_schema.md`)

Add a **"Write-frequency abuse"** bullet under "Security model & accepted risks"
(`firebase_schema.md:85-105`) that states: (a) rules validate shape/range but **not** rate; (b) the
client debounce + host ignore-window are **annoyance-mitigation / write-amplification defense**, not
a security boundary; (c) a determined attacker bypassing the honest client can still write at the
rules-permitted rate — the real backstops remain **App Check + Anonymous Auth** and the **billing
budget alert** already listed at `firebase_schema.md:103-105`. Cross-reference M7.

### 5.6 Observability

Route a single low-cardinality event through the hardened `trackEvent()` (`utils.js:46-55`) when the
**host** drops a repeated action (see §11) — never logging the code or any PII, consistent with the
analytics contract in `CLAUDE.md`.

## 6. Acceptance criteria

- [ ] **Given** a connected controller, **When** `sendGameAction('start')` is called twice within
  `gameConfig.actionDebounceMs`, **Then** only **one** transport write occurs (one
  `sessionDoc.update` in hybrid, or one `localStorage.setItem(..._action..)` in fallback); the
  second call returns early.
- [ ] **Given** the debounce window has elapsed, **When** the same action is sent again, **Then** it
  **is** emitted (the guard is a window, not a one-shot lock).
- [ ] **Given** a different action (`'restart'` after `'start'`), **When** sent inside the window,
  **Then** it is **not** suppressed (debounce is keyed on the action value).
- [ ] **Given** a multiplayer host in `WAITING_FOR_START`, **When** the same slot's `start` action is
  observed on N consecutive snapshots within `gameConfig.actionIgnoreMs`, **Then** `mpStartRound()`
  runs **at most once** and the `gameActions.{slot}` clearing write fires **at most once** for that
  burst (no per-snapshot clear-write loop).
- [ ] **Given** the legacy solo path, **When** `handleGameActionFromMobile('start')` is invoked
  repeatedly within `actionIgnoreMs`, **Then** `startGame()` is invoked once and subsequent calls
  no-op.
- [ ] **Negative (no functional regression):** the full `tests/protocol.test.js` flow still passes —
  controller connects, ignores pre-start joystick, **starts on the first center-button press**,
  steers, syncs game over, and **restarts on the first press** (`protocol.test.js:95-161`). The
  first legitimate press must never be debounced.
- [ ] **Negative (cross-slot independence):** in multiplayer, a `start` from `p1` does **not**
  suppress a near-simultaneous `start` from `p2` (the host map is keyed per slot).
- [ ] `gameConfig.actionDebounceMs` and `gameConfig.actionIgnoreMs` exist in `config.js` and are the
  single source of truth (no magic numbers inline).
- [ ] **eslintrc globals updated:** `lastActionSent` and `lastSoloAction` added to
  `.eslintrc.json` `globals` as `"writable"`; `mpSession.lastAction` requires **no** entry (field on
  an existing global). `npm run lint` passes (`no-undef` green).
- [ ] **No rules change:** `firestore.rules` and `database.rules.json` are byte-unchanged (CI does
  not ship a rules diff; no scratch-project rules test needed).
- [ ] **No PII / no 6-digit code logged** anywhere added (the host-drop analytics event carries only
  a bounded enum/count — §11).
- [ ] **No `sw.js` `CACHE` bump required** unless `config.js`/`controller.js`/`network.js`/`mp-net.js`
  are shell-cached assets that changed name — they are edited **in place**, so the network-first SW
  serves them fresh; bump `CACHE` only if the team's convention is to bump on any shell edit.
- [ ] **`.agent/system/firebase_schema.md`** has a new "Write-frequency abuse" entry under accepted
  risks, framed as annoyance-mitigation / defense-in-depth (not a security boundary), cross-referencing M7.
- [ ] CI green: `npm run lint`, `npm test` (Vitest, incl. the jsdom `protocol.test.js`), and the
  `node --check` syntax pass all succeed.

## 7. Affected files

| File | Change |
| --- | --- |
| `public/js/config.js` | Add `actionDebounceMs` + `actionIgnoreMs` to the `gameConfig` "Connection settings" block (`config.js:93-95`). Data keys only — **no eslintrc change** for these. |
| `public/js/controller.js` | New module-scoped `let lastActionSent = { action: null, at: 0 };` (near `controller.js:223-228`); debounce guard at the top of `sendGameAction()` (`controller.js:558`), covering both transports. |
| `public/js/network.js` | New module-scoped `let lastSoloAction = { action: null, at: 0 };` (near `network.js:205-207`); ignore-window guard at the top of `handleGameActionFromMobile()` (`network.js:352`). |
| `public/js/mp-net.js` | Per-slot ignore-window in `mpHandleAction()` (`mp-net.js:31-38`) using a new `mpSession.lastAction` map; gate the clearing-write loop in `mpHandleDocSnapshot()` (`mp-net.js:144-153`) so a repeated/already-handled action doesn't re-enter the `clear[...] = null` branch. Optional host-drop `trackEvent` (§11). |
| `public/js/state.js` | Extend the `mpSession` literal (`state.js:73-79`) with `lastAction: {}` (and reset it where the roster resets, if applicable). Field on an existing global — **no eslintrc change**. |
| `.eslintrc.json` | **Globals bump required:** add `"lastActionSent": "writable"` and `"lastSoloAction": "writable"`. |
| `.agent/system/firebase_schema.md` | New "Write-frequency abuse" subsection under "Security model & accepted risks" (`:85-105`). |
| `tests/protocol.test.js` *(optional, recommended)* | Extend the existing harness with a debounce/ignore-window assertion (see §10). No new test file strictly required. |

- **`sw.js` `CACHE`:** no bump required (in-place edits; network-first SW). Bump only per team convention.
- **New files:** none required.

## 8. Dependencies & sequencing

- **Depends on:** nothing hard. **Complements M7** — M7 is the broader no-auth hardening track
  (App Check / Anonymous Auth / `ownerId` direction noted at `firebase_schema.md:23` and
  `:103-105`); M8 is the client/host defense-in-depth layer that sits beneath it. M8 can land
  **independently and first** (no rules change), and explicitly does **not** block M7.
- **Unblocks / enables:** a cleaner story for "pushing to real users" — once App Check (M7/console)
  lands, the M8 client/host guards remain as cheap cooperative throttles. Also makes the billing
  budget-alert tripwire less likely to fire on a write-amplification loop.
- **Load order:** unaffected. All edits stay within files already at their correct positions
  (`config.js` → `state.js` → `network.js` → `mp-net.js` → `controller.js`, per
  `index.html:302-315`); no new file is introduced, so the fixed `<script>` order is untouched.

## 9. Risks & mitigations

- **Risk: debouncing the FIRST legitimate press** (player taps Start and nothing happens).
  **Mitigation:** the guard keys on `(action, timestamp)` and only suppresses a **repeat within the
  window**; the first call always passes (`lastActionSent.action` starts `null`). Acceptance criteria
  assert first-press start AND restart still work via `protocol.test.js`.
- **Risk: global-scope / load-order minefield.** Adding top-level `let`s (`lastActionSent`,
  `lastSoloAction`) without updating `.eslintrc.json` `globals` **fails CI** (`no-undef` is an error,
  `CLAUDE.md` gotchas). **Mitigation:** the eslintrc bump is an explicit acceptance criterion and is
  listed in §7; the `mpSession.lastAction` change is a field on an existing global (safe).
- **Risk: stale `mpSession.lastAction` across rounds** causing a legitimate restart to be wrongly
  ignored. **Mitigation:** the window (`actionIgnoreMs`, ~400ms) is far shorter than any human
  start→restart gap, and `restart` is a different action value than `start` so a fresh round's first
  `start` is never suppressed by a prior `restart`. Reset `mpSession.lastAction` where the roster/
  `defeated` resets (`mpStartRound`, `mp-net.js:53`) if belt-and-suspenders is wanted.
- **Risk: tests load with dirty in-memory guard state.** **Mitigation:** all guards are plain
  literals on module-scoped `let`/`mpSession` (which `state.js` already keeps as plain literals "so
  tests load clean", `state.js:71-72`); the jsdom harness builds a fresh context per page
  (`protocol.test.js:32-46`), so no cross-test leakage.
- **Risk: over-promising security.** A determined attacker bypasses the honest client and writes at
  the rules-permitted rate regardless. **Mitigation:** the spec and the ledger entry frame this
  **honestly** as annoyance-mitigation / write-amplification defense, not a boundary; the real
  backstops (App Check, budget alert) stay documented.
- **Risk: localStorage `_action` key is one-shot-cleared by the host** (`network.js:239`), so a
  client debounce there is mostly redundant. **Mitigation:** harmless — the debounce still prevents
  rapid re-writes between the write and the host's `removeItem`, and keeps both transports symmetric.

## 10. Verification / test plan

Given the no-local-Node, CI-bound constraint, verification leans on **Vitest** (the jsdom protocol
harness is ideal here because it already drives the real action path) plus CI's blocking gates. **No
Firebase emulator / scratch project is needed — there is no rules change.**

1. **Vitest — extend `tests/protocol.test.js` (authoritative):** the harness already evaluates the
   real `controller.js` + `network.js` into jsdom contexts and drives start/restart over the
   localStorage transport (`protocol.test.js:24-27`, `:112-161`). Add focused cases:
   - **Client debounce:** call `controller.run("sendGameAction('start'); sendGameAction('start');")`
     and assert only one `session_{code}_action` write reached the desktop (count via a setItem spy,
     or assert the desktop handled `start` exactly once and `currentState === 'playing'`). Then
     advance time past `actionDebounceMs` (the harness uses synchronous delivery; either inject a
     fake clock or temporarily set `actionDebounceMs` to 0 to prove the window boundary) and assert
     a subsequent same-action call **does** emit.
   - **Host ignore-window:** invoke `desktop.run("handleGameActionFromMobile('start'); handleGameActionFromMobile('start');")`
     in `WAITING_FOR_START` and assert `startGame` ran once (state advanced once; no double-reset).
   - **First-press regression guard:** keep the existing `:112-118` and `:151-161` assertions green
     (start and restart on the first press).
   - **Different-action pass-through:** `start` then `restart` within the window both take effect at
     the appropriate states.
2. **`node --check` / lint (CI):** push the branch; confirm `no-undef` passes (proves the eslintrc
   globals bump for `lastActionSent` / `lastSoloAction` landed) and the syntax pass is green.
3. **`python -m http.server` + Claude_Preview (manual sanity, optional):** serve `public/`,
   **unregister the SW + clear caches first** (network-first SW serves stale assets locally), open
   the desktop view, append `?session=123456` in a second tab for the controller, and rapidly tap
   the center button — confirm a single round start (no flicker / no double-start) and, via
   `preview_console_logs`/`preview_network`, that repeat taps within the window don't each produce a
   write. (Screenshots time out — prefer `preview_eval`/network reads.)
4. **Multiplayer cross-slot (manual or unit):** if exercised, confirm `p1` and `p2` starts are
   independent (the host map is per-slot).

## 11. Analytics & observability

- **New host-side event (low-cardinality, no PII):** when the **host** drops a repeated action
  inside the ignore-window, fire once via the hardened `trackEvent()` (`utils.js:46-55`), e.g.
  `trackEvent('action_throttled', { side: 'host', kind: 'mp' | 'solo' })`. **Never** include the
  6-digit code, the slot identity as anything but a bounded value, or any handle — consistent with
  the analytics contract (`CLAUDE.md`, `utils.js:42-44`). Guard against event spam: only emit on the
  **first** drop of a burst (reuse the same window timestamp), not per dropped write, so a flood
  doesn't become an analytics flood.
- **Watch:** correlate `action_throttled` volume against the existing funnel
  (`game_start`/`game_restart`) in GA4 to size how often the guard actually fires in the wild — a
  spike is the real-world signal that the no-auth keyspace is being probed, informing whether to
  prioritize the M7 App Check work.
- **No new metric infrastructure** — this rides the existing GA4 `trackEvent` wrapper, which
  no-ops offline and never throws into gameplay.
