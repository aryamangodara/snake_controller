# M4 · Per-slot RTDB listeners + namespace separation (the more-players unlock)

> **Tier** medium · **Focus** Launch-readiness · **Impact** High · **Effort** M (1-2 days) · **Priority** 74/100
> **Status** `Not started` · **Depends on** M6 (MP tests) · **Part of** [Roadmap](./README.md)

## 1. Problem — what we're solving

The desktop host watches the **entire** controller node with a single value listener and the host
also **writes its own bookkeeping at that same parent path**, mixing two incompatible shapes. Three
concrete defects fall out of this, all verified in the tree:

**(a) O(N²) input fan-out.** `network.js:128` attaches `sessionManager.realtimeRef.on('value', …)`
to `controllers/{code}` — the parent. Every phone throttles a joystick write at
`gameConfig.joystickThrottleMs` (≈30–33 Hz; `controller.js:156`, `mp-client.js` writes per-slot
at `controllers/{code}/{slot}`). A value listener on the parent fires **once per write from any
phone**, and each callback delivers the **full node** (`snapshot.val()` at `network.js:129`). The
handler then loops over **all** slots and re-applies each one (`mpHandleControllerNode`,
`mp-net.js:163-184` iterates `for (const slot of PLAYER_SLOTS)` and calls `applyPlayerJoystick`
for every connected slot on every callback). So with N phones the host processes ≈N writes/frame ×
N slots = **O(N²) per-frame CPU**, and every write ships the whole node over the wire instead of
just the one stick that moved. This is the dominant reason `gameConfig.maxPlayers` is pinned at 3
(`config.js:102`, with a comment that raising it "is a one-line change" — but the listener cost is
the hidden blocker).

**(b) Legacy flat shape double-drives the solo snake.** The host's parent listener handles **two
shapes on the same node**: the legacy flat shape (`{connected, joystick, …}`) at `network.js:130-140`
calls `handleJoystickInputFromMobile()` → steers the **solo** snake; the per-slot children at
`network.js:142-144` call `mpHandleControllerNode()` → steers **arena** snakes. A stale/legacy phone
(old cached build) that writes the flat shape (`controller.js:356-361`) therefore drives the solo
snake **even in a `mode==='multi'` session**, on top of whatever the arena slots are doing. The
schema doc already flags this exact failure as the accepted "Stale-client RTDB clobber" risk
(`.agent/system/firebase_schema.md:98-101`). The host code makes no attempt to ignore the flat
shape when the round is multiplayer.

**(c) Parent-level `onDisconnect().remove()` can wipe every live slot.** The host registers
`sessionManager.realtimeRef.onDisconnect().remove()` on the **parent** `controllers/{code}` node
(`network.js:123`). If the host's socket merely blips, the RTDB server fires that onDisconnect and
**removes the whole node — including every phone's live `{slot}` child**, mass-disconnecting all
players at once. The host also seeds flat fields at the parent on create (`network.js:113-118`:
`connected/joystick/timestamp/initialized`), so the host's own write and the phones' per-slot
writes share one parent, which is what makes the parent-level onDisconnect so destructive.

## 2. Why it matters

