# B1 · Reduce solo/MP engine duplication + split game.js + CI shape guards

> **Tier** big-bet · **Focus** Launch-readiness / Quality · **Impact** Medium · **Effort** L (multi-day) · **Priority** 42/100
> **Status** `Not started` · **Depends on** M11 (globals check) + M6 (multiplayer engine tests) · **Part of** [Roadmap](./README.md)

## 1. Problem — what we're solving

The solo engine (`public/js/game.js`) and the multiplayer engine (`public/js/mp-engine.js`) carry a
**deliberate, line-for-line duplicated per-actor step**. Any gameplay tuning (combo window, score
formula, speed ramp, head-advance trig, food respawn) must be edited in **two** places or the two
modes silently diverge — and today only the solo path is exercised by a moving-snake test.

Verified twins (read end to end):

- **Head advance + collision** — `moveSnake()` (`public/js/game.js:276-338`) and `movePlayer()`
  (`public/js/mp-engine.js:98-119`) both do the identical head trig:
  `head.x += Math.cos(dir) * speed; head.y += Math.sin(dir) * speed`
  (`game.js:283-284` vs `mp-engine.js:101-102`), then the same `hitsWall` / `hitsSelf`(`hitsSnake`)
  guards. The only real difference is the **side-effect strategy**: solo calls `gameOver()` /
  mutates global `gameState` inline (`game.js:287-298`), while MP **returns an outcome object**
  (`{died, cause, by}` / `{died:false, ate}`) so deaths can be collected and resolved after every
  player moved (`mp-engine.js:104-118`).
- **The eat block** — `moveSnake()`'s food branch (`game.js:305-337`) and `applyFoodEaten()`
  (`mp-engine.js:125-152`) are the same combo/score/speed-ramp math:
  - combo extend-or-reset on `comboWindowMs` — `game.js:311-314` vs `mp-engine.js:129`
  - `multiplier = Math.min(combo, maxCombo)`, `gained = 10 * multiplier`, `score += gained` —
    `game.js:315-317` vs `mp-engine.js:131-133`
  - speed ramp `baseSpeed = Math.min(maxSpeed, baseSpeed + speedIncrease); currentSpeed = baseSpeed`
    — `game.js:333-336` vs `mp-engine.js:145-148`
  - food respawn + `growTail` — `game.js:329,351-354` vs `mp-engine.js:142-143`.
- **Direction easing** — `updateSnakeDirection()` (`game.js:257-271`) and `updatePlayerDirection()`
  (`mp-engine.js:61-66`) are already near-identical thin wrappers over `speedToTurnStep` /
  `stepDirection`; the MP comment even says *"same math, player fields"* (`mp-engine.js:58`).

The pure geometry was already extracted to `logic.js` (`followSegments`, `growTail`, `speedToTurnStep`,
`hitsWall`, `hitsSnake`, `eatsFood`, `joystickToControl`), but the **per-actor orchestration** that
ties those primitives together (advance → eat → ramp) was **not** — so it lives twice.

Separately, **`game.js` is the largest file in the repo at 687 lines** (`public/js/game.js:1-687`)
and mixes three unrelated concerns:
1. the solo simulation (loop, movement, collision, combo lifecycle),
2. the **~130-line canvas renderer** `drawSnake()` + `renderGame()` (`game.js:403-534`) — which
   **multiplayer also calls** (`renderGame` branches on `gameState.mode` at `game.js:481-488`), so it
   is not solo-specific at all, and
3. **global-leaderboard DOM**: `submitAndShowRank()` (`game.js:631-652`) and `showNameEntry()`
   (`game.js:658-679`) — pure leaderboard UI that belongs next to `leaderboard-ui.js`.

Finally, **CI never validates the build's structural invariants.** The "Quality Checks" step
(`.github/workflows/deploy.yml:38-49`) is two greps — `<!DOCTYPE` in `index.html` and `firebaseConfig`
in `config.js` — plus a `node --check` syntax pass over `public/js/*.js`. Nothing checks the
**load-order invariant** (the documented `utils → logic → … → main` sequence the whole global-scope
design depends on), and nothing checks that every `public/js|css` file is **referenced exactly once**
in `index.html` and **present in `SHELL_ASSETS`** (`public/sw.js:10-42`). A new file added to `js/`
but forgotten in `index.html` or `sw.js` ships broken (offline) with green CI.

