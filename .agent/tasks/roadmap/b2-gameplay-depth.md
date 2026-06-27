# B2 · Gameplay depth: escalating difficulty, meaningful combo, modes & variety

> **Tier** big-bet · **Focus** Fun · **Impact** High · **Effort** L (multi-day) · **Priority** 50/100
> **Status** `Not started` · **Depends on** B1 (Phase 1 = Q4; Phases 2–3 gated by B1's solo/multi shared-engine work) · **Part of** [Roadmap](./README.md)

## 1. Problem — what we're solving

The game is fun for ~30 seconds and then nothing changes. Four concrete, verified causes:

1. **The difficulty curve flatlines.** Base speed ramps by `speedIncrease: 0.06` per food
   (`config.js:77`) from `baseSpeed: 2.0` (`config.js:75`) up to `maxSpeed: 4` (`config.js:78`).
   That cap is reached after `(4 − 2) / 0.06 ≈ 33` food. The ramp lives in `moveSnake()`
   (`game.js:333-336`) and its multiplayer twin `applyFoodEaten()` (`mp-engine.js:145-148`); both
   `Math.min(maxSpeed, …)` clamp, so **after ~33 food the game is mechanically static** — same speed,
   same turn radius (turn rate is speed-coupled via `speedToTurnStep`, `logic.js:65-68`), same board.
2. **Self-collision is nearly impossible, so deaths are monotonous wall-taps.**
   `minSelfCollisionSegments: 8` (`config.js:83`) means the first 8 segments never count
   (`hitsSelf` → `hitsSnake(head, snake, 8, …)`, `logic.js:111-113`), and the snake grows only **one
   segment per food** (`addSnakeSegment()` → `growTail`, `game.js:351-354`, `logic.js:218-240`) on a
   600×600 board (`config.js:72`). Reaching a body long enough to cross itself takes dozens of food;
   in practice **almost every death is a wall hit** (`hitsWall`, `logic.js:76-81`, called at
   `game.js:287`).
3. **The combo is score-only — no risk/reward, and streaks are luck, not skill.** Eating within
   `comboWindowMs: 4500` (`config.js:86`) raises a multiplier capped at `maxCombo: 6` (`config.js:87`)
   that **only multiplies score** (`gained = 10 * multiplier`, `game.js:315-317`;
   `mp-engine.js:131-133`). Food spawns at a uniformly random position (`generateFood`,
   `game.js:361-391`), so whether you can *keep* a streak is down to where the next fruit lands, not
   how well you play. There is no decision, no tension — just a draining yellow badge
   (`updateComboDisplay`, `game.js:550-562`; `#combo-display`, `index.html:126-129`).
4. **Zero modes, power-ups, obstacles, or food variety.** A codebase-wide search for power-up /
   obstacle / hazard / golden / time-attack / game-mode concepts returns **nothing**. There is one
   loop, one fruit (`gameState.food`, single object — `state.js:36-39`), one win condition
   (solo: `gameOver()`, `game.js:579`; multi: last-snake-standing, `resolveWinner`,
   `logic.js:253-262`). The arena has no rematch flow and no per-session tally — every round ends
   cold at the end screen (`endMultiplayerGame`, `mp-engine.js:194-214`).

Net effect: the single biggest driver of short sessions. Once `maxSpeed` is hit there is nothing
left to chase, and the death you get is a boring one.

## 2. Why it matters

**Focus: Fun.** This is the highest-leverage initiative for session length and "one more go"
retention — exactly what we need before pushing the live demo
(https://go-console-84748.web.app/) to real users. The current game teaches a player everything it
has to offer in the first ~30 seconds; depth is what converts a 30-second curiosity into a
multi-round session and a sharable score. Phase 1 (juice scaling with combo + milestone toasts)
ships **early as part of Q4** and is pure upside: more feedback, more reason to chase the streak, no
new failure modes. Phases 2–3 add the actual *decisions* (when to grab the timed golden fruit, when
to spend a power-up, whether to risk a long body) that make the score feel earned. The arena
rematch + win tally turns a one-and-done party trick into a repeatable competition.

## 3. Goals

- **Phase 1 (= Q4, ship early, solo + multi):** juice intensity scales with the combo multiplier,
  and in-run **milestone toasts + sounds** fire at score/length thresholds — visible progress even
  while the speed is capped. Zero new death modes; no balance change.
- **Phase 2 (gated by B1):** the body matters again — grow **2–3 segments per food** and lower the
  self-collision threshold once the snake is long, so self-collision becomes a real (but gentle)
  death. Add a **second difficulty axis past the speed cap** (a slowly shrinking safe margin OR a
  drifting hazard) so escalation continues after ~33 food. Ship **ONE new mode** (60-second Time
  Attack reusing the existing loop) and **one item class** (a rare, timed "golden" fruit reusing
  `generateFood` + the score path).
- **Phase 3 (gated by B1):** **power-ups** (magnet / slow-mo / shield) as timed pickups, a
  **per-session win tally** for the arena, and a **one-tap rematch** that re-runs the same roster.
- **Casual-safe throughout:** all escalation is *gentle* and tunable from `gameConfig`; defaults keep
  a first-timer alive about as long as today.
- **Both engines stay in lockstep:** every gameplay change lands in `game.js` (solo) **and**
  `mp-engine.js` (multi), or it lands after B1 unifies the shared step — never one engine only.

## 4. Non-goals

- **Not** changing the control scheme (continuous-radian analog joystick, speed = push magnitude) —
  `joystickToControl` (`logic.js:135-145`) is untouched.
- **Not** adding a leaderboard for the new solo mode in this initiative (Time Attack is a personal-
  best loop only; the global leaderboard stays the classic-mode concern — `submitGlobalScore`,
  `game.js:631-652`). A Time-Attack global board can be a later follow-up.
- **Not** a level editor, no maps/biomes, no asset files (we stay canvas-primitive only, like
  `effects.js`).
- **Not** networked power-up *pickups synced as authoritative state across phones* beyond what the
  desktop host already broadcasts — the desktop remains the single simulation authority; phones
  stay dumb joysticks (per architecture). New shared state piggybacks on the existing host→phone
  feedback channel, not new authority on the phone.
- **Not** raising `maxPlayers` (`config.js:102`) — orthogonal.
- **Not** over-building. Ship phase by phase; each phase is independently mergeable and CI-green. Do
  **not** implement Phase 2/3 mechanics into only one engine ahead of B1.

## 5. Proposed solution

The work splits into three independently-shippable phases. Phase 1 is Q4 and has **no B1
dependency** (it touches only juice + a read-only milestone watcher). Phases 2–3 change core
simulation in two engines, so they are **gated by B1** (which unifies the solo/multi step) to avoid
the two engines diverging — see §8.

### Phase 1 — Combo-scaled juice + milestone toasts (Q4, solo + multi)

- **Scale juice with the combo.** Today `spawnFoodBurst` always emits `count = 10` particles
  (`effects.js:27`) and a fixed `maxR: 34` ripple (`effects.js:40`); `triggerShake` is only used on
  crash (`game.js:586`, `mp-engine.js:168`). Add an **optional `intensity` arg** to `spawnFoodBurst`
  / `triggerShake` (default = current values, so existing call sites are byte-for-byte unchanged) and
  pass `intensity = f(multiplier)` from the two eat paths (`game.js:321-327`,
  `mp-engine.js:135-140`): more particles, a wider ripple, and a tiny screen-kick at high combo.
  Reuse the existing analytic, frame-rate-independent integration in `effects.js` — no new render
  pass.
- **Combo-scaled sound** is already half-done: `playFoodSound(multiplier)` rises in pitch
  (`sound.js:51-54`). Add a **milestone sting** (a distinct `playTone` call, `sound.js:27-45`) when a
  threshold is crossed — synthesized, no asset.
- **In-run milestone toasts.** Add a small `checkMilestones(score, length)` watcher called from the
  solo eat block (`game.js:317`, after `score` updates) and the multi eat block
  (`mp-engine.js:133`). When score crosses a `gameConfig.milestones` threshold (e.g. 100 / 250 /
  500 / 1000) or the snake reaches a length tier, surface a **floating toast**. Reuse
  `spawnScorePop(x, y, text, color)` (`effects.js:50-52`) — it already renders rising/fading Orbitron
  text in the board's logical coords and is called from both engines — rather than adding DOM. (A
  DOM toast would have to be wired into both the solo HUD and the MP scoreboard; the canvas pop is
  engine-shared for free.) Track "already fired this run" on `gameState` (reset in `startGame`
  `game.js:163-165` / `restartGame` via `createInitialGameState` `state.js:47-50` / per-player or
  per-round for multi) so each milestone fires once.
- **No new config beyond a `milestones` array + a `comboJuice` toggle/curve.** Keep them in
  `gameConfig` (`config.js:71-103`) next to the existing combo tunables (`config.js:85-87`).

### Phase 2 — Make the body matter + a second difficulty axis + Time Attack + golden fruit (gated by B1)

- **Grow 2–3 segments per food.** `addSnakeSegment()` (`game.js:351-354`) calls `growTail` once;
  multi calls it once at `mp-engine.js:143`. Make growth a `gameConfig.growthPerFood` count and loop
  `growTail` (`logic.js:218-240`) that many times in **both** engines. Keep the default modest (2)
  so casual runs aren't punished.
- **Lower self-collision once long.** Replace the constant `minSelfCollisionSegments: 8`
  (`config.js:83`, consumed by `hitsSelf` `logic.js:111-113`) with a length-aware skip: a new pure
  helper in `logic.js` (e.g. `selfCollisionSkip(length, config)`) returns 8 for short snakes and
  ramps **down** (never below a floor) as the body grows — so a long snake can finally cross itself.
  Pure + exported, unit-tested in `tests/logic.test.js` alongside the existing `hitsSelf` tests.
  Wire it into `moveSnake` (`game.js:294`) and `movePlayer` (`mp-engine.js:105`) identically.
- **Second difficulty axis past the speed cap** — pick ONE, behind a `gameConfig` flag, default
  gentle:
  - *Shrinking safe margin:* grow an effective `wallMargin` over time/score so the playable box
    slowly contracts. `hitsWall` (`logic.js:76-81`) already reads `config.wallMargin`; the render
    boundary (`game.js:472-478`) and `generateFood` margin (`game.js:365`) read it too — thread a
    per-run `gameState.effectiveWallMargin` (defaulting to `gameConfig.wallMargin`) through all three
    so the box visibly tightens. **Both engines.**
  - *Drifting hazard:* a slow-moving obstacle the head must avoid (`hitsWall`-style point check),
    drawn as a canvas primitive in `renderGame` (`game.js:457-534`) and the multi render
    (`game.js:481-488`). New `gameState.hazards` array; collision checked in both `moveSnake` and
    `movePlayer`.
  - Default the chosen axis to "off until score N" so the first minute is unchanged.
- **Time Attack mode (solo, reuses the loop).** Add `gameState.mode === 'timeattack'` as a third
  branch in `updateGame` (`game.js:212-234`) that runs the **same** `updateSnakeDirection` /
  `moveSnake` step but ends the run when a `gameConfig.timeAttackMs` (60 000) countdown expires
  (calls the existing `gameOver()`, `game.js:579`). Surface the countdown via a new HUD element near
  the score card (`index.html:159-167`) and/or a canvas readout. Wall/self collision still ends the
  run early. Mode is chosen on the desktop before start (a toggle in the desktop view) and recorded
  via `trackEvent`. The classic-mode leaderboard path stays gated on `mode === 'solo'` so Time Attack
  does **not** pollute the global board (per §4).
- **Golden fruit (one item class, reuses `generateFood` + the score path).** Occasionally
  (`gameConfig.goldenChance`) the spawned fruit is "golden": worth more and **timed** (despawns after
  `gameConfig.goldenTtlMs`, reverting to a normal spawn). Extend the single `gameState.food` object
  with a `kind` (`'normal' | 'golden'`) rather than a second food list — `generateFood`
  (`game.js:361-391`) already picks the position; tag the kind there. The eat path
  (`eatsFood` `logic.js:122-125` → score block `game.js:305-337` / `mp-engine.js:118-152`) reads
  `kind` for the score and a gold-tinted `spawnFoodBurst` / `spawnScorePop`. Render the gold pulse in
  `renderGame` (`game.js:490-498`) using `colors.food` brightened. **Both engines** (the multi fruit
  is the same `gameState.food`, `mp-engine.js:142`).

### Phase 3 — Power-ups + arena win tally + one-tap rematch (gated by B1)

- **Power-ups (magnet / slow-mo / shield)** as rare timed pickups, modeled like golden fruit: a
  `gameState.powerups` array of `{x, y, kind, born}`, point-collision-checked in both engines' move
  step, granting a timed effect tracked per-snake (`player.effects` / `gameState.effects` with an
  `until` timestamp, decayed the same analytic way `effects.shake` decays, `effects.js:67-75`):
  - *magnet* — pull nearby fruit toward the head (a vector nudge in the move step).
  - *slow-mo* — temporarily lower `currentSpeed` (or scale `movementUpdateMs`).
  - *shield* — survive the next wall/self/bite once (consume the flag instead of `gameOver` /
    `eliminatePlayer`).
  Pickups + active effects render as canvas primitives; the host broadcasts a per-slot haptic on
  pickup via the **existing** `sendHapticFeedbackTo(slot, type)` channel (`mp-net.js:117-127`) —
  **no new transport, no new authority on the phone**.
- **Per-session win tally (arena).** Accumulate wins per slot across rounds in a host-side object
  (e.g. `mpSession`, `state.js:73-79`) and render it in the MP scoreboard / end screen (mp-ui.js
  via the existing `mpUiHook('updateMpScoreboard')` / `renderMpEndScreen`, `mp-engine.js:174,208`).
  Persisted only for the session lifetime; no Firestore schema change required if it rides the
  existing results doc, but prefer host-local memory to avoid new writes.
- **One-tap rematch (arena).** The end screen gets a "Rematch" affordance that re-runs the **same
  roster** via the existing `mpStartRound()` (`mp-net.js:41-56`) / `startMultiplayerGame(roster)`
  (`mp-engine.js:16-29`) path — no new lifecycle, just a UI button + key already handled by
  `mpHandleDesktopStartKey` (`game.js:75-79`, `mp-net.js:25-28`). Phones can also trigger it through
  the existing per-slot `restart` action (`mp-net.js:31-38`).

**Both-transports / both-modes note.** No phase changes the *transport*: joystick still flows over
RTDB `controllers/{code}`, actions/state over Firestore `sessions/{code}`, with the localStorage
fallback unchanged — new gameplay state (golden `kind`, hazards, power-up effects, win tally) lives in
**host-side `gameState`/`mpSession`** and reaches phones only through the existing host→phone feedback
channel (`sendHapticFeedbackTo`, `publishMpResults`). Every simulation change is mirrored in **both**
the solo (`game.js`) and multi (`mp-engine.js`) engines — the explicit risk called out in the brief
("modes diverge"). New pure math goes in `logic.js` and is unit-tested.

## 6. Acceptance criteria

### Phase 1 (Q4)
- [ ] **Given** a player eats with combo multiplier `m`, **When** the eat juice fires, **Then**
  `spawnFoodBurst` / ripple intensity scales up with `m` (more particles / wider ring at high combo)
  **and** with `m === 1` the burst is identical to today's (default arg path unchanged) — verified by
  unit-asserting the particle count for `intensity` undefined vs a high value.
- [ ] **Given** the snake crosses a `gameConfig.milestones` score threshold during a run, **When**
  the eat resolves, **Then** exactly one floating toast (via `spawnScorePop`) and one milestone sting
  (via `playTone`) fire for that threshold, and re-crossing in the same run does **not** re-fire it.
- [ ] **Given** a fresh `startGame()` / `restartGame()` / multiplayer round, **When** it begins,
  **Then** the per-run "milestones already fired" set is reset (no stale toasts from the previous
  run).
- [ ] Milestone toasts fire in **both** solo (`game.js`) and multi (`mp-engine.js`) eat paths.
- [ ] Phase 1 adds **no new death mode** and does **not** change `speedIncrease`, `maxSpeed`,
  `comboWindowMs`, or `maxCombo` defaults.

### Phase 2
- [ ] **Given** `gameConfig.growthPerFood = 2`, **When** a snake eats once, **Then** its length grows
  by exactly 2 segments in **both** engines (solo `addSnakeSegment`, multi `applyFoodEaten`).
- [ ] **Given** a long snake, **When** `selfCollisionSkip(length, config)` is evaluated, **Then** it
  returns 8 for short snakes and a smaller (floored) value once the body is long — pure, exported,
  and unit-tested in `tests/logic.test.js`; wired identically into `moveSnake` and `movePlayer`.
- [ ] **Given** a run past the chosen escalation trigger (score N), **When** time/score advances,
  **Then** the second difficulty axis engages (box visibly contracts **or** the hazard appears),
  the change is reflected in `hitsWall`/render/`generateFood` consistently, and it is **off** before
  the trigger so the first minute is unchanged. Applies in **both** engines.
- [ ] **Given** Time Attack selected, **When** the run starts, **Then** a 60 s
  (`gameConfig.timeAttackMs`) countdown is shown and the run ends via `gameOver()` at 0; a wall/self
  hit still ends it early; **and** Time-Attack runs do **not** submit to the global leaderboard
  (leaderboard path stays gated on `mode === 'solo'`).
- [ ] **Given** `gameConfig.goldenChance`, **When** a golden fruit spawns, **Then** it renders gold-
  bright, is worth more on eat, despawns to a normal fruit after `gameConfig.goldenTtlMs` if
  uneaten, and works in **both** engines using the single `gameState.food` object (a `kind` field, not
  a second food list).
- [ ] `selfCollisionSkip` and any new pure helpers are exported from `logic.js` and covered in
  `tests/logic.test.js`; the new MP behaviors (growth count, golden score) are covered in
  `tests/mp-engine.test.js` (the suite added by M6, if landed) or via the `vm.runInContext` harness.

### Phase 3
- [ ] **Given** a power-up pickup, **When** the head collects it, **Then** the matching timed effect
  (magnet / slow-mo / shield) activates for `gameConfig.powerupMs`, decays to off, and behaves
  identically in **both** engines (shield consumes one death instead of ending the run).
- [ ] **Given** an arena round ends, **When** the end screen renders, **Then** the per-session win
  tally increments for the winner and is shown in the scoreboard/end screen via the existing
  `mpUiHook` calls — with **no** new Firestore write schema (host-local memory).
- [ ] **Given** the arena end screen, **When** "Rematch" is tapped (or Space/Enter on desktop),
  **Then** the **same roster** restarts via the existing `mpStartRound()`/`startMultiplayerGame`
  path with no new lifecycle code.

### Guardrails (all phases)
- [ ] `.eslintrc.json` `globals` updated for **every** new top-level function / `let` / `const` added
  to `public/js/*` (e.g. `selfCollisionSkip`, `checkMilestones`, any new state field accessor) — CI
  `no-undef` is the gate.
- [ ] New pure logic is added to `logic.js` with a matching `module.exports` entry
  (`logic.js:264-282`) and a unit test; side-effecting helpers stay stubbable (juice/sound behind
  named functions, per `effects.js` / `sound.js`).
- [ ] No PII and no 6-digit session code logged or sent in any new event/state (re comment
  `mp-engine.js:212`); new `trackEvent` calls route through the hardened wrapper (`utils.js`).
- [ ] If any shell asset (HTML/CSS/JS served to the browser, or new UI markup in `index.html` / a new
  CSS file) changes, bump `const CACHE` in `sw.js` (currently `'snake-shell-v11'`, `sw.js:8`).
- [ ] `npm run lint`, `npm test` (Vitest, incl. `tests/protocol.test.js`), and the `node --check`
  syntax pass are all green before merge.
- [ ] Each phase is its own PR; Phase 2/3 PRs change **both** `game.js` and `mp-engine.js` (or land
  after B1) — a reviewer can confirm no single-engine drift.

## 7. Affected files

| File | Change |
| --- | --- |
| `public/js/config.js` | **Add** tunables to `gameConfig` (`config.js:71-103`): `milestones[]`, combo-juice curve, `growthPerFood`, self-collision floor, the escalation-axis flag + trigger, `timeAttackMs`, `goldenChance`/`goldenTtlMs`/golden score, power-up rates/durations. No change to existing combo/speed defaults in Phase 1. |
| `public/js/logic.js` | **Add** pure helpers (e.g. `selfCollisionSkip(length, config)`, a golden-score helper, hazard/margin math) + matching `module.exports` entries (`logic.js:264-282`). Existing `hitsSelf`/`hitsWall` consumers re-point to the new skip. |
| `public/js/game.js` | Solo engine: combo-scaled juice at the eat block (`:321-327`); milestone watcher after score update (`:317`); multi-segment growth (`:351-354`); length-aware self-collision (`:294`); second difficulty axis (`hitsWall` margin / hazard at `:287`, render `:472-478`/`:490-498`); Time-Attack branch in `updateGame` (`:212-234`) + countdown HUD + leaderboard gate; golden-fruit `kind` in `generateFood` (`:361-391`) + eat/render; Phase 3 power-up pickups/effects. |
| `public/js/mp-engine.js` | Multi engine: mirror **every** Phase 2/3 simulation change — combo-scaled juice (`:135-140`), growth (`:143`), self-collision (`:105`), difficulty axis (`:104`), golden fruit (`:118`,`:142`), power-ups, plus the milestone watcher (`:133`) and arena win tally / rematch wiring (`:174`,`:194-214`). |
| `public/js/effects.js` | Add optional `intensity` arg to `spawnFoodBurst` (`:24-41`) and `triggerShake` (`:59-61`), default = current behavior. Update `module.exports` only if signatures/new exports require it. |
| `public/js/sound.js` | Add a milestone "sting" via `playTone` (`:27-45`); optional golden/power-up cues. New top-level funcs → eslintrc globals. |
| `public/js/mp-ui.js` | Render the per-session win tally + "Rematch" affordance in the MP scoreboard / end screen (Phase 3), driven by existing `mpUiHook` calls. |
| `public/js/mp-net.js` | (Phase 3, if needed) reuse `sendHapticFeedbackTo` for power-up pickup buzz; no new doc schema. |
| `public/js/state.js` | Extend `createInitialGameState()` (`:29-52`) with new per-run fields (milestone set, `effectiveWallMargin`, golden/hazard/power-up state) so solo + restart share one shape; per-player fields go in `createPlayer` (`players.js:36-58`); win tally on `mpSession` (`:73-79`). |
| `public/index.html` | **New** HUD markup: Time-Attack countdown near the score card (`:159-167`), a mode toggle in the desktop view, Rematch button in the MP end screen (`:150`). |
| `public/css/desktop.css` / `multiplayer.css` | Styling for the countdown, mode toggle, win tally, Rematch button. Reuse existing tokens/patterns (e.g. the `#combo-display` styling at `desktop.css:579-625`, `mp-center-hint` / `mp-scoreboard`). |
| `tests/logic.test.js` | **Add** cases for `selfCollisionSkip` and any new pure helpers. |
| `tests/mp-engine.test.js` | **Add** (or extend, if M6 landed) cases for multi growth count, golden score, milestone firing in the multi path. |
| `.eslintrc.json` | **Bump `globals`** for every new top-level decl (`selfCollisionSkip`, `checkMilestones`, new sound funcs, etc.). CI fails otherwise. |
| `public/sw.js` | **Bump `CACHE`** (`:8`, `'snake-shell-v11'`) whenever `index.html`/CSS/JS shell assets change in a phase. |

## 8. Dependencies & sequencing

- **Phase 1 ships as part of Q4 and has no B1 dependency** — it only adds juice scaling (additive
  optional args, default-unchanged) and a read-only milestone watcher. Land it first.
- **Phases 2 and 3 are gated by B1.** B1 (Phase 1 = Q4 per the brief) unifies / shares the solo and
  multi step so that core-simulation changes can be applied **once** instead of being hand-mirrored
  across `game.js` and `mp-engine.js`. The brief's hard constraint — *"Any solo+MP gameplay change
  must be applied to BOTH engines or land after B1, or the modes diverge"* — means: do Phase 2/3
  **after** B1, or, if a piece must precede B1, implement it in **both** engines in the same PR.
- **De-risked by M6** (multiplayer engine + factory unit tests). If M6 has landed, Phase 2/3 can lean
  on `tests/mp-engine.test.js` / `tests/players.test.js` as a regression net for the growth/golden/
  collision changes; if not, use the `vm.runInContext` harness from `tests/protocol.test.js:32-46`.
- **Within this initiative:** Phase 1 → (B1) → Phase 2 (body + axis + Time Attack + golden) → Phase 3
  (power-ups + tally + rematch). Each phase is its own CI-green PR.
- **Unblocks:** richer Fun roadmap items (e.g. a Time-Attack global leaderboard, daily-challenge
  seeds) and gives multiplayer real replay value.

## 9. Risks & mitigations

- **Global-scope / load-order minefield (the big one).** Every new top-level function and `let`/`const`
  in `public/js/*` is a shared global and **must** be added to `.eslintrc.json` `globals`
  (`:6-240`) or CI `no-undef` fails — that failure is the feature. New files (if any) must be slotted
  at the correct point in the `index.html` `<script>` order. **Mitigation:** prefer adding pure
  helpers to the already-loaded `logic.js` (early in the order) and gameplay wiring to the existing
  `game.js` / `mp-engine.js`; update the globals list in the same commit; keep new optional args
  default-valued so no call site breaks.
- **Solo/multi divergence.** The brief's named risk. **Mitigation:** the §6 acceptance criteria
  require Phase 2/3 simulation changes to touch **both** engines in one PR (or land after B1);
  reviewers verify by diffing `game.js` against `mp-engine.js` for parity. Pure math centralized in
  `logic.js` is shared by construction.
- **Over-building / scope creep.** **Mitigation:** phase gates; each phase independently mergeable;
  Phase 1 alone is a real win and can ship without the rest.
- **Balance regressions for casual players.** New escalation could make the game harder for
  first-timers. **Mitigation:** every new mechanic is `gameConfig`-tunable and defaults gentle
  (growth 2 not 3; second axis off until score N; self-collision floor keeps short snakes safe);
  verify via Claude_Preview that a first minute feels ~unchanged.
- **Adding optional args to `effects.js` changes existing callers.** **Mitigation:** default the new
  `intensity` param to today's constants so every existing call site (`game.js:322`,
  `mp-engine.js:135`, crash bursts) behaves byte-for-byte the same; unit-assert the default path.