This is squarely a **Launch-readiness** item and the literal unlock for "more players". Multiplayer
is the headline growth feature, but it is throttled to 3 by an O(N²) host loop that no amount of
board-size tuning fixes. Switching to per-child listeners makes host input cost **O(1) per write**
(each phone's move wakes only its own handler and carries only its own stick), which is the
prerequisite for ever raising `gameConfig.maxPlayers` to 4–6 — directly enabling bigger, more
viral "last snake standing" lobbies when we push for real users. It also closes two correctness
bugs that produce *visible wrongness* in front of new players: a ghost solo snake fighting the
arena (b), and an entire lobby getting kicked because the host's wifi hiccuped (c). Fixing these
before traffic arrives is cheaper than debugging them from analytics after.

## 3. Goals

- Host attaches **per-child** RTDB listeners (`child_added` / `child_changed` / `child_removed`)
  on `controllers/{code}` so each joystick write wakes **only that slot's** handler and crosses the
  wire as **only that slot's** payload — O(1) per write, independent of player count.
- Host bookkeeping (the flat `connected/initialized/timestamp` seed) moves **off the parent** to a
  reserved child (e.g. `controllers/{code}/_host`), so the parent node holds **only** per-slot
  children + the host child.
- `onDisconnect().remove()` targets **only** `controllers/{code}/_host`, never the parent, so a host
  blip can never remove a live player's slot child.
- When `gameState.mode === 'multi'`, the host **ignores the parent-level flat shape entirely**, so a
  legacy/stale phone writing the flat shape can no longer double-drive the solo snake.
- The legacy **solo** path (1-player rounds and old cached desktops) and the **localStorage
  fallback** path keep working unchanged.
- No regression to the existing per-slot liveness reconciliation (`mpOnControllerLive` /
  `mpOnControllerGone`, lobby join/leave analytics).

## 4. Non-goals

- **Raising `gameConfig.maxPlayers`.** This change *unblocks* the raise; the actual bump (and the
  board-size/wall-margin tuning the `config.js:100-101` comment calls for) is a separate follow-up.
- Changing `database.rules.json` validation shape (it already accepts `p[1-6]` slot children and a
  `$slot` wildcard; a reserved `_host` child needs a rules tweak — see §7, but no change to the
  joystick validation itself).
- Changing the **phone** write path. Phones already write per-slot (`mp-client.js:135-141`); only
  the host's read/bookkeeping side changes.
- Migrating the legacy solo RTDB layout. The flat shape stays valid for old cached **desktops** that
  still write/read it; we only stop the **multiplayer host** from *consuming* it.
- Firestore listener changes (the doc `onSnapshot` in `network.js:149` and `mpHandleDocSnapshot` are
  untouched).

## 5. Proposed solution

**Split the host RTDB wiring in `network.js:108-145` into three per-child handlers + a host child.**

1. **Host child for bookkeeping.** Replace the parent `set()` seed (`network.js:113-118`) with a
   write to `sessionManager.realtimeRef.child('_host')` carrying `{connected:false, initialized:true,
   timestamp}`. Keep the existing `sessionManager.realtimeRef` pointing at the parent (it is reused
   for `.off()` cleanup and `.remove()` on `beforeunload`, `network.js:407-419`), and add a new
   `sessionManager.hostRef = sessionManager.realtimeRef.child('_host')` for the onDisconnect target.

2. **Targeted onDisconnect.** Replace `sessionManager.realtimeRef.onDisconnect().remove()`
   (`network.js:123`) with `sessionManager.hostRef.onDisconnect().remove()`. A host blip now removes
   only `_host`, never a player's slot child. (The `beforeunload` parent `.remove()` at
   `network.js:418` stays — that is a deliberate, full teardown when the host genuinely leaves.)

3. **Per-child listeners replace the value listener.** Replace the single `.on('value', …)`
   (`network.js:128-145`) with three handlers on the parent ref, each filtering to slot children:

   - `child_added` / `child_changed`: if the key matches `^p[1-6]$`, route it. Reuse the existing
     per-slot logic by refactoring `mpHandleControllerNode` (`mp-net.js:163-184`) into a new
     **single-slot** entry point `mpHandleControllerChild(slot, childData)` that does exactly what
     the loop body does today for one slot (apply input via `applyPlayerJoystick` in multi or
     `handleJoystickInputFromMobile` in a 1-player round; add to `mpSession.live` + fire
     `mpOnControllerLive` on first appearance). Keep `mpHandleControllerNode` as a thin wrapper that
     loops and calls the new per-slot function, so the localStorage/legacy callers and any test that
     references it still work.
   - `child_removed`: if the key matches `^p[1-6]$`, run the "slot gone" branch
     (`mp-net.js:179-182`: `mpSession.live.delete(slot)` + `mpOnControllerGone(slot)`). Because RTDB
     fires `child_removed` exactly when a phone's `onDisconnect().remove()` (`mp-client.js:141`) or
     `pagehide` cleanup (`mp-client.js:192-196`) runs, liveness reconciliation gets *more* precise,
     not less — no more polling the whole node to notice an absence.
   - Ignore the `_host` child and the legacy flat keys (`connected`, `joystick`, `timestamp`,
     `initialized`) in all three handlers (key is not `^p[1-6]$`).