## 2. Why it matters

This is **launch-readiness / quality** debt that scales badly as more people play and the codebase
grows. Concretely:

- **Tuning safety** — pushing for real users means iterating on game feel (combo window, speed ramp,
  score curve). Today every tuning change is a two-file edit with a silent-divergence trap; after B1
  it's one helper in `logic.js`, **covered by one test that runs both modes**.
- **Test leverage** — M6 will finally cover the MP engine. B1 then routes both engines through the
  same pure step, so a single unit test pins the shared behavior for solo *and* MP — the highest-value
  coverage per line in the project.
- **Readability / onboarding** — `game.js` drops from 687 toward ~400 lines and stops being a grab-bag
  of sim + render + leaderboard DOM; the renderer earns its own file that honestly reflects that both
  modes call it.
- **Build integrity** — the script-order + shell-asset guard turns the load-order minefield (the
  single biggest runtime-breakage risk in this no-bundler design) into a **CI failure at PR time**
  instead of a white screen in production after deploy.

## 3. Goals

- Extract the shared **per-actor step** into `public/js/logic.js` as **pure** helpers that operate on
  an "actor-shaped" object (the fields common to `gameState` and a `player`): `advanceHead`,
  `applyEat`, `rampSpeed` (names final in §5).
- Solo (`moveSnake`) and MP (`movePlayer` / `applyFoodEaten`) both call those helpers; thin wrappers
  keep the side-effects (game-over vs outcome object, juice/sound, DOM).
- One Vitest test in `tests/` covers the shared step for **both** the solo actor and a player actor.
- Move the canvas renderer (`drawSnake`, `renderGame`, and the small canvas helpers it owns) into a
  **new `public/js/render.js`**, loaded immediately after `game.js`.
- Move `submitAndShowRank` + `showNameEntry` from `game.js` into `public/js/leaderboard-ui.js`.
- Add **`tests/scripts.test.js`** (pure Node, no jsdom) asserting: (a) the `index.html` `<script
  src="js/…">` order exactly matches the documented sequence, (b) every `public/js/*.js` and
  `public/css/*.css` file is referenced **exactly once** in `index.html` and present in
  `SHELL_ASSETS` in `sw.js`, and (c) the reverse — every referenced/cached path exists on disk.
- Net: `game.js` shrinks toward ~400 lines; shared step collapses ~60 duplicated lines; CI gains real
  structural guards. **No gameplay behavior changes** for either mode or either transport.

## 4. Non-goals

- **No gameplay/feel changes.** Scores, speeds, combo timing, collision radii, spawn poses must be
  byte-identical in behavior. This is a pure refactor + test/CI add.
- **No bundler, no ES modules, no load-order change** beyond inserting `render.js` right after
  `game.js`. The fixed `<script>` sequence and one-global-scope model stay.
- **Not touching the sync layer** (`network.js`, `mp-net.js`, `mp-client.js`), the Firebase/RTDB
  schema, or either security-rule file. No transport behavior changes.
- **Not** rewriting `effects.js`, `sound.js`, or the HiDPI/setupHiDPICanvas plumbing.
- **Not** the M5 render-performance work (shadowBlur/idle throttle). B1 *moves* the renderer; it does
  not optimize it. If M5 lands first, B1 moves the optimized version verbatim (see §8).
- **Not** adding a bundler-style "barrel" or changing how `logic.js` exports to Node.

## 5. Proposed solution

### 5a. Extract the shared per-actor step into `logic.js` (pure)

The common fields between solo `gameState` and a `player` (`public/js/players.js:42-57`,
`public/js/state.js:30-51`) are: `snake`, `direction`, `targetDirection`, `baseSpeed`, `currentSpeed`,
`score`, `combo`, `lastFoodTime`. Both objects already carry **all** of these under the same names — so
an "actor" is just the subset of either object. Add three side-effect-free helpers to `logic.js`,
exported through the existing Node-guard block (`public/js/logic.js:264-282`) the same way every other
pure helper is, and add each new name to `.eslintrc.json` `globals` **and** to the test's destructure.