- **`module.exports` / browser parity.** New pure helpers in `logic.js` must be added to its
  Node-guard export block (`logic.js:264-282`) **and** the eslint globals; forgetting either breaks
  tests or lint. **Mitigation:** mirror the existing idiom exactly; an acceptance criterion checks it.
- **PWA staleness.** New shell markup/CSS won't reach installed users until `CACHE` is bumped.
  **Mitigation:** bump `sw.js` `CACHE` in any phase that touches `index.html`/CSS/JS (criterion in §6).
- **Sync write amplification (Phase 3).** Power-up pickups must **not** add per-frame Firestore/RTDB
  writes. **Mitigation:** reuse the event-driven `sendHapticFeedbackTo` channel (`mp-net.js:117-127`);
  win tally is host-local memory; no new doc schema.

## 10. Verification / test plan

No local Node — verification is CI-bound + Claude_Preview, matched to each change type:

1. **Vitest (CI, primary for pure logic).** New/changed pure helpers in `logic.js`
   (`selfCollisionSkip`, golden-score, hazard/margin math) get unit tests in `tests/logic.test.js`
   (pattern at `tests/logic.test.js:1-30`). Multi-engine behaviors (growth count, golden score,
   milestone firing) get tests in `tests/mp-engine.test.js` (M6 suite) or the `vm.runInContext`
   harness (`tests/protocol.test.js:32-46`). `npm test` is blocking in CI
   (`.github/workflows/deploy.yml`).
