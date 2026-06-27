# M6 · Test the multiplayer engine + factories + cheap pure-function wins

> **Tier** medium · **Focus** Launch-readiness / Quality · **Impact** High · **Effort** M (1-2 days) · **Priority** 64/100
> **Status** `Not started` · **Depends on** none — de-risks M4 and B1 · **Part of** [Roadmap](./README.md)

## 1. Problem — what we're solving

The most intricate gameplay logic in the repo — the N-snake multiplayer simulation — has **zero
test coverage**, while the cheapest-to-test files (already export-ready) have **no test file at all**.

Verified evidence:

- **`public/js/mp-engine.js` (262 lines) has NO `module.exports`.** I read the whole file end to
  end; it ends at the `mpNetHook` definition (`mp-engine.js:255-262`) with no Node-guard block — so
  it cannot be `require()`d from Vitest the way `logic.js`/`utils.js` are. The intricate, fully
  uncovered behaviors live here:
  - **Death collection then resolve** — `stepMultiplayerTick()` (`mp-engine.js:74-89`) collects
    deaths during the slot-order move loop and applies them *after* every player moved, so a dying
    snake still blocks others that same tick (honest simultaneous/head-on deaths).
  - **The "biter dies" rule** — `movePlayer()` (`mp-engine.js:98-119`) checks other snakes with
    `hitsSnake(head, other.snake, 0, …)` (skip = 0 includes the head), and the snake whose head
    moved into another body is the one that dies (`cause: 'bite', by: other.slot`,
    `mp-engine.js:110-112`).
  - **Fruit respawn between movers** — when an earlier mover eats, `applyFoodEaten()`
    (`mp-engine.js:125-152`) immediately calls `generateFood(aliveSnakes())`, so later movers in the
    same tick see the **new** fruit position (`mp-engine.js:82-84`, `:142`).
  - **Per-player combo ramp + cap** — `applyFoodEaten()` ramps the combo only inside
    `gameConfig.comboWindowMs` and caps the multiplier at `gameConfig.maxCombo`
    (`mp-engine.js:129-133`); combo also **expires** in `updateMultiplayerFrame()`
    (`mp-engine.js:48-54`).
  - **Speed ramp on eat** — base/current speed steps by `gameConfig.speedIncrease` up to
    `gameConfig.maxSpeed` (`mp-engine.js:145-148`).
- **`public/js/players.js` (91 lines) has NO `module.exports` either.** The factories
  `createPlayer()` (`players.js:36-58`) and `createMultiplayerState()` (`players.js:66-72`) are the
  untested integration glue between the `maxPlayers` knob, the `PLAYER_COLORS` palette
  (`players.js:14-21`), and the pure pose helpers in `logic.js`. Note: line 24's `PLAYER_SLOTS`
  reads `gameConfig.maxPlayers` **at module-evaluation time**, and `createPlayer` reads
  `gameConfig`, `PLAYER_COLORS`, and calls `spawnPose`/`snakeFromPose` — so these can't be tested by
  a bare `require()`; they need their dependencies in scope (see §5).
- **`public/js/share.js` and `public/js/effects.js` ALREADY export functions but have no test
  file** — the cheapest coverage in the repo:
  - `share.js:134-136` exports `{ shareUrl, buildShareText, setMpShareContext, openShare,
    wireGameOverCard }`. `buildShareText()` (`share.js:32-43`) has **three untested branches**
    (winner / eliminated / solo) and `shareUrl()` (`share.js:12-14`) deliberately strips the session
    param (`${location.origin}${location.pathname}`, no query string).
  - `effects.js:146-156` exports `{ effects, spawnFoodBurst, spawnScorePop, triggerShake,
    getShakeOffset, updateAndDrawEffects, resetEffects }`. `triggerShake()`/`getShakeOffset()`
    (`effects.js:59-75`) decay linearly to zero and are trivially testable with a stubbed
    `Date.now`.
- **Only `resolveWinner` is currently exercised** as multiplayer logic — and it lives in `logic.js`
  (`logic.js:253-262`), tested in `tests/logic.test.js:305-338`. The engine that *calls* it
  (`checkEndCondition` → `endMultiplayerGame`) is untested.