1. **`advanceHead(actor, config)`** — returns the prospective new head + the prevHead, and the
   collision verdict, without mutating:
   ```
   advanceHead(actor, config) -> { head, prevHead }
   ```
   It computes `head = {x: snake[0].x + cos(direction)*currentSpeed, y: …sin…}` (the exact trig from
   `game.js:283-284` / `mp-engine.js:101-102`) and returns the new head plus a copy of the old head.
   Collision stays at the call site because solo vs MP differ on *which* snakes to test against
   (self only vs self + every other player). Reuse the existing `hitsWall` / `hitsSnake` / `hitsSelf`
   from `logic.js` — do **not** duplicate them into the helper.

2. **`applyEat(actor, config)`** — the pure combo + score + tail-grow + speed-ramp mutation that is
   identical in both files. Operates **in place** on the actor (it already mutates `actor.snake` via
   `growTail`, matching the existing in-place convention of `followSegments`/`growTail`):
   ```
   applyEat(actor, nowMs, config) -> { multiplier, gained }
   ```
   - combo: `actor.combo = (nowMs - actor.lastFoodTime < config.comboWindowMs) ? actor.combo + 1 : 1`
   - `actor.lastFoodTime = nowMs`
   - `const multiplier = Math.min(actor.combo, config.maxCombo)`
   - `const gained = 10 * multiplier; actor.score += gained`
   - `growTail(actor.snake, config)` (reuse `logic.js:218`)
   - speed ramp via `rampSpeed` below
   - **returns** `{multiplier, gained}` so the **caller** does the side-effects that differ: solo
     fires `spawnFoodBurst` + white/gold `spawnScorePop` + `playFoodSound` + `sendHapticFeedback` +
     `updateScore` + `updateComboDisplay` (`game.js:318-329`); MP fires the player-colored
     `spawnScorePop` + `playFoodSound` + the `mpUiHook`/`mpNetHook` sync (`mp-engine.js:135-151`).
     `nowMs` is passed in (not `Date.now()` inside) so the helper stays pure and deterministically
     testable — same discipline as the rest of `logic.js`.
   - **Food respawn stays at the call site** because the avoid-set differs: solo passes its single
     snake (`generateFood()` default, `game.js:361-362`), MP passes `aliveSnakes()`
     (`mp-engine.js:142`).

3. **`rampSpeed(actor, config)`** — the 4-line gentle ramp shared verbatim
   (`game.js:333-336` / `mp-engine.js:145-148`):
   ```
   if (actor.baseSpeed < config.maxSpeed) {
     actor.baseSpeed = Math.min(config.maxSpeed, actor.baseSpeed + config.speedIncrease);
     actor.currentSpeed = actor.baseSpeed;
   }
   ```
   Called from inside `applyEat`. Exported separately so the test can pin the ramp + cap in isolation.

**Optional consolidation of direction easing.** `updateSnakeDirection` (`game.js:257-271`) and
`updatePlayerDirection` (`mp-engine.js:61-66`) are already trivial wrappers over `speedToTurnStep` +
`stepDirection`. They may optionally collapse into one shared wrapper (e.g. `stepActorDirection(actor,
frameFactor, config)`), but this is low value (both are ~5 lines) — **fold it in only if it does not
expand the diff or risk**; otherwise leave them. `TARGET_FRAME_MS` / `MAX_FRAME_STEP`
(`game.js:247-248`) remain where they are (consumed by both files via global scope).

**Result at the call sites (behavior-preserving):**
- `moveSnake()` becomes: `advanceHead` → `hitsWall`/`hitsSelf` → on hit `gameOver()`; else
  `gameState.snake[0] = head; followSegments(...)`; on `eatsFood` → `applyEat` + the solo juice/DOM +
  `generateFood()`.
- `movePlayer()` becomes: `advanceHead` → `hitsWall`/`hitsSnake`(self)/other-loop → return the outcome
  object unchanged; `stepMultiplayerTick`'s `applyFoodEaten(player)` becomes `applyEat` + the
  player-colored juice + `generateFood(aliveSnakes())` + the `mpUiHook`/`mpNetHook` calls.

### 5b. Split out the renderer → new `public/js/render.js`

