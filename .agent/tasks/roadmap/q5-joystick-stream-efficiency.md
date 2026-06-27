# Q5 · Joystick stream efficiency: change-gate writes, drop server timestamp, staleness coast

> **Tier** quick-win · **Focus** Launch-readiness · **Impact** Medium · **Effort** S (hours) · **Priority** 68/100
> **Status** `Not started` · **Depends on** none (complements M4) · **Part of** [Roadmap](./README.md)

## 1. Problem — what we're solving

The phone joystick streams to Realtime Database at ~30 Hz with a **server-resolved timestamp on
every packet**, even when the stick is held perfectly still. Three concrete issues, all verified:

1. **Constant writes while the stick is steady.** `handleJoystickDrag()` in
   `public/js/controller.js:154-159` throttles to `gameConfig.joystickThrottleMs` (= `33` ms,
   `public/js/config.js:90`, "~30Hz") but does **not** compare the new vector to the last one — a
   held stick still fires `sendJoystickInput()` ~30×/sec. Each call hits
   `sessionManager.realtimeRef.update({...})` (`controller.js:543-546`). At
   `gameConfig.maxPlayers` (currently `3`, `config.js:102`, designed to scale to `6`) that is
   **90 sustained RTDB writes/sec, up to 180 at six players** — RTDB write volume is the main
   Firebase cost/throughput driver for this app, and most of those writes carry an *unchanged*
   vector.

2. **A server round-trip per packet for a timestamp nobody reads.** Every joystick write sets
   `timestamp: firebase.database.ServerValue.TIMESTAMP` (`controller.js:545`, mp phone init
   `public/js/mp-client.js:139`, desktop init `public/js/network.js:116`). `ServerValue.TIMESTAMP`
   is a sentinel the RTDB server resolves, and on the **host side the timestamp is never read**:
   the value listener in `network.js:128-145` and the per-slot router
   `mpHandleControllerNode()` (`public/js/mp-net.js:163-184`) consume only `connected` and
   `joystick`; nothing inspects `timestamp`. So we pay for ordering metadata we discard.

3. **Out-of-order / stalled input applies a stale heading.** Because the host ignores ordering,
   `handleJoystickInputFromMobile()` (`network.js:336-347`) and `applyPlayerJoystick()`
   (`public/js/mp-engine.js:222-230`) apply *whatever vector arrived last*. A late-delivered older
   packet can overwrite a newer heading. Worse, a brief radio stall leaves the snake **locked on
   its last `targetDirection`**: `joystickToControl()` (`public/js/logic.js:135-145`) returns
   `active:false` only below the 0.1 deadzone, and a stalled stream sends *nothing*, so the snake
   keeps grinding through its last turn — a momentary disconnect reads as "stuck turning into a
   wall" rather than the intuitive "coast straight". The MP disconnect path already documents this
   exact preference ("the snake coasts on its last heading", `mp-net.js:189-191`) but only fires
   when the RTDB child is *removed*, not on a sub-second radio hiccup.

The localStorage fallback mirrors the same shape (`controller.js:548-552` writes
`{ joystick, timestamp: Date.now() }` every throttle tick).

## 2. Why it matters

**Launch-readiness, and the cost ceiling for "pushing for real users."** RTDB bills on write
volume and bandwidth; a steady-stick stream at 30 Hz × N players is the single largest write source
in the product (game-state writes are event-driven only — see `updateGameStateInFirebase()`
`network.js:365-385` and the event-driven mp writes in `mp-net.js`). Cutting held-stick writes to
~zero and removing one server round-trip per packet directly lowers the per-concurrent-session cost
and the chance of hitting RTDB throughput limits during a launch spike — exactly the headroom you
want before inviting real traffic. The staleness-coast change is also a **feel** fix: a flaky phone
network currently turns into an unfair death; coasting straight is the forgiving, expected
behavior and protects the multiplayer experience that M4 is hardening.