- **There is no coverage reporting.** `package.json:5-10` has `"test": "vitest run"` and no coverage
  flag; there is no `vitest.config.js` (confirmed: none exists at repo root), and
  `@vitest/coverage-v8` is **not** in `devDependencies` (`package.json:18-24`).

Today's tests are `tests/logic.test.js`, `tests/utils.test.js`, and the jsdom protocol smoke test
`tests/protocol.test.js`. The multiplayer engine — the part most likely to ship a subtle bug — is
the **least** covered.

## 2. Why it matters

This is a **Launch-readiness / Quality** initiative. Multiplayer ("last snake standing", 1–6
players) is a headline feature for pushing the live demo (https://go-console-84748.web.app/) to real
users, and it is the code most prone to silent, hard-to-reproduce bugs: simultaneous deaths, the
"who actually died" attribution that the winner/defeat cards render from, and combo/score math that
players will immediately notice if it's wrong. There is **no local Node** on this machine, so every
regression is otherwise only catchable in CI or in production — locking the engine's rules behind
fast, pure unit tests turns "we think it works" into "CI proves it works on every push."

It is also high **leverage for effort**: `effects.js` and `share.js` already export their functions,
so a test file each is near-free coverage. And it **de-risks downstream work** — M4 and B1 build on
top of this engine; characterization tests here let those changes refactor with confidence instead
of fear of the global-scope minefield.

## 3. Goals

- Add a Node-guarded `module.exports` block to `mp-engine.js` and `players.js` (mirroring the
  existing pattern at `logic.js:264-282`, `effects.js:145-156`, `share.js:133-136`) so their
  functions are `require()`-able under Vitest while remaining a no-op in the browser classic-script
  context.
- New `tests/mp-engine.test.js` covering: head-on double-elimination, the biter-dies rule, the
  combo ramp + cap, combo expiry, the speed ramp, and fruit respawn clearing alive snakes between
  movers in one tick.
- New `tests/players.test.js` covering: a 3-player roster → correct slots/colors/5-segment snakes
  via `createMultiplayerState`, the 1-player solo-identical pose, and an over-cap (e.g. p6) spawn
  still building correctly from the slot id.
- New `tests/share.test.js` covering: `buildShareText`'s three branches (winner / eliminated-by /
  solo) and `shareUrl()` stripping the session/query string.
- New `tests/effects.test.js` covering: `triggerShake` → `getShakeOffset` linear decay to `{x:0,
  y:0}`, and `resetEffects` clearing the buffers.
- Add `@vitest/coverage-v8` + a `vitest.config.js` with `coverage.include = ['public/js/**']`, wired
  so coverage can be generated locally/CI but is **non-blocking** (no minimum thresholds) at first.
- All of it green in CI: `npm run lint`, `npm test` (Vitest), and the `node --check` syntax pass.

## 4. Non-goals

- **Not** refactoring the engine's behavior. The new exports and any thin side-effect wrappers must
  be **behavior-preserving** — this is characterization testing, not a redesign.
- **Not** testing the rendering side-effects themselves (canvas draw in `updateAndDrawEffects`,
  particle visuals) beyond their state bookkeeping; visuals stay a Claude_Preview concern.
- **Not** testing the sync layer (`mp-net.js`) or UI layer (`mp-ui.js`) end-to-end. Those are
  reached only through the `mpNetHook`/`mpUiHook` indirection (`mp-engine.js:244-262`), which the
  tests **stub**.
- **Not** enforcing a coverage threshold / making coverage a blocking CI gate in this pass
  (explicitly "non-blocking at first").
- **Not** touching `firestore.rules` / `database.rules.json` / `sw.js` shell assets — no transport,
  rules, or PWA-shell change.
- **Not** changing `gameConfig` tunables (`config.js:71-103`) — tests read the real values or a
  local mirror, but do not alter them.

## 5. Proposed solution

### 5a. Make the engine + factories require-able (production source, minimal additive change)

Add a Node-guard export block at the **bottom** of each file, copying the exact idiom already in the
repo (`logic.js:264-282`, `effects.js:145-156`, `share.js:133-136`):