Move `drawSnake()` (`game.js:403-452`) and `renderGame()` (`game.js:457-534`) into a new
`public/js/render.js`, loaded **immediately after** `game.js` in both `index.html` and `SHELL_ASSETS`.
`renderGame` already branches on `gameState.mode` and calls `getLobbyOverlayLines()` via `window`
lookup (`game.js:520`) — that pattern is preserved. The renderer reads globals (`ctx`, `gameState`,
`gameConfig`, `colors`) and calls `getShakeOffset` / `updateAndDrawEffects` (`effects.js`), all defined
in earlier-loaded files, so loading `render.js` after `game.js` keeps every reference resolvable.
`setupHiDPICanvas()` (`game.js:40-48`) **stays in `game.js`** (it's init/loop plumbing, called from
`initializeDesktopGame` and the resize handler, `game.js:18-20`) — but its resize handler calls
`renderGame()`, which is fine since `render.js` loads before any user interaction.

### 5c. Move leaderboard DOM → `leaderboard-ui.js`

Move `submitAndShowRank` (`game.js:631-652`) and `showNameEntry` (`game.js:658-679`) into
`public/js/leaderboard-ui.js`. They already only touch leaderboard DOM (`#global-rank`, `#name-entry`,
`#player-name`) and call `submitGlobalScore` / `setPlayerName` / `getPlayerName` (all from
`leaderboard.js`, loaded **before** `leaderboard-ui.js`) plus `LB_RANK_CAP` / `trackEvent`. `gameOver`
(staying in `game.js`) calls them via the existing `typeof …=== 'function'` guards
(`game.js:605-608`) — **keep those guards**, since `game.js` loads *after* `leaderboard-ui.js`, both
functions are defined by the time `gameOver` runs. No call-order regression.

### 5d. New `tests/scripts.test.js` (pure Node, no jsdom)

A Vitest file that reads `public/index.html` and `public/sw.js` as text and asserts structural shape
— same "read real source files" approach as `tests/protocol.test.js` (`tests/protocol.test.js:21-28`),
but **no JSDOM** (faster, no DOM needed). It encodes the **documented load order** (the sequence in
`CLAUDE.md` + the post-B1 insertion of `render.js`) as the source of truth:

```
utils, logic, config, state, players, leaderboard, leaderboard-ui, sound, effects,
mp-engine, network, mp-net, game, render, controller, mp-client, main
```

Assertions:
- The ordered list of `<script src="js/X.js">` in `index.html` **equals** the expected sequence
  (order-sensitive; the inline `<script>` blocks at `index.html:43-71, 320-366` are ignored — only
  `src="js/…"` tags count).
- Every `public/js/*.js` on disk is referenced **exactly once** in `index.html` (no missing, no dup).
- Every `public/js/*.js` and `public/css/*.css` on disk appears in `SHELL_ASSETS` in `sw.js` (parse
  the `./js/…` / `./css/…` strings out of `sw.js`).
- Reverse: every `js/…` referenced in `index.html` and every `./js|css/…` in `SHELL_ASSETS` **exists
  on disk** (catches a typo or a deleted file).
- Every `<link rel="stylesheet" href="css/X.css">` in `index.html` matches the documented CSS order
  (`variables → base → desktop → mobile → leaderboard → multiplayer`, `index.html:9-14`).

This file is **load-order regression insurance for the whole project**, not just B1 — exactly the
guard the brief asks for.

## 6. Acceptance criteria

**Shared per-actor step (logic.js)**
- [ ] `advanceHead`, `applyEat`, `rampSpeed` are defined in `public/js/logic.js`, are pure
      (no `Date.now()`, no DOM, no globals — every input passed as an argument), and are added to the
      `module.exports` block (`logic.js:264-282`).
- [ ] Given a solo-shaped actor `{snake, direction, currentSpeed, baseSpeed, score, combo, lastFoodTime}`
      and a player-shaped actor with the same fields, When each is run through `applyEat(actor, now, cfg)`,
      Then the resulting `score`, `combo`, `multiplier`, `gained`, snake length, and ramped `baseSpeed`/
      `currentSpeed` are computed by the **same** code path (one parametrized test covers both).
- [ ] Given `combo` at `maxCombo` and another eat inside `comboWindowMs`, Then `multiplier` is clamped
      to `maxCombo` and `gained === 10 * maxCombo` (cap honored).
- [ ] Given `lastFoodTime` older than `comboWindowMs`, When `applyEat` runs, Then `combo` resets to `1`
      (streak broken).
- [ ] Given `baseSpeed === maxSpeed`, When `rampSpeed` runs, Then `baseSpeed`/`currentSpeed` are
      unchanged (no overshoot past `maxSpeed`).