4. **Solo / legacy-host path.** The legacy **single-phone** connection still works because: a legacy
   *phone* against a **new** host writes its slot child only after claiming (`mp-client.js`), so it
   is handled by the per-child path; a legacy *desktop* (old cached host) is unaffected — it runs the
   old `network.js` entirely. The only behavior we *remove* is the new host consuming the
   parent-level **flat** shape — which only a stale phone writes, and which we explicitly want gone
   in multiplayer (Goal 4). For a true 1-player round the lone phone still has a slot child
   (`mp-client.js` claims `p1`), so `mpHandleControllerChild('p1', …)` drives the solo snake via the
   `gameState.mode !== 'multi'` branch (mirrors `mp-net.js:171-173`).

5. **Both transports.** The **localStorage fallback** (`network.js:212-247`,
   `setupLocalStorageSession`) is single-device and never used the RTDB parent listener — it is
   untouched. Only the **hybrid** Firebase path changes.

6. **Both modes.** In a 1-player round `gameState.mode` stays `'solo'`; `mpHandleControllerChild`
   keeps the existing `mode`-branch (`mp-net.js:169-174`) so the lone phone drives the classic solo
   engine. In a 2+ round `mode === 'multi'` and each child routes to `applyPlayerJoystick`.

Reuse existing helpers throughout: `debugLog()` for the gone/live chatter (already in
`mp-net.js:188,205`), `trackEvent()` for lobby join/leave (already in `mp-net.js:200,210`),
`mpDocRef()` for roster reconciliation writes, and `PLAYER_SLOTS` / the `^p[1-6]$` shape already
used in rules (`database.rules.json:17`) and `createPlayer` (`players.js:40`).

## 6. Acceptance criteria

- [ ] **Given** a `mode:'multi'` host with 2 connected phones, **when** phone p1 sends a joystick
      update, **then** only p1's handler runs and `applyPlayerJoystick('p2', …)` is **not** called
      for that event (verified by spy/instrumentation in a jsdom test or a mock-RTDB unit test).
- [ ] **Given** a `mode:'multi'` round in progress, **when** a stale phone writes the **legacy flat
      shape** to the parent `controllers/{code}` node, **then** `handleJoystickInputFromMobile()` is
      **not** invoked and the solo snake does **not** move (negative case for defect (b)).
- [ ] **Given** the host child seed, **when** the session is created, **then**
      `controllers/{code}/_host` holds the host bookkeeping and the **parent** node contains no flat
      `joystick`/`connected` fields written by the host.
- [ ] **Given** the host registers onDisconnect, **when** inspected, **then** `onDisconnect().remove()`
      is attached to `controllers/{code}/_host`, **not** to the parent, so a host disconnect leaves
      existing `p1..pN` slot children intact (defect (c) closed).
- [ ] **Given** a connected phone in slot p2, **when** its slot child is removed (onDisconnect /
      pagehide), **then** the host fires `child_removed`, runs `mpOnControllerGone('p2')`, removes
      p2 from `mpSession.live`, and emits the `mp_lobby_leave` event exactly once.
- [ ] **Given** a phone (re)appears in slot p3, **when** the host fires `child_added`/`child_changed`,
      **then** `mpSession.live` gains `p3` and `mpOnControllerLive('p3')` fires exactly once (not on
      every subsequent joystick update).
- [ ] **Given** a 1-player round (`mode:'solo'`, one phone claimed p1), **when** the phone steers,
      **then** the classic solo snake moves via the `mode !== 'multi'` branch (no arena regression).