2. **`node --check` (CI).** The syntax pass over `public/js/*.js` must pass for every edited file
   (proves the new branches/args parse).
3. **Lint (CI).** `npm run lint` proves the eslintrc `globals` list was updated for every new
   top-level decl (no `no-undef` errors) — the primary guardrail for this global-scope codebase.
4. **python http.server + Claude_Preview (visual / feel).** For the juice scaling, milestone toasts,
   Time-Attack countdown, golden fruit, hazard/shrink, power-ups, win tally, and Rematch — serve
   `public/` and eval/snapshot. **Unregister the SW + clear caches first** (network-first SW serves
   stale assets locally). Force the controller view with `?session=123456` in a second tab to drive
   multi/solo paths. Verify casual feel (first minute ~unchanged) and that combo `m === 1` juice
   matches today.
5. **Manual two-tab / two-device for multiplayer (Phase 3 + rematch).** Confirm power-up pickups,
   per-slot haptic over the existing feedback channel, win tally increment, and one-tap rematch
   reusing the same roster — desktop host + ≥2 phone tabs.
6. **No production `firebase deploy` by hand.** Phases add no rules change; if any phase ever needs a
   rules tweak, test on a scratch project per `.agent/workflows/deploy.md` — but none is anticipated
   (new state is host-local / rides existing schema).

## 11. Analytics & observability

All new events route through the hardened `trackEvent()` (`utils.js`) — no-ops offline, never throws,
auto-tags `device_role`; **never** log the 6-digit code or PII (re `mp-engine.js:212`). Proposed
events:

- **Phase 1:** `milestone_reached` `{ milestone, mode }` (which thresholds players actually hit in a
  run — directly measures whether depth is extending sessions). Existing `game_over`/`post_score`
  (`game.js:613-614`) already carry final score.
- **Phase 2:** `mode_select` `{ mode: 'classic' | 'timeattack' }`; `golden_eaten` `{ mode }`;
  `time_attack_finish` `{ score }`. These reveal mode adoption and whether golden fruit is being
  chased.
- **Phase 3:** `powerup_pickup` `{ kind }`; `powerup_used` `{ kind }` (esp. shield consumed);
  `arena_rematch` `{ players }`; reuse existing `mp_game_over` (`mp-engine.js:210-213`) for round
  outcomes — rematch count per session is the key retention signal.
- **Watch in GA4:** average milestones per run (proxy for session depth), Time-Attack vs Classic
  split, rematch rate per arena session, golden/power-up engagement. These tell us if "gameplay
  depth" actually moved session length — the whole point of the initiative.