- [ ] `moveSnake()` (solo) and `movePlayer()`/`applyFoodEaten()` (MP) call the new helpers; the inline
      duplicated trig/combo/ramp blocks are deleted from both files.

**Behavior parity (no gameplay change)**
- [ ] Solo: eating still awards `10 * multiplier`, ramps speed, grows the tail, respawns food clear of
      the snake, plays the food sound at the combo pitch, fires the white/gold score pop, and fires
      `sendHapticFeedback('food')` (matches `game.js:318-329` exactly).
- [ ] MP: eating still awards per-player score, fires the **player-colored** score pop, respawns food
      clear of **all alive** snakes (`aliveSnakes()`), and still calls `mpUiHook('updateMpScoreboard')`
      + `mpNetHook('mpSyncScoreOnEat', slot, score)` (matches `mp-engine.js:135-151`).
- [ ] MP death semantics unchanged: `movePlayer` still **returns** the outcome object (no inline
      `gameOver`), deaths are still collected then resolved in `stepMultiplayerTick`
      (`mp-engine.js:74-89`), and the "biter dies" `hitsSnake(head, other.snake, 0, …)` rule is intact.
- [ ] The existing `tests/logic.test.js` and (post-M6) MP-engine tests still pass unchanged.

**Renderer split (render.js)**
- [ ] `public/js/render.js` exists and contains `drawSnake` + `renderGame`; both are removed from
      `game.js`.
- [ ] `index.html` loads `js/render.js` **immediately after** `js/game.js`
      (`index.html:312` → render → controller).
- [ ] `setupHiDPICanvas` and the game loop remain in `game.js`; the resize handler still calls
      `renderGame()` and resolves it at runtime.

**Leaderboard DOM move**
- [ ] `submitAndShowRank` + `showNameEntry` live in `public/js/leaderboard-ui.js` and are removed from
      `game.js`; `gameOver` still invokes them via its existing `typeof === 'function'` guards.

**CI shape guard (scripts.test.js)**
- [ ] `tests/scripts.test.js` exists, uses no JSDOM, and fails if: the `<script src="js/…">` order in
      `index.html` differs from the documented sequence (incl. `render.js` in its slot); any
      `public/js/*.js` or `public/css/*.css` is unreferenced in `index.html`; any is missing from
      `SHELL_ASSETS`; or any referenced/cached path is absent on disk.
- [ ] Negative check (proven locally before merge, then reverted): deliberately removing `render.js`
      from `SHELL_ASSETS`, or reordering two `<script>` tags, makes `npm test` go red.

**Guardrails**
- [ ] `.eslintrc.json` `globals` gains `advanceHead`, `applyEat`, `rampSpeed`, `drawSnake` already
      present (`.eslintrc.json:118`), `renderGame` already present (`:191`); any function *moved*
      between files keeps its existing global entry, and any **new** top-level name is added — `npm run
      lint` stays green (`no-undef` is error).
- [ ] `public/sw.js` `CACHE` bumped from `snake-shell-v11` to `snake-shell-v12` (`sw.js:8`) and
      `./js/render.js` added to `SHELL_ASSETS` (`sw.js:10-42`).
- [ ] No PII and no 6-digit session code logged anywhere in the new/moved code.
- [ ] CI green end to end: `npm run lint`, `npm test` (Vitest incl. the new `scripts.test.js` and the
      jsdom `protocol.test.js`), and the `node --check` syntax pass over `public/js/*.js` (now incl.
      `render.js`).
- [ ] `tests/protocol.test.js` still passes — note its `SCRIPTS` list (`protocol.test.js:24-27`) omits
      `render.js`/`leaderboard-ui.js`/`mp-engine.js` (it drives solo sync only); confirm the moved
      `renderGame`/leaderboard functions are not required on that path, OR add `render.js` to that
      list if the solo path now references `renderGame` from a different file (it does — `startGameLoop`
      and `updateGame` call `renderGame`, `game.js:144,236`). **This is the highest-risk acceptance
      item — see §9.**

## 7. Affected files