- **`public/js/mp-engine.js`** — export the pure-ish orchestration plus the helpers the tests drive:
  `{ startMultiplayerGame, updateMultiplayerFrame, updatePlayerDirection, stepMultiplayerTick,
  movePlayer, applyFoodEaten, eliminatePlayer, checkEndCondition, endMultiplayerGame,
  applyPlayerJoystick, hideSoloHud }`. Wrapped in
  `if (typeof module !== 'undefined' && module.exports) { … }` so it is inert in the browser.
- **`public/js/players.js`** — export `{ PLAYER_COLORS, PLAYER_SLOTS, createPlayer,
  createMultiplayerState, alivePlayers, aliveSnakes, getPlayerBySlot }`.

These functions are **not pure** the way `logic.js` is: they read the globals `gameConfig`,
`colors`, `PLAYER_COLORS`, `gameState`, and the `logic.js` helpers, and they call side-effecting
hooks (`mpUiHook`, `mpNetHook`, `spawnFoodBurst`, `playFoodSound`, `triggerShake`, `generateFood`,
`debugLog`, `trackEvent`). Two test strategies handle that — pick per file:

**Strategy A — `vm.runInContext` harness (preferred for `mp-engine` / `players`).** Reuse the proven
pattern in `tests/protocol.test.js:32-46`: build a context, inject the needed globals, and evaluate
the real classic `<script>` sources with `vm.runInContext` so top-level `let/const` (e.g.
`gameState`, `PLAYER_SLOTS`) share one lexical scope exactly like sequential `<script>` tags. Load
the minimal chain the engine needs — `utils.js` (for `debugLog`/`trackEvent`/`safeParse`),
`logic.js` (pose/collision math), `config.js` (`gameConfig`/`colors`/`GameState` — stub `firebase`
to force the offline path as protocol.test.js does at `:39`), `state.js`
(`createInitialGameState`/`gameState`), `players.js`, then `mp-engine.js`. Provide tiny **stub
globals** for the side-effect functions the engine calls (`spawnFoodBurst`, `spawnScorePop`,
`playFoodSound`, `playStartSound`, `playCrashSound`, `triggerShake`, `resetEffects`, `hideSoloHud`'s
`document.getElementById`, and `window[...]` for the `mpUiHook`/`mpNetHook` lookups) so they no-op or
record calls. With this harness, **`module.exports` is not strictly required** for the engine — but
we still add it (Goal §3) because it (1) enables the simpler Strategy B for the factory tests and
(2) is the established repo convention for testable files.

**Strategy B — direct `require()` with injected deps (works once exports exist; good for
`players.js`).** Because `players.js:24` reads `gameConfig.maxPlayers` at import time and
`createPlayer` calls `spawnPose`/`snakeFromPose`, the test sets up a global `gameConfig` and pulls
the pose helpers from `../public/js/logic.js` (already exported) **before** requiring the module — or
simply uses Strategy A's harness. Keep a single mirror `config` object like
`tests/logic.test.js:21-30` for the tunables the assertions need (`segmentSpacing`, `boardSize`,
`maxCombo`, `comboWindowMs`, `speedIncrease`, `maxSpeed`, `baseSpeed`).

> Keep side-effects in thin wrappers and stub them: the engine already isolates juice/sound/sync
> behind named functions (`spawnFoodBurst`, `playFoodSound`, …) and the `mpUiHook`/`mpNetHook`
> indirection (`mp-engine.js:244-262`). Tests inject no-op or spy stubs for those, then assert on the
> **state** the engine mutates (`gameState.players[i].score/combo/alive/death`,
> `gameState.mpResults`) and the **return values** of `movePlayer()`.

### 5b. The new test files

