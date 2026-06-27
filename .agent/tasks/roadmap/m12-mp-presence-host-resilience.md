# M12 · Multiplayer presence & host-resilience robustness fixes

> **Tier** medium · **Focus** Launch-readiness · **Impact** Medium · **Effort** M · **Priority** 46/100
> **Status** `Not started` · **Depends on** best alongside/after M4; M6 de-risks it · **Part of** [Roadmap](./README.md)

## 1. Problem — what we're solving

Four netcode footguns in the multiplayer presence/host layer, each verified in the tree. They are
benign at 2 players on good wifi but get steadily worse as lobbies grow and connections flake — the
exact conditions "more real users" creates.

**(a) Non-atomic slot bring-up leaves a ghost roster entry.** A phone claims its slot in two
*separate* steps: first the Firestore roster write inside the claim transaction
(`mp-client.js:50-60`, `claimSlot`), then — only after the transaction resolves — the RTDB child
`set()` and its `onDisconnect().remove()` (`mp-client.js:135-141`, inside `mpTryJoin`). If the phone
drops in the window **between** those two writes (transaction committed, RTDB `set` not yet reached,
or reached but `onDisconnect().remove()` at `mp-client.js:141` not yet registered), the Firestore
roster carries a `players.{slot}` entry that **no live RTDB child backs and no onDisconnect will ever
reap**. The host only reaps a roster entry when it observes the RTDB child *go away* after having
seen it live (`mpOnControllerGone`, `mp-net.js:187-201`, gated on `wasLive` at
`mp-net.js:166,179`) — a child that never appeared never triggers a reap, so the ghost sits in the
lobby forever (occupying a slot, inflating `mpRosterSlots().length`, `mp-net.js:15-17`).

**(b) Mid-round reconnect re-flags an eliminated snake as connected.** When a slot's RTDB child
reappears, `mpOnControllerLive` (`mp-net.js:204-211`) unconditionally writes
`players.{slot}.connected = true` if the roster shows `connected === false`. It does **not** consult
`alive`. So a player who was already **eliminated** mid-round (`eliminatePlayer` set
`players.{slot}.alive = false` via `mpSyncElimination`, `mp-net.js:83-98`) and then refreshes their
phone gets re-marked `connected: true` while still dead — the lobby/scoreboard UI
(`renderMpLobby` / `updateMpScoreboard`, driven from `mpUiHook`) then shows a defeated player as an
active, connected participant. The phone side compounds this: `claimSlot` deliberately bypasses the
lobby-only rule on rejoin (`mp-client.js:37-48`) and re-`set()`s its RTDB child with
`connected: true` (`mp-client.js:136-140`) regardless of whether its snake is still alive.

**(c) A silently-gone host freezes every phone with no timeout.** The host advertises
`onDisconnect().remove()` on its RTDB ref (`network.js:123`) and best-effort-deletes the Firestore
doc on `beforeunload` (`network.js:416-423`). But a laptop that **sleeps** or loses wifi without
firing `beforeunload` leaves the Firestore session doc intact and frozen at
`gameState.state === PLAYING`. The phone's only listener is the Firestore `onSnapshot`
(`mp-client.js:81-86`, `mpPhoneSnapshot`); with no further writes there is **no snapshot, no error,
and no timeout** — the controller UI sits live forever with a dead host. Nothing on the phone watches
`lastActivity` (written on every host state change, e.g. `mp-net.js:63,78,96,111`) to notice the
silence.

**(d) Per-slot action clearing is a non-idempotent second write.** A phone's start/restart is
written to `gameActions.{slot}` (`controller.js:565`); the host handles it and then issues a
**separate** clearing write (`mpHandleDocSnapshot`, `mp-net.js:142-153`, setting
`gameActions.{slot} = null`). The handler `mpHandleAction` (`mp-net.js:31-38`) guards on game state
("first start wins" while `WAITING_FOR_START`), which absorbs most double-fires — but the design
still relies on the clear landing promptly. If the clear write is dropped/delayed, the same action
re-arrives on the next snapshot; if two snapshots interleave before the clear commits, the action can
fire twice. There is **no action id and no last-handled-per-slot bookkeeping** — idempotency is
implicit in the state-edge guard, not explicit.