| File | Change |
| --- | --- |
| `public/js/logic.js` | **NEW helpers** `advanceHead`, `applyEat`, `rampSpeed`; add to `module.exports`. |
| `public/js/game.js` | `moveSnake` calls the new helpers (delete inline trig/combo/ramp); **remove** `drawSnake`, `renderGame` (→ render.js) and `submitAndShowRank`, `showNameEntry` (→ leaderboard-ui.js). Shrinks ~687 → ~400 lines. |
| `public/js/mp-engine.js` | `movePlayer`/`applyFoodEaten` call the new helpers (delete inline combo/ramp); death/outcome semantics unchanged. |
| `public/js/render.js` | **NEW FILE** — `drawSnake` + `renderGame` moved verbatim. Loaded after `game.js`. |
| `public/js/leaderboard-ui.js` | **GAINS** `submitAndShowRank` + `showNameEntry` (moved from game.js). |
| `public/index.html` | Add `<script src="js/render.js">` directly after `js/game.js` (`index.html:312`). |
| `public/sw.js` | **BUMP `CACHE` → `snake-shell-v12`**; add `./js/render.js` to `SHELL_ASSETS`. |
| `.eslintrc.json` | **GLOBALS BUMP** — add `advanceHead`, `applyEat`, `rampSpeed` (and any optional `stepActorDirection`). `drawSnake`/`renderGame`/`submitAndShowRank`/`showNameEntry` already declared — keep them. |
| `tests/scripts.test.js` | **NEW FILE** — pure-Node script-order + shell-asset shape guard. |
| `tests/` (shared step) | **NEW or extended** test asserting `applyEat`/`rampSpeed`/`advanceHead` behave identically for a solo actor and a player actor (may extend `tests/logic.test.js` or add `tests/engine-step.test.js`). |
| `tests/protocol.test.js` | Possibly add `render.js` to its `SCRIPTS` list so the solo sync path can resolve `renderGame` (see §6 / §9). |

## 8. Dependencies & sequencing

- **Must land after M11 (globals check)** — B1 adds/moves several top-level names; the M11 automated
  globals-vs-eslintrc check makes the inevitable `.eslintrc.json` slip a CI failure instead of a
  production `no-undef` break. Do B1 *after* that net exists.
- **Must land after M6 (multiplayer engine tests)** — M6 adds the `module.exports` block to
  `mp-engine.js` and the first MP-engine coverage. B1 then refactors the MP step under that test net,
  so any behavior drift is caught immediately. Without M6, the MP path is unverified during exactly
  the refactor that touches it.
- **Prerequisite for B2** — the cleaner, smaller, better-tested engine surface is the foundation B2
  builds on.
- **Interaction with M5 (render performance):** M5 also edits `renderGame`/`drawSnake`. To avoid a
  three-way conflict, **sequence M5 before B1** if both are planned — B1 then *moves* the optimized
  renderer verbatim into `render.js`. If B1 lands first, M5 simply targets `render.js` afterward.
  Either order is fine; just don't run them concurrently on the same functions.

## 9. Risks & mitigations

- **HIGHEST RISK — load-order / globals mistakes break PRODUCTION at runtime, not at lint time.** A
  function moved to a file that loads *before* its callers, or a `<script>` omitted, yields a white
  screen *after* deploy (lint and `node --check` pass per-file). **Mitigations:** (1) the new
  `tests/scripts.test.js` makes order/omission a CI failure at PR time; (2) M11's globals check guards
  the eslintrc; (3) verify the actual rendered app locally via `python -m http.server` + Claude_Preview
  before merge (see §10); (4) keep `render.js` *after* `game.js` and `leaderboard-ui.js` *after*
  `leaderboard.js` so every moved function's dependencies are already defined.
- **`protocol.test.js` SCRIPTS list drift.** That harness hand-lists the scripts it evaluates
  (`protocol.test.js:24-27`) and currently includes `game` but not a separate render file. Since
  `renderGame` moves to `render.js` and `game.js`'s loop calls `renderGame` (`game.js:144,236`), the
  harness must either add `render.js` to its list or the solo sync test will throw `renderGame is not
  defined`. **Mitigation:** treat updating that list as part of the renderer-split commit; it's an
  explicit acceptance item (§6). This is the one place where "move a function" silently breaks an
  existing test.
- **Actor-shape mismatch.** If a field name differs between `gameState` and `player`, the shared helper
  corrupts one mode. **Mitigation:** verified both objects already share `snake/direction/
  targetDirection/baseSpeed/currentSpeed/score/combo/lastFoodTime` under identical names
  (`state.js:30-51`, `players.js:42-57`); the dual-actor test pins it.