- **`tests/mp-engine.test.js`** — set up a small roster via the factories, force deterministic
  positions by writing `player.snake`/`player.direction`/`player.currentSpeed` directly (the same
  "park the head and step" technique protocol.test.js uses at `:138-141`), then assert:
  - **Head-on double elimination:** two heads moved onto each other in one tick → both collected,
    both eliminated, `resolveWinner` verdict matches (higher just-died score wins, equal = draw) —
    mirrors `logic.test.js:318-326` but through `stepMultiplayerTick`/`checkEndCondition`.
  - **Biter dies:** player A's head moves into B's body → A dies with `cause:'bite', by:'p?'`
    (B survives), via `movePlayer` (`mp-engine.js:108-113`).
  - **Combo ramp + cap:** call `applyFoodEaten` repeatedly within `comboWindowMs` (stub `Date.now`)
    → multiplier rises then caps at `gameConfig.maxCombo`; score gain is `10 * min(combo, maxCombo)`
    (`mp-engine.js:131-133`).
  - **Combo expiry:** advance the stubbed clock past `comboWindowMs` and run
    `updateMultiplayerFrame` → `player.combo` resets to 0 (`mp-engine.js:48-54`).
  - **Fruit clears alive snakes / respawns between movers:** stub `generateFood` to record the
    `aliveSnakes()` it received; assert an earlier eater's `applyFoodEaten` moved the fruit before a
    later mover's `movePlayer` ran in the same tick (`mp-engine.js:82-84`).
  - **Speed ramp:** after eating, `baseSpeed`/`currentSpeed` increase by `speedIncrease`, clamped at
    `maxSpeed` (`mp-engine.js:145-148`).
- **`tests/players.test.js`** —
  - 3-player roster → `createMultiplayerState(roster).players` has the right slots, each
    `colors === PLAYER_COLORS[slot]` (`players.js:44`), each `snake` length 5
    (`snakeFromPose(pose, 5, …)`, `players.js:45`), and `mode === 'multi'` with the solo base fields
    present (`players.js:67-71`).
  - 1-player roster reproduces the solo pose (center, heading 0) — cross-check against
    `logic.test.js:219-229`.
  - Over-cap slot (e.g. `'p6'` with `maxPlayers` 3) still spawns: `createPlayer` indexes from the
    slot id (`parseInt(slot.slice(1)) - 1`, `players.js:40`), so `PLAYER_COLORS['p6']` is used and no
    crash — the documented "roster larger than maxPlayers still spawns correctly" contract
    (`players.js:37-39`).
- **`tests/share.test.js`** — import `../public/js/share.js` (already exported):
  - `buildShareText(score, {outcome:'winner', defeated:['Ann','Bo']})` → "I defeated Ann & Bo …";
    `defeated:[]` → "I defeated everyone …" (`share.js:33-36`).
  - `buildShareText(score, {outcome:'eliminated', by:'Cy'})` → "Cy got me this time …"; `by:null` →
    "I crashed out at …" (`share.js:37-41`).
  - `buildShareText(score)` (no ctx) → the solo caption (`share.js:42`).
  - `shareUrl()` returns origin+pathname with **no** `?session=` / query string — set
    `global.location` (or jsdom) to a URL carrying `?session=123456` and assert it is stripped
    (`share.js:12-14`). Use the `environment: 'jsdom'` annotation or a `location` stub.
- **`tests/effects.test.js`** — import `../public/js/effects.js` (already exported):
  - `triggerShake(9, 340)` then `getShakeOffset()` with a stubbed `Date.now`: at t≈0 magnitude ≈ 9,
    halfway ≈ 4.5, and at/after `until` returns exactly `{x:0, y:0}` (`effects.js:59-75`).
  - `resetEffects()` empties `effects.particles/ripples/scorePops` and zeroes `shake`
    (`effects.js:138-143`).

### 5c. Coverage tooling (non-blocking)

- Add `@vitest/coverage-v8` to `devDependencies` (`package.json:18-24`).
- Add `vitest.config.js` at repo root:
  ```js
  import { defineConfig } from 'vitest/config';
  export default defineConfig({
    test: {
      coverage: {
        provider: 'v8',
        include: ['public/js/**'],
        reporter: ['text', 'html'],
        // No thresholds yet — reporting only, non-blocking.
      },
    },
  });
  ```
- Keep `"test": "vitest run"` as the CI command (coverage is opt-in via
  `npx vitest run --coverage`); CI stays green because coverage is reporting-only. Optionally add a
  separate `"coverage": "vitest run --coverage"` script — but do **not** wire it into the blocking
  CI steps in this pass.