## 3. Goals

- A held (unchanging) stick produces **~0 RTDB/localStorage writes** after the initial settle.
- Remove the per-packet server timestamp round-trip; keep a monotonic *client* ordering stamp.
- Host **drops out-of-order packets** per input source (solo stream + each MP slot).
- A stream stall of more than a tunable window (~400 ms) **relaxes `targetDirection` toward the
  current heading**, so a stall reads as "going straight," not "stuck turning."
- All knobs live in `gameConfig` (`config.js`) and are tunable without touching call sites.
- Both transports (Firebase hybrid + localStorage) and both modes (solo engine + MP arena) behave
  consistently. CI stays green (lint + `node --check` + vitest).

## 4. Non-goals

- No change to the joystick→angle/speed math (`joystickToControl()` stays pure and untouched).
- No change to the RTDB node shape or `database.rules.json` (the `timestamp` field is already
  validated as `newData.isNumber()` at `database.rules.json:9,19`, so a client `Date.now()` number
  is rules-compatible and no rules deploy is needed).
- No throttle-rate change (`joystickThrottleMs` stays 33 ms; we gate *whether* we write, not how
  often we sample).
- No new analytics pipeline; at most one lightweight counter routed through the existing
  `trackEvent()`.
- No prediction/interpolation/dead-reckoning of remote input beyond the simple coast relaxation.
- No multiplayer roster/lobby changes.

## 5. Proposed solution

Four small, additive changes. No new files; no new load-order entries.

### 5.1 Change-gate the write (phone) — `controller.js`, `mp-client.js`

Add an epsilon comparison in the **single send path** `sendJoystickInput(x, y)`
(`controller.js:536-553`) so an unchanged vector is dropped before any transport write. Track the
last *sent* vector on `joystickState` (already the home of `lastInputTime`,
`public/js/state.js:95-102`):

- Compute `dx = x - joystickState.lastSentX`, `dy = y - joystickState.lastSentY` (seed
  `lastSentX/Y` to `null` so the first send always goes).
- If `Math.hypot(dx, dy) < gameConfig.joystickEpsilon` **and** this is not a zero-release, return
  without writing.
- **Always** send the `(0,0)` release from `endJoystickDrag()` (`controller.js:162-172`) — gate it
  only against *re-sending* a zero we already sent, so "stick centered" is transmitted exactly once
  and the snake reliably coasts. Update `lastSentX/Y` whenever a write actually goes out.

This lives in `sendJoystickInput`, which **both** the legacy solo phone and the MP phone use (MP
just points `sessionManager.realtimeRef` at the per-slot child in `mp-client.js:135`), so one edit
covers solo + MP + localStorage. Epsilon defaults small (~`0.04`) and is tuned against analog feel
(see §10) so fine heading nudges still register.

### 5.2 Drop the server timestamp; send a client stamp — `controller.js`, `mp-client.js`, `network.js`

Replace `firebase.database.ServerValue.TIMESTAMP` with `Date.now()` in the three joystick-write /
init sites:

- `controller.js:545` (legacy solo joystick write) and `controller.js:360` (legacy connect init).
- `mp-client.js:139` (MP slot init write).
- `network.js:116` (desktop host's own controllers-node seed).

`Date.now()` is a plain number, satisfies the existing `timestamp` rule
(`database.rules.json:9,19`), and removes the server-resolved sentinel round-trip. The localStorage
path already uses `Date.now()` (`controller.js:551`) — now both transports agree. (Clock skew is a
non-issue: the stamp is only ever compared **per source against that same source's previous
stamp**, never across devices.)

### 5.3 Host drops out-of-order input — `network.js`, `mp-net.js`

Stamp-gate on the host so a late older packet can't overwrite a newer heading:

- **Solo:** in `handleJoystickInputFromMobile()` (`network.js:336-347`), read `joystickInput.ts`
  (or the node's `timestamp`); if it is `<=` the last applied solo stamp, ignore. Store the last
  stamp on `sessionManager` (e.g. `sessionManager.lastJoystickUpdate`, which already exists as a
  field at `state.js:65` but is currently unused).
- **MP:** in `mpHandleControllerNode()` (`mp-net.js:163-184`), keep a per-slot last-stamp map
  (e.g. extend `mpSession` with `stamps: {}` in `state.js:73-79`); skip applying a slot's input
  when its `timestamp` is not strictly newer. This is also where the **staleness coast** hooks in
  (§5.4).

The host already reads the node every RTDB `value` event; we only add the comparison, so no extra
listener and no extra reads.

### 5.4 Staleness coast — `mp-engine.js`, `network.js`, `config.js`

When a source's most recent input is older than `gameConfig.inputStaleMs` (~`400`), relax its
`targetDirection` toward its current `direction` so a stall coasts straight instead of grinding a
turn:

- The cleanest seam is the **per-frame direction step** that already runs every rAF:
  `updatePlayerDirection()` (`mp-engine.js:61-66`) for MP and the solo
  `updateSnakeDirection()` (`game.js`, around `game.js:124-130`, which calls `speedToTurnStep` /
  `stepDirection`). Before computing the turn, if `Date.now() - lastInputTs(source) > inputStaleMs`,
  set `targetDirection = direction` (snap the *target*, not the heading — `stepDirection` then has
  nothing to turn toward, so the snake holds its line). This reuses the existing turn machinery; no
  new movement code.
- Source-of-truth for "last input at": the per-slot stamp map from §5.3 (MP) and
  `sessionManager.lastJoystickUpdate` (solo). On a *fresh* input the stamp updates and the coast
  releases automatically — no explicit re-arm needed.

This generalizes the existing "coast on disconnect" intent (`mp-net.js:189-191`) from "child
removed" to "input gone quiet," covering the sub-second radio hiccup that doesn't trip
`onDisconnect`.

### 5.5 New tunables — `config.js`

Add to `gameConfig` next to the existing `joystickThrottleMs` (`config.js:89-91`), keeping the
"Optimization settings" grouping:

```
joystickEpsilon: 0.04,  // min |Δ vector| before the phone re-sends (held stick → ~0 writes)
inputStaleMs: 400,      // host: relax targetDirection toward heading after this input gap
```

`gameConfig` is already an eslint global (`.eslintrc.json:38`); adding object *keys* needs no
globals change.

## 6. Acceptance criteria

- [ ] **Given** the joystick is held at a fixed non-zero position, **when** drag events keep
      firing at 30 Hz, **then** `sendJoystickInput` performs **at most one** transport write after
      the position settles (verified by spying on the write in a jsdom test / counting
      localStorage writes).
- [ ] **Given** the stick is released, **when** `endJoystickDrag` runs, **then** exactly one
      `(0,0)` packet is sent and the snake coasts at base speed (existing protocol-test assertion
      at `tests/protocol.test.js:130-134` still passes).
- [ ] **Given** two distinct stick positions differing by **less than** `joystickEpsilon`, **then**
      the second is **not** sent; **given** a delta **at or above** epsilon, the second **is** sent.
- [ ] No joystick write (hybrid or localStorage) contains `ServerValue.TIMESTAMP`; the `timestamp`
      field, when present, is a finite number equal to a client `Date.now()` (grep shows zero
      `ServerValue.TIMESTAMP` left in `controller.js`, `mp-client.js`, `network.js`).
- [ ] **Given** the host applied a packet stamped `T`, **when** a packet stamped `< T` arrives for
      the same source, **then** the host does **not** change `targetDirection`/`currentSpeed` for
      that source (unit/protocol assertion).
- [ ] **Given** no fresh input for more than `inputStaleMs`, **when** the next frame steps, **then**
      that source's `targetDirection` equals its current `direction` (snake holds a straight line);
      **when** a fresh input then arrives, the coast releases on that same input.
- [ ] Negative: the staleness coast never *moves the head* on its own and never changes
      `currentSpeed` away from the value the last real input set (it only neutralizes the turn
      target).
- [ ] `database.rules.json` is **unchanged** (no rules deploy required); the change works against
      the deployed `timestamp` `isNumber()` validator.
- [ ] Guardrails: `npm run lint` clean (no new `no-undef`), `node --check` passes on all touched
      files, `vitest run` green. `.eslintrc.json` globals updated **only if** a new top-level
      function/`let`/`const` is introduced (object keys on `gameConfig`/`mpSession` do **not**
      require it). No 6-digit session code or PII logged in any new `debugLog`/`trackEvent`.
- [ ] `sw.js` `CACHE` bumped (changed shell JS: `controller.js`, `mp-client.js`, `mp-net.js`,
      `mp-engine.js`, `network.js`, `config.js` are all SW-cached assets).

## 7. Affected files

| File | Change |
| --- | --- |
| `public/js/config.js` | Add `joystickEpsilon` + `inputStaleMs` to `gameConfig` (Optimization settings block). |
| `public/js/controller.js` | Change-gate in `sendJoystickInput`; track `lastSentX/Y` (+ on `joystickState`); always-send the single release in `endJoystickDrag`; swap `ServerValue.TIMESTAMP` → `Date.now()` at the two write sites. |
| `public/js/mp-client.js` | Swap `ServerValue.TIMESTAMP` → `Date.now()` in the MP slot init write (`:139`). |
| `public/js/network.js` | Host out-of-order drop in `handleJoystickInputFromMobile` (solo); swap `ServerValue.TIMESTAMP` → `Date.now()` in the host node seed (`:116`); store last solo stamp on `sessionManager.lastJoystickUpdate`. |
| `public/js/mp-net.js` | Per-slot stamp tracking + out-of-order drop in `mpHandleControllerNode`. |
| `public/js/mp-engine.js` | Staleness coast in `updatePlayerDirection` (MP); solo coast in `game.js` `updateSnakeDirection`. |
| `public/js/game.js` | Solo staleness coast in `updateSnakeDirection` (relax `targetDirection` toward `direction`). |
| `public/js/state.js` | Add `lastSentX/lastSentY` to `joystickState`; add `stamps: {}` (per-slot) to `mpSession` (literals only — keeps test-clean load). |
| `public/sw.js` | **Bump `const CACHE`** (shell JS changed). |
| `.eslintrc.json` | **Only if** a new top-level helper is added (e.g. a shared `shouldSendJoystick()` in logic.js) — then add it to `globals`. Object keys on existing globals need no change. |
| `tests/logic.test.js` | If a pure helper is added (e.g. epsilon-gate / stale-check), unit-test it here. |
| `tests/protocol.test.js` | Extend the localStorage smoke test: held-stick write count, release-once, out-of-order drop. |

## 8. Dependencies & sequencing

- **Depends on:** none. **Complements M4** (multiplayer hardening) — the staleness coast directly
  improves MP fairness, so landing this before/with M4's MP polish compounds well.
- **Internal order:** (1) add `gameConfig` knobs → (2) phone change-gate + timestamp swap (pure
  client win, shippable alone) → (3) host out-of-order drop → (4) staleness coast (depends on the
  per-source stamps from step 3). Steps 2 and 3–4 are independently revertable.
- No coordination with Firestore/RTDB **rules** (unchanged), so no scratch-project rules pre-flight
  is required for this change.

## 9. Risks & mitigations

- **Epsilon too large → laggy/notchy analog feel.** Mitigation: default conservative (`0.04` of the
  normalized [-1,1] range), tune via Claude_Preview drag test (§10); the value is a one-line
  `config.js` knob so tuning never touches call sites.
- **Change-gate swallows the release.** Mitigation: `endJoystickDrag` always emits the single
  `(0,0)` (gated only against duplicate zeros); covered by an explicit acceptance criterion and the
  existing `protocol.test.js:130-134` coast assertion.
- **Coast snaps a legitimately slow-but-alive turn straight.** Mitigation: `inputStaleMs` (~400 ms)
  is far longer than the 33 ms sample interval, so it only fires on a real stall, not normal play;
  fresh input releases it next frame.
- **Clock issues with `Date.now()` ordering.** Mitigation: comparisons are **per-source vs its own
  previous stamp** only (never cross-device), so device clock skew is irrelevant; a single source's
  `Date.now()` is monotonic enough at 30 Hz.
- **Stamp absent on legacy cached phones.** Mitigation: treat a missing stamp as "always newer"
  (don't drop) so old phones that send no/zeroed stamp keep working — degrade soft, exactly like
  the existing legacy-flat-shape handling in `network.js:128-145`.
- **SW serves stale JS after deploy.** Mitigation: bump `CACHE` (criterion in §6); network-first SW
  means online users get fresh code on next load.

## 10. Verification / test plan

No local Node — CI-bound. Prove it with the existing harnesses:

1. **Vitest pure-logic (`tests/logic.test.js`).** If the gate/stale check is extracted as a pure
   helper (recommended — mirrors `joystickToControl`), unit-test: equal vector → no send; sub/at/
   above-epsilon deltas; stale check across the `inputStaleMs` boundary; missing-stamp → "newer."
2. **Vitest protocol smoke (`tests/protocol.test.js`).** This jsdom harness already drives
   `sendJoystickInput` over the localStorage bridge. Add: (a) hold a fixed vector across many
   `sendJoystickInput` calls and assert the mirrored `session_<code>_joystick` write count is 1
   after settle; (b) assert the `(0,0)` release still round-trips the coast (extends the existing
   `:130-134` block); (c) feed an out-of-order stamp and assert `gameState.targetDirection`
   doesn't regress. The harness's `bridgeStorage` makes writes observable per call.
3. **Lint + syntax:** `npm run lint` and `node --check` on every touched file (CI runs both, both
   blocking).
4. **Manual analog feel (Claude_Preview):** `python -m http.server` over `public/`, open the
   desktop view + `?session=123456` controller view, **unregister the SW + clear caches** first.
   Drag the joystick slowly and confirm heading still tracks finely at the chosen epsilon; hold
   steady and confirm input stops updating; kill the controller tab mid-round and confirm the snake
   coasts straight (not stuck turning) after ~400 ms. Screenshots may time out — assert via
   `preview_eval` reading `gameState.targetDirection` / a write counter instead.
5. **No production rules deploy needed** (rules unchanged); if anyone *does* touch
   `database.rules.json`, validate on a scratch Firebase project per `.agent/workflows/deploy.md` —
   not against prod.

## 11. Analytics & observability

Keep it light and route everything through the hardened `trackEvent()` (`utils.js`), which no-ops
offline and auto-tags `device_role` — **never log the 6-digit code or PII**.

- Optional, **sampled** counter `joystick_coast` (params: `{ mode: 'solo'|'multi' }`) fired at most
  once per stall episode from the staleness-coast path, to confirm coasts happen at a sane rate in
  the wild (a spike would flag flaky-network sessions). Gate behind a per-episode flag so it can't
  fire per-frame.
- Primary success signal is **observed RTDB write volume / month** in the Firebase console
  (Realtime Database → Usage): expect held-stick writes to collapse toward zero and total joystick
  writes to drop sharply at 2-3 players. No code needed — it's the existing billing/usage metric
  this initiative targets.
- Reuse `debugLog()` (gated behind `DEBUG`, `utils.js`) for any dev-only "dropped stale packet" /
  "coasting" chatter; never `console.log` in the hot path.