- **Purity slip in `applyEat`.** Calling `Date.now()` *inside* the helper would make it untestable and
  re-introduce nondeterminism. **Mitigation:** `nowMs` is a parameter; the call sites pass `Date.now()`
  (matching `game.js:308` / `mp-engine.js:128`).
- **Scope creep into feel changes.** The temptation to "tidy" a magic number while refactoring. **
  Mitigation:** §4 forbids any behavior change; the parity acceptance criteria are byte-level.
- **Big diff, CI-bound iteration (no local Node).** **Mitigation:** ship in small, individually-green
  commits — (1) add pure helpers + their test (no call-site change yet), (2) rewire solo, (3) rewire
  MP, (4) split renderer + sw/eslintrc/index bumps, (5) move leaderboard DOM, (6) add
  `scripts.test.js`. Each commit is independently CI-verifiable.

## 10. Verification / test plan

Given **no local Node** (iteration is CI-bound) and the no-bundler global-scope design, verify in
layers — cheapest first:

1. **Vitest (`npm test`, runs in CI):**
   - New dual-actor step test — assert `applyEat`/`rampSpeed`/`advanceHead` produce identical results
     for a solo-shaped and a player-shaped actor, incl. the combo cap, the streak reset, and the
     `maxSpeed` clamp (mirrors the `tests/logic.test.js` style, `logic.test.js:1-30`).
   - New `tests/scripts.test.js` — order + shell-asset shape guard. **Prove it bites:** locally (or in
     a throwaway CI run) reorder two `<script>` tags / drop `render.js` from `SHELL_ASSETS` and confirm
     red, then revert.
   - `tests/protocol.test.js` (jsdom solo-sync smoke) — confirm green *after* adding `render.js` to its
     `SCRIPTS` list; this is the canary for the renderer move.
   - M6's MP-engine tests — confirm green after the MP rewire (death collection, biter-dies, fruit
     respawn-between-movers, combo cap all unchanged).
2. **Lint (`npm run lint`, CI, `no-undef` is error):** passes only if `.eslintrc.json` `globals` lists
   every new top-level name — this is the load-order canary at lint time.
3. **`node --check` (CI Quality Checks, `deploy.yml:42`):** now also syntax-checks `render.js` (it's
   `public/js/*.js`); confirms no parse error in the moved code.
4. **Local rendered-app smoke (the only way to catch a runtime load-order break before deploy):**
   `python -m http.server` in `public/`, open in Claude_Preview, **unregister the SW + clear caches
   first** (network-first SW serves stale assets locally). Verify: solo round plays/eats/dies/restarts;
   the canvas renders (proves `render.js` resolved); a 2-player MP round plays and ends (proves the MP
   rewire + the shared renderer); the game-over leaderboard name-entry still appears (proves the
   leaderboard-DOM move). Screenshots time out — use `preview_eval`/`preview_snapshot`, not
   screenshots.
5. **No production hand-deploy / no scratch Firebase project needed** — B1 touches **no** security
   rules and **no** RTDB/Firestore schema, so the rules-emulator path does not apply. CI's auto-deploy
   on the merge to `master` is the only deploy; the SW `CACHE` bump ensures installed clients pick up
   `render.js` on next reload.

## 11. Analytics & observability

No **new** analytics events — B1 is a structural refactor and must preserve the existing funnel exactly.
The moved/rewired code still emits, through the hardened `trackEvent()` (`utils.js`), the *same* events
in the *same* places:

- Solo eat/over path keeps `game_over` + `post_score` (`game.js:613-614`) and `leaderboard_submit`
  (now fired from the moved `submitAndShowRank` in `leaderboard-ui.js`, `game.js:643,647`).
- MP path keeps `mp_game_start` / `mp_elimination` / `mp_game_over` (`mp-engine.js:28,176,210`) — the
  `applyEat` extraction does not touch them.

Observability check (manual, post-merge): confirm in GA4 DebugView that solo `post_score` /
`leaderboard_submit` and MP `mp_elimination` still fire after the refactor — a regression here would
signal a call-site that lost its `trackEvent`. No event renaming, no new PII, and the 6-digit code
still never appears in any payload (the `mp_game_over` winner payload remains score-only,
`mp-engine.js:210-213`).