- [ ] `mpHandleControllerNode` still exists as a working wrapper (no broken external callers); the
      new `mpHandleControllerChild` is added.
- [ ] **localStorage fallback** path is byte-unchanged in behavior: `tests/protocol.test.js` passes
      untouched.
- [ ] **Guardrails:** `.eslintrc.json` `globals` updated for every new/renamed top-level
      declaration (new `mpHandleControllerChild`, any new `sessionManager.hostRef` is a property not
      a global so no entry needed; confirm no others). `npm run lint` clean, `node --check` passes on
      every touched file, `npm test` (Vitest incl. the jsdom protocol test) green.
- [ ] **No PII / no 6-digit code** is logged in any new `debugLog`/`trackEvent` (slot ids and counts
      only, matching `mp-net.js:200,210`).
- [ ] `database.rules.json` accepts the `_host` child (validates `{connected,initialized,timestamp}`)
      and still **rejects** unknown keys under `controllers/{code}`; rules change tested on a scratch
      Firebase project before merge (never hand-edited in console).

## 7. Affected files

| File | Change |
|------|--------|
| `public/js/network.js` | Replace parent value listener (`:128-145`) with `child_added`/`child_changed`/`child_removed` handlers; move host seed to `controllers/{code}/_host` (`:113-118`); retarget `onDisconnect().remove()` to `_host` (`:123`); add `sessionManager.hostRef`. |
| `public/js/mp-net.js` | Extract `mpHandleControllerChild(slot, childData)` from the loop body of `mpHandleControllerNode` (`:163-184`); keep `mpHandleControllerNode` as a wrapper. |
| `public/js/mp-client.js` | No functional change expected (phones already write per-slot, `:135-141`). Verify the `_host` child does not collide with the phone's slot claim; touch only if a shared constant is introduced. |
| `database.rules.json` | **Rules bump (CI-deployed).** Add a `_host` child validator under `controllers/{$sessionId}` (`{connected:bool, initialized:bool, timestamp:number}`), keeping the `$slot` `^p[1-6]$` wildcard and `$other:false` denial intact. |
| `.eslintrc.json` | **globals bump** — add `mpHandleControllerChild` (and any other new top-level fn). `sessionManager.hostRef` is a property, not a global. |
| `.agent/system/firebase_schema.md` | Doc update: note host bookkeeping now lives at `controllers/{code}/_host`, onDisconnect targets `_host`, and the multiplayer host ignores the legacy flat shape (revise the "Stale-client RTDB clobber" accepted-risk note `:98-101`). |

> **sw.js `CACHE` bump:** required — `network.js` / `mp-net.js` are shell assets the SW caches; bump
> `const CACHE` in `public/sw.js` so installed clients pick up the new host logic on next reload.

## 8. Dependencies & sequencing

- **Depends on M6 (multiplayer tests).** This is a behavioral refactor of the host's hottest input
  path with three correctness fixes folded in; landing it on top of an MP regression suite means the
  per-slot routing, liveness reconciliation, and "ignore flat shape" cases are pinned by tests
  before they change. Without M6 the only safety net is the solo `tests/protocol.test.js`.
- **Blocks raising `gameConfig.maxPlayers`.** The O(N²) host loop is the practical cap; this change
  must land **before** the cap is bumped to 4–6 (which is its own follow-up incl. board-size tuning,
  `config.js:100-101`).
- Independent of any Firestore-side work; the Firestore doc listener is untouched.

## 9. Risks & mitigations

- **Global-scope / load-order minefield.** New `mpHandleControllerChild` must be declared in
  `mp-net.js` (loaded after `network.js`), and `network.js` reaches it through a `typeof`-guarded
  hook exactly like the existing `typeof mpHandleControllerNode === 'function'` check
  (`network.js:142`). *Mitigation:* keep the same `typeof`-guard pattern; do not call the new
  function directly from `network.js` without the guard. Update `.eslintrc.json` `globals` in the
  same commit (CI fails otherwise — the feature).