## 2. Why it matters

This is a **Launch-readiness** item: every defect is a "works fine in my 2-player demo, breaks in a
6-player party" failure, and multiplayer is the headline growth/virality feature. As we push for real
users on flaky mobile networks:

- Ghost roster entries (a) silently **consume player capacity** (`gameConfig.maxPlayers`, currently 3,
  `config.js:102`) — a lobby can read "full" with phantom players, blocking real joiners.
- A defeated-then-reconnected player shown as live (b) is **visible wrongness** on the scoreboard in
  front of a room of people.
- A frozen controller after the host's laptop sleeps (c) is the single most likely "the game is
  broken" support report — the phone gives the user *no* signal and *no* recovery path.
- Double-fired start/restart (d) can yank players into a round they didn't expect or restart out from
  under them.

Fixing these before traffic arrives is cheaper than diagnosing them from analytics afterward, and
they compound with M4 (per-slot listeners raise the player cap, which makes every one of these worse
at scale).

## 3. Goals

- **Atomic slot bring-up:** register `onDisconnect().remove()` on the slot RTDB ref **before** the
  `set()`, so any drop in the claim→live window is reaped server-side and never strands a roster
  entry.
- **Host-side roster reconciliation:** the host reaps a `players.{slot}` roster entry that has **no
  live RTDB child for N seconds** (a configurable grace), closing the ghost-entry gap for drops that
  happen before any onDisconnect could attach.
- **Alive-aware reconnect:** on a mid-round RTDB reappearance, only restore `connected: true` if the
  player is **still alive**; an eliminated player's reconnect is treated as spectator/queued, never
  re-activated.
- **Phone host-staleness watchdog:** during `PLAYING`, the phone watches `lastActivity`; if it goes
  stale past a threshold, surface a clear **"Host disconnected"** state (and stop pretending the round
  is live).
- **Explicit action idempotency:** tag each phone action with an id and track the last-handled id
  per slot on the host, so a re-delivered or double-snapshot action **cannot** re-fire — independent
  of whether the clearing write landed.
- The **solo** path, **localStorage fallback**, and **legacy cached clients** keep working unchanged.

## 4. Non-goals

- **True host handoff / host migration.** A dead host stays dead; we only make the phones *notice*
  and message it. Promoting a phone to host is explicitly out of scope.
- **Pausing/resuming a round** for a flaky phone. The "coast and die naturally" policy
  (`mp-net.js:189-192`) stays — last-snake-standing must not stall for one disconnect.