**Both-transports / both-modes note:** this initiative is test-and-export only. It does not change
runtime behavior on either transport (Firestore/RTDB or localStorage) or in either engine (solo
`game.js` vs multi `mp-*.js`). The added `module.exports` blocks are inert in the browser
(`typeof module === 'undefined'`), exactly like the existing four exporting files.

## 6. Acceptance criteria

- [ ] **Given** Vitest/Node, **When** `tests/mp-engine.test.js` requires the engine, **Then**
  `mp-engine.js`'s Node-guarded `module.exports` provides at least `startMultiplayerGame,
  stepMultiplayerTick, movePlayer, applyFoodEaten, eliminatePlayer, checkEndCondition,
  endMultiplayerGame, updateMultiplayerFrame` — **and** in the browser the export block is a no-op
  (`typeof module === 'undefined'`, same guard as `logic.js:265`).
- [ ] **Given** two players whose heads move onto each other in one tick, **When**
  `stepMultiplayerTick()` runs, **Then** both are collected and eliminated (a dying snake still
  blocked the other this tick), and `checkEndCondition` yields the `resolveWinner` verdict
  (higher just-died score wins; equal scores → draw / `winnerSlot` null).
- [ ] **Given** player A's head moving into player B's body, **When** `movePlayer(A)` runs, **Then**
  it returns `{died:true, cause:'bite', by:B.slot}` and A (the biter) is the one eliminated; B
  survives.
- [ ] **Given** `applyFoodEaten` called N times within `gameConfig.comboWindowMs` (clock stubbed),
  **When** N exceeds `gameConfig.maxCombo`, **Then** the multiplier caps at `maxCombo` and the score
  gain equals `10 * min(combo, maxCombo)`.
- [ ] **Given** a player with `combo > 0`, **When** the stubbed clock advances past `comboWindowMs`
  and `updateMultiplayerFrame` runs, **Then** `player.combo === 0` (combo expiry).
- [ ] **Given** an earlier mover eats in a tick (stubbed `generateFood` records its arg), **When**
  the tick proceeds, **Then** `generateFood` was called with the **alive** snakes (`aliveSnakes()`)
  and the fruit position changed before the next mover's `movePlayer` ran.
- [ ] **Given** a player eats, **When** `applyFoodEaten` runs, **Then** `baseSpeed`/`currentSpeed`
  increased by `gameConfig.speedIncrease`, never exceeding `gameConfig.maxSpeed`.
- [ ] **Given** `players.js`'s new exports, **When** `tests/players.test.js` builds a 3-player roster
  via `createMultiplayerState`, **Then** each player has the right `slot`, `colors ===
  PLAYER_COLORS[slot]`, a 5-segment `snake`, and the state has `mode === 'multi'`.
- [ ] **Given** a 1-player roster, **When** `createPlayer` runs, **Then** the snake matches the
  classic solo layout (head at board center, heading 0) — consistent with `logic.test.js:219-229`.
- [ ] **Negative (over-cap):** **Given** slot `'p6'` while `gameConfig.maxPlayers === 3`, **When**
  `createPlayer('p6', …, 6)` runs, **Then** it does **not** throw and uses `PLAYER_COLORS['p6']`
  (index derived from the slot id, not `PLAYER_SLOTS.indexOf`).
- [ ] **Given** `tests/share.test.js`, **When** run, **Then** `buildShareText` returns the correct
  string for all three branches (winner with names / winner with empty `defeated` → "everyone" /
  eliminated-by-name / crashed-out with `by:null` / solo), and `shareUrl()` returns origin+pathname
  with the `?session=` param **stripped**.
- [ ] **Given** `tests/effects.test.js`, **When** run, **Then** `getShakeOffset()` decays from ~peak
  magnitude to exactly `{x:0,y:0}` at/after `shake.until`, and `resetEffects()` empties all three
  effect buffers.
- [ ] **Coverage:** `@vitest/coverage-v8` is in `devDependencies`; `vitest.config.js` sets
  `coverage.include = ['public/js/**']`; `npx vitest run --coverage` produces a report; coverage is
  **non-blocking** (no thresholds, not in the blocking CI steps).
- [ ] **Guardrails:** `.eslintrc.json` `globals` updated for any **new** top-level declaration (the
  test files are ESM under the `tests/**` override at `.eslintrc.json:246-250`, so they don't need
  globals; the engine/factory exports add **no** new top-level names, so likely **no globals change**
  — confirm and state which). No `sw.js` `CACHE` bump (no shell-asset change; current value
  `snake-shell-v11`, `sw.js:8`). No PII and no 6-digit session code in any test fixture or log.
- [ ] **CI green:** `npm run lint`, `npm test` (Vitest, including the existing
  `tests/protocol.test.js` jsdom smoke test), and the `node --check` syntax pass
  (`.github/workflows/deploy.yml:32-49`) all succeed.

## 7. Affected files

| File | Change |
| --- | --- |
| `public/js/mp-engine.js` | **Add** a Node-guarded `module.exports` block at EOF (after line 262), exporting the engine functions. Behavior-preserving; inert in browser. |
| `public/js/players.js` | **Add** a Node-guarded `module.exports` block at EOF (after line 91), exporting the factories + helpers. Behavior-preserving; inert in browser. |
| `tests/mp-engine.test.js` | **NEW.** Engine characterization tests (head-on, biter-dies, combo ramp/cap, combo expiry, fruit-respawn, speed ramp) using the `vm.runInContext` harness from `protocol.test.js` and/or injected-dep `require()`. |
| `tests/players.test.js` | **NEW.** Factory tests (3-player roster slots/colors/5-seg snakes, 1-player solo pose, over-cap p6 spawn). |
| `tests/share.test.js` | **NEW.** `buildShareText` three branches + `shareUrl()` strips session/query. |
| `tests/effects.test.js` | **NEW.** `triggerShake`→`getShakeOffset` linear decay + `resetEffects` clears buffers. |
| `vitest.config.js` | **NEW.** Adds `coverage.include = ['public/js/**']`, v8 provider, text+html reporters; no thresholds (non-blocking). |
| `package.json` | Add `@vitest/coverage-v8` to `devDependencies`; optionally add a `"coverage"` script (do **not** wire into blocking CI). |

- **`.eslintrc.json` globals:** **no bump expected** — the new test files are ESM (per the
  `tests/**` override) and the source-file exports introduce no new top-level identifiers. Confirm
  during implementation and update only if a new top-level name is added.
- **`sw.js` `CACHE`:** **no bump** — no shell asset (HTML/CSS/JS-served-to-browser behavior)
  changed; the export blocks are no-ops at runtime.
- **No** `firestore.rules` / `database.rules.json` change.

## 8. Dependencies & sequencing

- **Depends on:** none. The pure helpers it leans on (`logic.js`) already export, and `effects.js`
  / `share.js` already export. The only source edits are additive export blocks.
- **Unblocks / de-risks:** **M4** and **B1** build on the multiplayer engine; these characterization
  tests give them a safety net so they can refactor the global-scope engine without silently
  breaking the death/combo/winner rules. The coverage report also creates a baseline so later
  initiatives can see what is still untested.
- **Sequencing within this task:** land the `module.exports` blocks first (tiny, low-risk), then the
  test files, then the coverage tooling — each step independently CI-verifiable.

## 9. Risks & mitigations

- **Risk: global-scope / load-order minefield.** `players.js:24` reads `gameConfig.maxPlayers` at
  import time, and the engine reads `gameState`, `colors`, `PLAYER_COLORS`, and the `logic.js`
  helpers — a naive `require()` will throw `ReferenceError`. **Mitigation:** use the proven
  `vm.runInContext` harness from `tests/protocol.test.js:32-46` that loads the real scripts in the
  correct order into a shared lexical context, OR inject a mirror `gameConfig` + the exported
  `logic.js` helpers before requiring (Strategy B, §5a). Document which strategy each test uses.
- **Risk: adding `module.exports` accidentally changes browser behavior.** **Mitigation:** the guard
  `typeof module !== 'undefined' && module.exports` is exactly the idiom already shipped in four
  files (`logic.js`, `utils.js`-style, `effects.js:146`, `share.js:134`); in the browser classic
  `<script>` context `module` is undefined, so the block never runs. An acceptance criterion asserts
  the no-op.
- **Risk: stubbing the wrong side-effect leaks a real call into the test** (e.g. real `generateFood`
  mutating shared `gameState.food` non-deterministically via `Math.random`). **Mitigation:** stub
  `generateFood`, `spawnFoodBurst`, `playFoodSound`, `triggerShake`, and the `mpUiHook`/`mpNetHook`
  targets as no-ops/spies; assert on engine-mutated state, not on the stubs' internals. Where
  randomness is unavoidable, stub `Math.random`/`Date.now`.
- **Risk: time-dependent flakiness** in combo/shake tests (`Date.now`). **Mitigation:** use
  `vi.useFakeTimers()` / `vi.setSystemTime()` or a `Date.now` spy so the clock is deterministic —
  no real waits, matching protocol.test.js's synchronous style.
- **Risk: `eslint` `tests/**` strictness.** The override sets `sourceType: module`
  (`.eslintrc.json:246-250`); ESM imports are fine, but new test globals are not auto-declared.
  **Mitigation:** keep tests self-contained (import what they use); run `npm run lint` in CI to catch
  it.
- **Risk: coverage tooling drags CI or breaks install.** **Mitigation:** coverage is opt-in
  (`--coverage`), not in the blocking steps; `@vitest/coverage-v8` version must match the installed
  `vitest@^1.6.0` (`package.json:23`) to avoid a peer-dep mismatch — pin a compatible `^1.6.0` line.

## 10. Verification / test plan

Given the no-local-Node, CI-bound constraint, verification is **almost entirely Vitest in CI** —
which is the right tool here (these are pure-logic unit tests, the exact category CI already runs):

1. **Vitest (CI, primary):** push the branch; the blocking `npm test` step
   (`.github/workflows/deploy.yml:35-36`) runs all suites. The four new files must pass alongside the
   existing `logic`/`utils`/`protocol` suites. The protocol jsdom smoke test must **stay green** —
   the export-block edits to `mp-engine.js`/`players.js` must not perturb the classic-script load
   (those files aren't even in protocol.test.js's `SCRIPTS` list at `:24-27`, but the global scope
   they share must remain intact).
2. **Lint (CI):** `npm run lint` (`deploy.yml:32-33`) must pass — confirms no undeclared globals and
   that the ESM test files satisfy the `tests/**` override.
3. **`node --check` (CI):** the syntax pass (`deploy.yml:38-49`,
   `git ls-files 'public/js/*.js' | xargs -n1 node --check`) must pass for the edited
   `mp-engine.js`/`players.js` — proves the new export blocks are syntactically valid.
4. **Coverage (local/opt-in, non-blocking):** run `npx vitest run --coverage` and read the
   text/html report to confirm `mp-engine.js` and `players.js` go from 0% to substantially covered,
   and `share.js`/`effects.js` gain coverage. This is reporting-only; it must not gate CI.
5. **No Claude_Preview / no scratch Firebase project / no rules emulator needed** — this change
   touches no UI, no transport, and no security rules. (Contrast with rules work, which would need
   the emulator on a scratch project per `.agent/workflows/deploy.md`.)

## 11. Analytics & observability

N/A for runtime analytics — this is test-and-export scaffolding with **no** new user-facing event or
funnel step, so no new `trackEvent()` call is warranted (adding one would be noise). The engine's
existing instrumentation is **left untouched**: `mp_game_start` (`mp-engine.js:28`), `mp_elimination`
(`mp-engine.js:176`), `mp_game_over` (`mp-engine.js:210-213`), and `share` (`share.js:88-91`). The
tests should **stub `trackEvent` to a no-op/spy** so they neither emit real events nor depend on its
hardened no-op behavior — and may optionally **assert** that, e.g., `mp_game_over` fires with
`winner_score` and **no PII / no session code** (per the comment at `mp-engine.js:212`), which doubles
as a regression guard on the "never log the code/PII" rule. The "observability" deliverable of this
initiative is the **coverage report** itself: a baseline measurement of how much of `public/js/**` is
exercised, surfaced via `vitest run --coverage`.