- **`child_*` event semantics differ from `value`.** `child_added` fires for every existing child at
  attach time *and* for new ones; `child_changed` for in-place updates. *Mitigation:* both route
  through the same per-slot apply; the `wasLive`/`mpSession.live` gate (`mp-net.js:166,175`) already
  makes `mpOnControllerLive` idempotent, so a child_added on an already-live slot is a no-op beyond
  re-applying input.
- **Reserved-key collision.** `_host` must never be mistaken for a slot. *Mitigation:* all three
  handlers filter on `^p[1-6]$`; `_host` fails that test and is ignored. Slots are always `p…`
  (`players.js:24-27`), so the namespaces are disjoint by construction.
- **Rules rollout ordering.** If the `_host` child write deploys before the rules accept it, the host
  seed write is rejected. *Mitigation:* CI deploys hosting + rules **together** in one push, so the
  new code and the rule that permits its write ship atomically; still validate on a scratch project
  first.
- **Stale installed SW serving old `network.js`.** An already-installed network-first SW needs one
  reload post-deploy. *Mitigation:* bump `const CACHE` in `sw.js` (see §7).
- **Old cached desktop hosts.** They keep the parent value listener and the flat shape — *not
  changed by this PR* and still functional; the fix only governs **new** hosts. Acceptable: the SW
  is network-first so online hosts refresh within one reload.

## 10. Verification / test plan

Given no local Node (CI-bound) and a Firebase backend, prove correctness in four layers:

1. **Vitest (jsdom, no Firebase) — the primary gate.** Extend the M6 MP suite (or add a sibling to
   `tests/protocol.test.js`) using the same `vm.runInContext` two-window harness
   (`tests/protocol.test.js:32-46`). Inject a **mock RTDB ref** whose `.on('child_added'|…)` records
   listeners, then synthesize child events and assert: (a) a p1 child event does **not** trigger p2
   routing (O(1) proof); (b) a parent-level flat write while `mode==='multi'` does **not** call
   `handleJoystickInputFromMobile`; (c) `child_removed` fires `mpOnControllerGone` once; (d) the host
   seed lands at `_host` and onDisconnect targets `_host`. These are pure-logic assertions — no
   network.
2. **`npm run lint` + `node --check`.** Confirms the `.eslintrc.json` globals list is in sync (the
   intentional CI failure if a new top-level fn is undeclared) and every touched file parses.
3. **Rules on a scratch Firebase project** (`.agent/workflows/deploy.md`): deploy `database.rules.json`
   to a throwaway project and assert with the emulator/SDK that (a) a valid `_host` child write is
   accepted, (b) a `p1` slot child write is still accepted, (c) an unknown key under
   `controllers/{code}` is still rejected. **Never** deploy rules by hand against production.
4. **Live smoke via local server.** `python -m http.server` over `public/`, **unregister the SW +
   clear caches** (network-first SW serves stale assets locally), open the desktop host and two
   `?session=` controller tabs, and confirm in the RTDB console that the parent node holds only
   `_host` + `p…` children, that pulling one phone removes only its child, and that two phones steer
   independently. Claude_Preview eval can read DOM/console state (screenshots time out).

## 11. Analytics & observability

- Keep the existing per-slot lobby funnel events emitting from the new code path with **unchanged
  shape**: `mp_lobby_join` (`mp-net.js:210`, params `{slot, players}`) on `child_added`-driven
  `mpOnControllerLive`, and `mp_lobby_leave` (`mp-net.js:200`, params `{players}`) on
  `child_removed`-driven `mpOnControllerGone`. Route everything through `trackEvent()` (no-ops
  offline, never throws) — **no new event needed** for the refactor itself.
- **Watch after deploy:** the rate of `mp_lobby_leave` immediately following host reconnects should
  **drop** (defect (c): host blips no longer mass-evict players). If it does not, the `_host`
  onDisconnect retarget did not take. No new metric required — compare `mp_lobby_leave` volume
  pre/post deploy.
- **Never log** the 6-digit session code or any name/PII in the new handlers; emit slot ids and
  counts only, matching the existing events.