- **Raising `gameConfig.maxPlayers`** (that's the M4 follow-up).
- **Auth / ownership model.** The no-auth design (`firestore.rules:7-15`) is unchanged; reconciliation
  and idempotency are host-local, not rule-enforced.
- Changing the **Firestore action *value* schema** to embed an id (the rules accept only the literal
  strings `'start'`/`'restart'`, `firestore.rules:43-45`). Action idempotency is achieved without a
  rules change where possible — see §5 and §9.

## 5. Proposed solution

Four targeted changes, all preserving the existing typeof-guarded-hook seams (`mpUiHook` /
`mpNetHook`, `mp-engine.js:244-262`) and both-transport / both-mode contracts.

**(a) onDisconnect-before-set in `mpTryJoin` (`mp-client.js:128-161`).** Reorder the RTDB bring-up so
the reaper is armed first:

```
sessionManager.realtimeRef = database.ref('controllers/' + code + '/' + slot);
sessionManager.realtimeRef.onDisconnect().remove();   // arm FIRST
await sessionManager.realtimeRef.set({ connected: true, joystick: {x:0,y:0}, timestamp: … });
```

`onDisconnect()` registers the server-side reaper independently of the data write, so a drop *after*
`onDisconnect()` but *before/at* `set()` is still reaped. This is the same `onDisconnect().remove()`
already used (just moved earlier), so no rules/shape change. The `pagehide` eager-remove
(`mp-client.js:192-196`) stays as the foreground backstop.

**(b) Host roster reconciliation (`mp-net.js`).** Add a host-side sweep that reaps a roster slot whose
RTDB child has been absent for `gameConfig.mpRosterGraceMs`. Track a per-slot "last seen live"
timestamp in `mpSession` (a new `seenAt: {}` map, a plain literal added to the `mpSession` object in
`state.js:73-79`). Update it in `mpHandleControllerNode` (`mp-net.js:163-184`) whenever a slot is
live. A lightweight interval (started once when `mpSession.enabled` becomes true, e.g. in
`mpHandleDocSnapshot`, `mp-net.js:134-138`) checks, for each roster slot **not** in `mpSession.live`
and **not** during `PLAYING`, whether `Date.now() - (seenAt[slot] || joinedAt-ish) > grace`; if so it
runs the existing reap write (`mpDocRef().update({ ['players.'+slot]: …delete() })`, mirroring
`mp-net.js:194-197`). Reuse `debugLog()` and the existing `mp_lobby_leave` event
(`mp-net.js:200`). The interval is cleared on `beforeunload` (extend `network.js:403-424`) so it
never leaks. Grace must exceed the claim→live round-trip; default `mpRosterGraceMs: 8000` in
`config.js` (sits with the other connection settings, `config.js:93-95`).

**(c) Alive-aware reconnect (`mp-net.js:204-211` + `mp-client.js`).** In `mpOnControllerLive`, gate the
`connected: true` restore on the player still being alive **when a round is in progress**:

- If `gameState.currentState === GameState.PLAYING` **and** the roster entry's `alive === false`,
  do **not** restore `connected`; leave it false (the snake already coasted/died, `mp-net.js:189-192`)
  and let the phone fall into the queued/spectator path. Optionally write a `spectator: true`-style
  marker — but to avoid a `firestore.rules` `validPlayer` change (keys are `hasOnly`-locked,
  `firestore.rules:24`), prefer **not** adding a new player field; "eliminated + connected:false" is
  already a sufficient, rules-valid representation of a spectator mid-round.
- Phone side: `claimSlot`'s rejoin branch (`mp-client.js:37-48`) still recovers the slot, but after
  `mpTryJoin` the phone should check `me.alive` from the next snapshot (`mpPhoneSnapshot`,
  `mp-client.js:112-124`) and, if dead mid-round, show the queued UI (`mpUiPhoneQueued`,
  `mp-ui.js:228-232`) instead of an active joystick — reusing the existing `mp-queued` class and
  `mpClient.waiting` flag (`state.js:86`).

**(d) Phone host-staleness watchdog (`mp-client.js` + `mp-ui.js`).** In `mpPhoneSnapshot`
(`mp-client.js:93-125`), capture `d.lastActivity` into a `mpClient.lastHostActivityAt` (new literal on
`mpClient`, `state.js:83-89`) and the local receive time. Start a single interval while
`syncedGameState === PLAYING` that, if `Date.now() - lastReceiveTime > gameConfig.mpHostStaleMs`,
surfaces a **"Host disconnected — waiting to reconnect…"** state via `showConnectionStatus`
(`mp-client.js` already uses it at `:167`) and dims the joystick (reuse the `mp-queued` class,
`mp-ui.js:230`). Recover automatically when fresh snapshots resume. Default
`mpHostStaleMs: 12000` in `config.js`. Use `lastActivity` as the liveness signal because the host
stamps it on *every* state write (`mp-net.js:63,78,96,111`, `network.js:373`), so a healthy host is
never falsely flagged, while a slept host stops bumping it. Emit a `trackEvent('mp_host_stale', …)`
(counts only, no code/PII).

**(e) Action idempotency (`mp-net.js` + `controller.js`).** Two layers, no rules change required:

- **Host-local last-handled tracking (primary).** Add `mpSession.lastAction = {}` (slot → last
  handled marker) in `state.js`. In `mpHandleDocSnapshot` (`mp-net.js:142-153`), before calling
  `mpHandleAction`, compare against `mpSession.lastAction[slot]`; skip if unchanged. Because the
  Firestore action value is restricted to the literal `'start'`/`'restart'` (`firestore.rules:44`),
  the *value* alone is a weak key — but combined with the **state-edge guard already in
  `mpHandleAction`** (`mp-net.js:32-37`: start only fires in `WAITING_FOR_START`, restart only in
  `GAME_OVER`) and a "handled this exact `(slot, action, gameState-edge)` tuple already" check, a
  re-delivered action that arrives after the edge has passed is a guaranteed no-op. This is the
  load-bearing fix and needs **no** schema/rules change.
- **Optional action id (defense in depth, rules-gated).** If we want an explicit id, it cannot live
  *inside* `gameActions.{slot}` (value is string-locked). It could ride a sibling map
  (`gameActionIds.{slot}`) — but that **requires a `firestore.rules` `validShape` key addition**
  (`firestore.rules:58-73`) and a `validGameActions`-style validator, deployed via CI on a scratch
  project first. Treat this as optional; the host-local tracking in the first bullet delivers the
  idempotency guarantee without touching rules. The spec's acceptance criteria below are written
  against the host-local approach.

**Both transports.** The **localStorage fallback** (`network.js:212-247`, `controller.js:568-573`) is
single-device and uses neither the RTDB slot child nor the multiplayer roster; it is untouched. The
host-staleness watchdog and reconciliation are hybrid-only (guarded by `mpSession.enabled` /
`connectionType === 'hybrid'`).

**Both modes.** Solo (1-player) rounds run the classic engine and the lone phone's slot child
(`p1`) still drives it (`mp-net.js:169-173`); reconciliation and the watchdog apply equally (the host
is the host regardless of player count), but the alive-aware reconnect gate is a no-op in solo since
there is no elimination roster to consult.

## 6. Acceptance criteria

- [ ] **Given** a phone claiming a slot, **when** `mpTryJoin` brings up the RTDB child, **then**
      `onDisconnect().remove()` is registered **before** the `set()` resolves (verified by call-order
      assertion in a mock-RTDB unit test).
- [ ] **Given** a phone that commits its Firestore roster entry but drops before its RTDB child ever
      goes live, **when** `gameConfig.mpRosterGraceMs` elapses with the slot absent from
      `mpSession.live` and the session not in `PLAYING`, **then** the host reaps `players.{slot}` and
      the lobby slot count returns to its pre-ghost value (negative case for defect (a)).
- [ ] **Given** roster reconciliation, **when** a slot **is** live in `mpSession.live`, **then** it is
      **never** reaped (no false eviction of a healthy phone).
- [ ] **Given** a `PLAYING` round where slot p2 was eliminated (`players.p2.alive === false`),
      **when** p2's RTDB child reappears, **then** `mpOnControllerLive` does **not** write
      `players.p2.connected = true` and the scoreboard does not show p2 as active (negative case for
      defect (b)).
- [ ] **Given** the same eliminated-then-reconnected p2, **when** the phone resyncs, **then** the
      phone shows the **queued/spectator** UI (`mp-queued` class applied), not a live joystick.
- [ ] **Given** a healthy host during `PLAYING`, **when** it keeps writing state (bumping
      `lastActivity`), **then** the phone **never** shows the "Host disconnected" state (no false
      positive).
- [ ] **Given** a host that goes silent mid-round (no writes), **when** `Date.now() - lastReceive >
      gameConfig.mpHostStaleMs`, **then** the phone surfaces "Host disconnected" via
      `showConnectionStatus` and dims the joystick; **and** when fresh snapshots resume it recovers
      automatically.
- [ ] **Given** a `start` action delivered twice for the same slot in `WAITING_FOR_START`, **when**
      the host processes both snapshots, **then** the round starts **exactly once**
      (`mpStartRound` / `startMultiplayerGame` invoked once), regardless of whether the clearing
      write landed between them.
- [ ] **Given** a `restart` action re-delivered after the round already restarted, **when** the host
      sees it post-edge, **then** it is a no-op (no second restart).
- [ ] **Given** a 1-player solo round, **when** the lone phone steers, reconnects, or restarts,
      **then** behavior is unchanged from today (no arena/alive-gate regression).
- [ ] **localStorage fallback** path is behavior-unchanged: `tests/protocol.test.js` passes untouched.
- [ ] **Guardrails:** `.eslintrc.json` `globals` updated for **every** new top-level declaration (any
      new function in `mp-net.js`/`mp-client.js`; new `mpSession`/`mpClient` *properties* are NOT
      globals and need no entry). `npm run lint` clean, `node --check` passes on every touched file,
      `npm test` (Vitest incl. the jsdom protocol smoke test) green.
- [ ] **No PII / no 6-digit code** logged in any new `debugLog`/`trackEvent` (slot ids + counts only,
      matching `mp-net.js:200,210`).
- [ ] **No `firestore.rules` change** required for the shipped approach (host-local idempotency, no new
      player field, no new top-level action-id map). If the optional action-id map is pursued, the
      rules change is validated on a scratch Firebase project before merge.
- [ ] **`sw.js` `CACHE` bumped** — `mp-net.js`, `mp-client.js`, `network.js`, `config.js`, `state.js`
      are shell assets the SW caches; bump `const CACHE` so installed clients pick up the new logic on
      next reload.

## 7. Affected files

| File | Change |
|------|--------|
| `public/js/mp-client.js` | (a) Move `onDisconnect().remove()` **before** the slot `set()` in `mpTryJoin` (`:135-141`). (c) After join, consult `me.alive` in `mpPhoneSnapshot` (`:112-124`) and route an eliminated reconnect into the queued UI. (d) Capture `lastActivity`/receive time and start the host-staleness watchdog while `PLAYING`. |
| `public/js/mp-net.js` | (b) Add roster reconciliation sweep (interval + per-slot `seenAt` tracking) reaping ghost roster entries; reuse the reap write at `:194-197`. (c) Gate `mpOnControllerLive` (`:204-211`) `connected:true` restore on `alive` during `PLAYING`. (e) Add host-local last-handled-action tracking in `mpHandleDocSnapshot` (`:142-153`) before `mpHandleAction`. |
| `public/js/network.js` | (b/d) Clear the reconciliation/watchdog intervals on `beforeunload` (`:403-424`); no change to the host `onDisconnect` (already correct for the host ref). |
| `public/js/mp-engine.js` | No functional change expected (the engine already drives elimination/connected state via hooks). Touch only if a shared helper is introduced; otherwise leave untouched. |
| `public/js/state.js` | Add inert literals: `mpSession.seenAt = {}`, `mpSession.lastAction = {}` (and any interval handle), `mpClient.lastHostActivityAt`/receive-time fields (`:73-89`). Properties on existing objects — **not** new globals. |
| `public/js/config.js` | Add tunables `mpRosterGraceMs` (≈8000) and `mpHostStaleMs` (≈12000) in the connection-settings block (`:93-95`). |
| `public/js/mp-ui.js` | Reuse `mpUiPhoneQueued` (`:228-232`) / the `mp-queued` class for the eliminated-reconnect and host-stale states; minor copy/string additions only. |
| `.eslintrc.json` | **globals bump** — add any **new top-level function** in `mp-net.js`/`mp-client.js` (e.g. a `mpReconcileRoster`, `mpStartHostWatch`). New object *properties* (`seenAt`, `lastAction`, `lastHostActivityAt`) and new `gameConfig` keys need **no** entry. |
| `public/sw.js` | **`CACHE` bump** required (shell assets changed). |
| `firestore.rules` | **No change** for the shipped approach. *Only* if the optional `gameActionIds.{slot}` map is pursued: add a `validGameActionIds` validator + key to `validShape` (`:58-73`) — CI-deployed, scratch-tested first. |
| `.agent/system/firebase_schema.md` | Doc update: note the ghost-roster reaper, the alive-aware reconnect rule, the host-staleness phone watchdog, and host-local action idempotency. |

## 8. Dependencies & sequencing

- **Best landed alongside/after M4.** M4 (per-slot RTDB `child_*` listeners) reshapes exactly the
  host code this touches (`mpHandleControllerNode` → per-child, `mp-net.js:163-184`) and retargets the
  host `onDisconnect`. Doing M12 on top of M4 means the reconciliation/`seenAt` tracking hooks into
  the cleaner per-child liveness events (`child_removed` is a precise reap trigger) instead of polling
  the whole node. If M12 lands first, it must be re-touched after M4; sequencing M4 → M12 avoids the
  rework.
- **M6 de-risks it.** M6 (multiplayer engine tests) provides the regression suite that pins
  elimination/roster/state-edge behavior before this changes the reconnect and action paths. Land M6
  first so the alive-gate and idempotency cases are testable.
- Independent of the Firestore *rules* (shipped approach needs none); the optional action-id map is the
  only rules-touching variant and is explicitly deferred/optional.

## 9. Risks & mitigations

- **Global-scope / load-order minefield.** Any new top-level function must be declared in the right
  file and reached through the existing `typeof`-guarded hooks (`mpNetHook`/`mpUiHook`,
  `mp-engine.js:255-262`; the `typeof mpHandleControllerNode === 'function'` pattern,
  `network.js:142`). *Mitigation:* keep new functions inside `mp-net.js`/`mp-client.js` (loaded after
  `network.js`); update `.eslintrc.json` `globals` in the **same** commit (CI fails otherwise — the
  feature). Prefer adding **object properties** to `mpSession`/`mpClient` over new top-level `let`s to
  minimize globals churn.
- **Reconciliation false-evicting a healthy-but-slow phone.** A grace that is too short reaps a phone
  whose RTDB child is mid-handshake. *Mitigation:* `mpRosterGraceMs` (≈8 s) comfortably exceeds the
  claim→`set()` round-trip; reconciliation only runs when the slot is **absent from
  `mpSession.live`** (a live child is never reaped) and **not** during `PLAYING` (mirrors the existing
  lobby-only reap, `mp-net.js:193-198`).
- **Host-staleness false positive on a quiet-but-alive round.** If the host legitimately makes no
  writes for a stretch, the phone could mis-flag it. *Mitigation:* the host stamps `lastActivity` on
  every score/elimination/state write (`mp-net.js:63,78,96,111`); a `PLAYING` round produces frequent
  writes. Set `mpHostStaleMs` (≈12 s) well above the longest expected gap and make the state purely
  advisory (dim + message, never disconnect), so a false flag self-heals on the next snapshot.
- **Action-id rules trap.** Embedding an id in `gameActions.{slot}` is impossible (value string-locked,
  `firestore.rules:44`); a sibling id map needs a rules change. *Mitigation:* ship the **host-local**
  last-handled approach (no rules change); treat the id map as optional defense-in-depth, scratch-
  tested before any production rules push.
- **Interval leaks.** New `setInterval`s (reconciliation, watchdog) must be torn down. *Mitigation:*
  store handles on `mpSession`/`mpClient`, clear them in `beforeunload` (`network.js:403-424`) and on
  session end / kick (`mpHandleKicked`, `mp-client.js:164-169`); guard against double-start with a
  null-check (mirrors `desktopStorageListenerAttached`, `network.js:207`).
- **Stale installed SW serving old JS.** Network-first SW still needs one reload post-deploy.
  *Mitigation:* bump `const CACHE` in `sw.js` (see §7).
- **Old cached clients.** A legacy phone/desktop runs the old paths; the new host reconciliation only
  reaps entries with no live child, which a legacy phone (writing its slot child) keeps alive — so no
  regression. The phone watchdog only runs on new phone builds. Acceptable under network-first SW.

## 10. Verification / test plan

Given no local Node (CI-bound) and a Firebase backend, prove correctness in four layers:

1. **Vitest (jsdom, no Firebase) — primary gate.** Extend the M6 MP suite (or add a sibling to
   `tests/protocol.test.js`) using the same `vm.runInContext` harness pattern. Inject a **mock RTDB
   ref** that records `onDisconnect()`/`set()` call order, and a **mock Firestore doc** that records
   `update` payloads, then assert: (a) `onDisconnect().remove()` is recorded **before** `set()`
   resolves in `mpTryJoin`; (b) feeding a roster entry with no matching `mpSession.live` slot and
   advancing fake timers past `mpRosterGraceMs` triggers exactly one `players.{slot}` delete; a live
   slot triggers none; (c) `mpOnControllerLive` for a slot whose roster entry is `alive:false` during
   `PLAYING` does **not** push a `connected:true` update; (d) two identical `start` snapshots invoke
   `startMultiplayerGame` once; (e) the watchdog flips to "stale" after `mpHostStaleMs` of no
   snapshots and clears on a fresh one. Use Vitest fake timers — these are pure-logic assertions, no
   network.
2. **`npm run lint` + `node --check`.** Confirms the `.eslintrc.json` globals list is in sync (the
   intentional CI failure if a new top-level fn is undeclared) and every touched file parses.
3. **Live smoke via local server.** `python -m http.server` over `public/`, **unregister the SW + clear
   caches** (network-first SW serves stale assets locally). Open a desktop host + two `?session=`
   controller tabs. Verify: (a) killing a controller tab *immediately after* it joins (simulating the
   claim→live drop) leaves no permanent ghost in the lobby once grace elapses; (b) eliminating a
   player then reloading its phone mid-round shows it queued/spectating, not active; (c) closing the
   host laptop lid / killing the host tab without `beforeunload` (e.g. `kill -9` the server or use
   Chrome DevTools "offline") makes the phone show "Host disconnected" after the threshold;
   (d) double-tapping start does not double-fire. Claude_Preview eval can read DOM/console state
   (screenshots time out).
4. **Rules (only if the optional action-id map is pursued).** Deploy `firestore.rules` to a **scratch**
   Firebase project (`.agent/workflows/deploy.md`) and assert the new `gameActionIds` map validates and
   unknown keys still reject. **Never** deploy rules by hand against production. For the shipped
   (no-rules-change) approach this layer is N/A.

## 11. Analytics & observability

- **New events (route through `trackEvent()`, no-op offline, never throws; counts/slots only — no code,
  no PII):**
  - `mp_ghost_reaped` `{ players: <roster count after reap> }` — fired by reconciliation when it reaps
    a slot with no live child (defect (a) closing). A nonzero baseline that *drops* as join-window
    drops are eliminated is the success signal.
  - `mp_host_stale` `{ since_ms: <bucketed> }` — fired by the phone watchdog when it flips to the
    host-disconnected state (defect (c) visibility). High volume flags a real host-resilience problem
    in the wild.
  - `mp_reconnect_blocked` `{ slot }` — fired when an eliminated player's reconnect is denied the
    `connected:true` restore (defect (b)).
  - `mp_action_dedup` `{ slot }` — fired when host-local tracking suppresses a re-delivered action
    (defect (d)). Should be rare; a spike indicates clear-write drops worth investigating.
- **Reuse:** keep the existing `mp_lobby_leave` (`mp-net.js:200`) on reconciliation reaps so the lobby
  funnel stays consistent; the new `mp_ghost_reaped` distinguishes *ghost* reaps from genuine leaves.
- **Watch after deploy:** `mp_host_stale` rate (host-resilience health), `mp_ghost_reaped` trending
  toward zero (the onDisconnect-before-set fix should make join-window ghosts rare, leaving
  reconciliation as a backstop), and `mp_action_dedup` staying near zero.
- **Never log** the 6-digit session code or any name/PII in the new handlers — slot ids and counts
  only, matching `mp-net.js:200,210`.
