# Q4 · Combo-scaled juice + in-run milestone moments

> **Tier** quick-win · **Focus** Fun · **Impact** High · **Effort** S (hours) · **Priority** 86/100
> **Status** `Not started` · **Depends on** none (Phase 1 of [B2](./b2-gameplay-depth.md)) · **Part of** [Roadmap](./README.md)

## 1. Problem — what we're solving

Skilled play produces no visible payoff during a run. Three verified causes:

1. **A high-combo eat looks identical to a x1 eat.** The eat juice is fixed-size regardless of the
   streak. `spawnFoodBurst()` always emits `count = 10` particles (`public/js/effects.js:27`) at a
   fixed speed band (`public/js/effects.js:29`) and always pushes a `maxR: 34` ripple of `ttl: 380`
   (`public/js/effects.js:40`). Both the solo eat block (`public/js/game.js:322`) and the
   multiplayer twin (`public/js/mp-engine.js:135`) call `spawnFoodBurst(foodX, foodY, colors.food)`
   with **no intensity argument** — so a x6 streak bite throws exactly the same 10 particles and the
   same ring as the very first bite. The only combo-aware feedback today is the score-pop label
   (`+${gained} x${multiplier}`, `public/js/game.js:324`, `public/js/mp-engine.js:138`) and the
   ascending food pitch in `playFoodSound(step)` (`public/js/sound.js:51-54`).

2. **Screen-shake fires only on death.** `triggerShake()` (`public/js/effects.js:59-61`) is invoked
   in exactly two places, both terminal: the solo crash (`triggerShake(9, 340)`,
   `public/js/game.js:585`) and a multiplayer elimination (`triggerShake(9, 340)`,
   `public/js/mp-engine.js:168`). A grep for `triggerShake(` across `public/js/` returns only those
   two call sites plus the definition. There is **zero** kinetic feedback for a great eat — the most
   skillful, highest-scoring moment in the run produces no kick at all.

3. **Nothing marks progress mid-run.** There is no concept of a milestone, threshold, or in-run
   toast anywhere in the codebase. The combo badge (`#combo-display`, `public/index.html:126-129`;
   `updateComboDisplay()`, `public/js/game.js:550-562`) is a draining yellow indicator only — and in
   multiplayer it is **hidden entirely** (`hideSoloHud()`, `public/js/mp-engine.js:237-242`). Score
   climbs silently in the HUD; the player crosses 100, 250, 500, 1000 with no acknowledgement. The
   game-feel payoff for sustained skilled play is invisible.

Net effect: the reward loop that *should* make a streak feel earned is flat. A player who strings
together a x6 combo gets the same sensory feedback as someone tapping randomly, which under-sells the
one mechanic (the combo) the game already has — and flattens the "one more go" engagement we need
before pushing the live demo to real users.

## 2. Why it matters

**Focus: Fun.** This is the cheapest, lowest-risk slice of [B2 (gameplay depth)](./b2-gameplay-depth.md)
— its **Phase 1**, which B2 explicitly scopes to ship early as Q4 (`b2-gameplay-depth.md:54`,
`b2-gameplay-depth.md:89-118`). It is **pure additive juice**: more feedback, more reason to chase
the streak, and **no new failure mode, no balance change** (no touch to `speedIncrease`, `maxSpeed`,
`comboWindowMs`, or `maxCombo`). The game currently teaches a player everything it has to offer in
~30 seconds; making the combo *feel* like an achievement — particles that bloom, a satisfying kick at
a high streak, a milestone toast + sting as the score climbs — is exactly the kind of low-cost,
high-impact polish that converts a curious visitor on the live demo
(https://go-console-84748.web.app/) into a player who plays a second round. It also de-risks B2's
larger Phase 2/3 by proving the milestone/juice plumbing in both engines first.

## 3. Goals

- **Eat juice scales with the combo multiplier** in **both** engines: more (and faster) particles and
  a wider ripple as the streak climbs, plus a tiny screen-shake at combo **x3+** and a brighter flash
  / kick at **`maxCombo`** — while a **x1 eat stays byte-for-byte identical to today**.
- **In-run milestone moments**: when the score (or, optionally, snake length) crosses a configured
  threshold during a run, surface a **floating toast** (reusing `spawnScorePop`) plus an **ascending
  milestone sting** (a distinct `playTone` call) — extending the existing pattern where food pitch
  already rises with the combo.
- **Each milestone fires exactly once per run**, and the "already fired" set is **reset** on every
  fresh `startGame()` / `restartGame()` / multiplayer round.
- **Both engines stay in lockstep**: every change lands in the solo eat path (`game.js`) **and** the
  multiplayer eat path (`mp-engine.js`) in the same PR — honoring the brief's caveat that the eat/combo
  path must not diverge.
- All new behavior is **`gameConfig`-tunable** and defaults gentle (juice scaling and milestone
  thresholds live next to the existing combo knobs).

## 4. Non-goals

- **Not** changing any gameplay balance: `speedIncrease` (`config.js:77`), `maxSpeed`
  (`config.js:78`), `comboWindowMs` (`config.js:86`), `maxCombo` (`config.js:87`), and the
  `gained = 10 * multiplier` score formula (`game.js:316`, `mp-engine.js:132`) are untouched.
- **Not** adding any new death mode, obstacle, power-up, golden fruit, Time-Attack mode, growth
  change, or self-collision change — those are **B2 Phase 2/3** and are **gated by B1**
  (`b2-gameplay-depth.md:120-184`, `b2-gameplay-depth.md:280-295`). Q4 stays strictly in the juice +
  read-only-watcher lane.
- **Not** adding a DOM toast element. Milestones reuse the **canvas** `spawnScorePop` so a single code
  path serves both the solo HUD and the (DOM-less) multiplayer arena — a DOM toast would have to be
  wired into both the solo HUD and the MP scoreboard separately.
- **Not** introducing any new sync state, Firestore/RTDB write, or new authority on the phone. All new
  state is host-side `gameState` / per-player; phones stay dumb joysticks.
- **Not** touching the control scheme (`joystickToControl`, `logic.js`) or the leaderboard path.
- **Not** asset files — everything stays canvas-primitive + synthesized Web Audio, like the rest of
  `effects.js` / `sound.js`.

## 5. Proposed solution

Four small, additive edits across the two effect files, the two engines, and config. Nothing is
removed; every new function argument defaults to today's behavior so existing call sites are unchanged.

### 5.1 Scale the eat juice with the combo (`effects.js` + both engines)

Add an **optional `intensity` argument** (a number ≥ 1, default `1`) to `spawnFoodBurst()`
(`public/js/effects.js:24-41`) and `triggerShake()` (`public/js/effects.js:59-61`):

- `spawnFoodBurst(x, y, color, intensity = 1)` — scale `count` (e.g. `Math.round(10 * intensity)`,
  capped) and the per-particle `speed` band (`public/js/effects.js:29`) and the ripple `maxR`
  (`public/js/effects.js:40`) by `intensity`. With `intensity === 1` (the default), the loop emits
  the same 10 particles and `maxR: 34` ring as today — **byte-for-byte unchanged**.
- `triggerShake(magnitude, durationMs)` already takes explicit args, so the *crash* call sites
  (`game.js:585`, `mp-engine.js:168`) are untouched. The eat path will call it conditionally (see
  below) with a **small** magnitude — distinct from the heavy `9 / 340` death shake.

Pass a combo-derived intensity from **both** eat blocks, reusing the `multiplier` each already
computes (`public/js/game.js:315`, `public/js/mp-engine.js:131`):

- Solo eat (`public/js/game.js:321-327`): `spawnFoodBurst(foodX, foodY, colors.food, comboJuice(multiplier))`.
- Multi eat (`public/js/mp-engine.js:135-140`): same call, keeping the player's head color for the pop
  (`player.colors.head`, `mp-engine.js:139`).
- A tiny shake at **x3+** and a brighter flash/kick at **`maxCombo`**: a small pure helper (e.g.
  `comboJuice(multiplier)` and/or thresholds read from `gameConfig`) decides the intensity and whether
  to call `triggerShake(small, short)`. The "flash at maxCombo" can be a brighter/larger ripple via the
  same `intensity` (no new render pass needed) and an extra `triggerShake`.

Reuse the existing **analytic, frame-rate-independent** integration already in `effects.js`
(particles/ripples/shake all decay from a `Date.now()` timestamp, `effects.js:82-133`,
`effects.js:67-75`) — no new per-frame loop, no new draw call. The shake offset is already applied
once per frame in `renderGame()` via `getShakeOffset()` (`public/js/game.js:467-469`), and effects are
drawn via `updateAndDrawEffects(ctx)` (`public/js/game.js:531`); both run in solo and multi render
(the multiplayer branch shares `renderGame`, `game.js:481-488`).

### 5.2 Milestone toast + ascending sting (`sound.js` + both engines + config + state)

- **Config:** add a `milestones` array to `gameConfig` next to the combo tunables
  (`public/js/config.js:85-87`), e.g. `milestones: [100, 250, 500, 1000]`. Optionally a small
  `comboJuice` curve/cap and the `x3`/`maxCombo` shake thresholds, kept here so they are tunable
  without code edits.
- **Milestone sting:** add a small function to `sound.js` (e.g. `playMilestoneSound(index)`) that
  fires a distinct **ascending** `playTone(...)` (`public/js/sound.js:27-45`) — synthesized, no asset,
  extending the existing "pitch rises with progress" pattern from `playFoodSound`
  (`public/js/sound.js:51-54`). It honors the same `soundMuted` guard automatically (it routes through
  `playTone`, `sound.js:28`).
- **Watcher:** add a pure-ish helper (e.g. `checkMilestones(score, firedSet)` in `logic.js`, so it's
  unit-testable and exported) that returns the newly-crossed milestone (if any) given the current
  score and the set of already-fired thresholds. Call it from the solo eat block right after the score
  updates (`public/js/game.js:317-318`) and from the multi eat block after `player.score` updates
  (`public/js/mp-engine.js:133`). On a new crossing: `spawnScorePop(x, y, text, color)` for the toast
  (`public/js/effects.js:50-52` — already renders rising/fading Orbitron text in the board's logical
  coords and is called from both engines) **and** `playMilestoneSound(...)`.
- **Per-run "already fired" tracking:**
  - **Solo:** add a field to `createInitialGameState()` (e.g. `milestonesFired: []` or a `Set`,
    `public/js/state.js:47-50`, beside `combo` / `lastFoodTime`). `restartGame()` rebuilds state via
    `createInitialGameState()` (`game.js:183`), so it resets for free; `startGame()` must also reset it
    explicitly (it resets `combo` / `lastFoodTime` at `game.js:163-164` without a full rebuild).
  - **Multi:** because milestones are **per-player** in the arena, store the fired set on each player
    in `createPlayer()` (`public/js/players.js:42-57`, beside `combo` / `lastFoodTime`); a fresh round
    rebuilds every player via `createMultiplayerState(roster)` (`mp-engine.js:18`), so it resets per
    round.

### 5.3 Both-transports / both-modes note

This change is **transport-agnostic**: it touches neither the Firestore/RTDB sync nor the localStorage
fallback. All new state (`milestonesFired`, the combo-juice intensity) lives in **host-side**
`gameState` / per-player state and never crosses to the phone — phones stay dumb joysticks. Both the
**solo** (`game.js`) and **multi** (`mp-engine.js`) eat paths get the identical juice-scaling + milestone
wiring in the **same PR** (the brief's explicit "or the modes diverge" caveat). The multiplayer combo
badge stays hidden by design (`hideSoloHud`, `mp-engine.js:237-242`); per-player feedback continues to
surface through the colored canvas pops, which is exactly the engine-shared path milestones reuse.

## 6. Acceptance criteria

### Combo-scaled juice
- [ ] **Given** the new `intensity` argument is **omitted** (or `1`), **When** `spawnFoodBurst(x,y,c)`
  runs, **Then** it pushes exactly **10** particles and a `maxR: 34` ripple — identical to today —
  verified by unit-asserting `effects.particles.length` / `effects.ripples` after a default call vs a
  high-intensity call (which pushes strictly more particles / a larger ring).
- [ ] **Given** a solo eat with combo multiplier `m`, **When** the eat juice fires, **Then**
  `spawnFoodBurst` is called with an `intensity` derived from `m` (more particles + wider ripple at
  higher `m`), and the same scaling fires in the **multi** eat path (`mp-engine.js`).
- [ ] **Given** combo multiplier `m >= 3`, **When** the eat resolves, **Then** a **small** screen
  shake fires (distinct magnitude from the `9 / 340` crash shake); **Given** `m < 3`, **Then** the eat
  fires **no** shake (negative case).
- [ ] **Given** combo multiplier `m === gameConfig.maxCombo`, **When** the eat resolves, **Then** a
  brighter/larger flash (max-intensity ripple) and an extra kick fire — distinguishable from a x3 eat.
- [ ] **Given** a player crashes (solo `gameOver` / multi `eliminatePlayer`), **When** the death shake
  fires, **Then** it is still `triggerShake(9, 340)` — the crash call sites are unchanged.

### Milestone moments
- [ ] **Given** a run crosses a `gameConfig.milestones` threshold during an eat, **When** the eat
  resolves, **Then** exactly **one** floating toast (via `spawnScorePop`) **and** one ascending
  milestone sting (via `playTone`) fire for that threshold.
- [ ] **Given** the same threshold is at/above the current score later in the **same** run, **When**
  further eats resolve, **Then** the milestone does **not** re-fire (idempotent per run) — verified by
  asserting `checkMilestones` returns nothing once a threshold is in the fired set.
- [ ] **Given** a fresh `startGame()` **or** `restartGame()` **or** a new multiplayer round, **When**
  it begins, **Then** the "milestones already fired" set is **empty** (no stale toast from the previous
  run); in multi this is **per-player** (each player tracks its own crossings).
- [ ] Milestone toasts + stings fire in **both** the solo (`game.js`) and multi (`mp-engine.js`) eat
  paths (reviewer can diff the two eat blocks for parity).
- [ ] **Negative (no balance change):** `speedIncrease`, `maxSpeed`, `comboWindowMs`, `maxCombo`, and
  the `10 * multiplier` score formula are **unchanged**; Q4 adds **no** new death mode.

### Guardrails
- [ ] `.eslintrc.json` `globals` updated for **every** new top-level decl in `public/js/*` (e.g.
  `comboJuice`, `checkMilestones`, `playMilestoneSound`, any new state-field helper). CI `no-undef` is
  the gate.
- [ ] Any new **pure** helper added to `logic.js` (e.g. `checkMilestones`) has a matching entry in its
  Node-guard `module.exports` block (`public/js/logic.js`, end-of-file export idiom) **and** a unit
  test; `effects.js` exports are extended only if a new export/signature requires it
  (`public/js/effects.js:146-156`).
- [ ] No PII and no 6-digit session code logged or sent in any new event/state (re comment
  `mp-engine.js:212`); any new `trackEvent` routes through the hardened wrapper (`utils.js`).
- [ ] **`sw.js` `CACHE` bumped** (`public/sw.js:8`, currently `'snake-shell-v11'`) — `effects.js`,
  `sound.js`, `game.js`, `mp-engine.js`, `config.js`, `state.js` are all shell assets in
  `SHELL_ASSETS` (`sw.js:10`+), so any edit must bump the cache key for installed PWAs.
- [ ] `npm run lint`, `npm test` (Vitest, incl. `tests/protocol.test.js`), and the `node --check`
  syntax pass are all green before merge.
- [ ] Both `game.js` and `mp-engine.js` change in the **same PR** (no single-engine drift).

## 7. Affected files

| File | Change |
| --- | --- |
| `public/js/effects.js` | Add optional `intensity = 1` arg to `spawnFoodBurst` (`:24-41`) scaling particle count + speed band + ripple `maxR`; default path byte-identical to today. (`triggerShake` `:59-61` already takes explicit args — no signature change; the eat path passes a small magnitude.) Extend `module.exports` (`:146-156`) only if a new export is added. |
| `public/js/sound.js` | Add `playMilestoneSound(index)` (or similar): a distinct ascending `playTone` (`:27-45`) sting, honoring the existing `soundMuted` guard. **New top-level func → eslintrc globals.** |
| `public/js/config.js` | Add `milestones: [100, 250, 500, 1000]` and (optional) combo-juice curve / x3 + maxCombo shake thresholds to `gameConfig`, beside the combo tunables (`:85-87`). No change to existing combo/speed defaults. |
| `public/js/game.js` | Solo eat block (`:321-327`): pass combo-derived `intensity` to `spawnFoodBurst`, conditional small shake at x3+ / flash at maxCombo; call the milestone watcher after score update (`:317-318`); fire toast (`spawnScorePop`) + sting. Reset `milestonesFired` in `startGame()` (`:163-164`). |
| `public/js/mp-engine.js` | Multi eat block (`:125-152`): mirror the combo-scaled juice (`:135-140`), the conditional shake, and the milestone watcher after `player.score` update (`:133`) — toast in the player's head color, per-player fired set. |
| `public/js/state.js` | Add a per-run `milestonesFired` field (array/Set) to `createInitialGameState()` (`:47-50`) so solo + `restartGame()` share one shape. |
| `public/js/players.js` | Add a per-player `milestonesFired` field to `createPlayer()` (`:42-57`) so each arena player tracks its own crossings; resets each round via `createMultiplayerState`. |
| `public/js/logic.js` | **Add** `checkMilestones(score, firedSet, config)` (pure, exported) + matching `module.exports` entry; unit-tested. (Optionally `comboJuice(multiplier, config)` here too, if made pure.) |
| `tests/logic.test.js` | **Add** cases for `checkMilestones` (crossing, idempotence, reset) and any pure `comboJuice`. |
| `tests/effects.test.js` (new) **or** extend an existing suite | **Add** unit asserts that `spawnFoodBurst` default emits 10 particles and a high `intensity` emits strictly more / a larger ripple. (Vitest can `require` `effects.js` via its Node export block, `effects.js:146-156`.) |
| `.eslintrc.json` | **Bump `globals`** for every new top-level decl (`comboJuice`, `checkMilestones`, `playMilestoneSound`, …). CI fails otherwise. |
| `public/sw.js` | **Bump `CACHE`** (`:8`, `'snake-shell-v11'`) — shell JS assets changed. |

No new CSS or `index.html` markup is required (milestones use the existing canvas `spawnScorePop`, not
a DOM element), so no CSS files change.

## 8. Dependencies & sequencing

- **Depends on:** none. This is **B2 Phase 1** and is explicitly carved out to ship before B1 because
  it only adds optional, default-unchanged juice args plus a read-only milestone watcher — it does
  **not** change the core simulation (`b2-gameplay-depth.md:282-283`).
- **Caveat (from the brief):** because Q4 *does* touch the eat/combo path, it must be applied to **both**
  the solo (`game.js`) and multi (`mp-engine.js`) engines in the **same PR** — there is no shared eat
  step yet (B1 ([engine dedup](./b1-engine-dedup-and-game-split.md)) is what unifies it later). The two
  eat blocks (`game.js:305-337`, `mp-engine.js:125-152`) are hand-mirrored today; keep them mirrored.
- **Unblocks / de-risks:** B2 Phase 2/3 — the milestone-watcher plumbing and the `intensity`-scaled
  juice are exactly the hooks Phase 2 (golden fruit, second difficulty axis) builds on. Proving them in
  both engines now means Phase 2 inherits a working, tested pattern.
- **Independently mergeable:** a single CI-green PR; no other roadmap item blocks it.

## 9. Risks & mitigations

- **Solo/multi divergence (the brief's named risk).** The eat path lives in two files today.
  **Mitigation:** ship both `game.js` and `mp-engine.js` edits in one PR; reviewer diffs the two eat
  blocks for parity; put the shared decision logic (`checkMilestones`, `comboJuice`) in `logic.js` so
  the *math* is shared by construction even though the call sites are duplicated.
- **Adding an arg to `effects.js` changes existing callers.** **Mitigation:** default `intensity = 1`
  so the crash bursts (`game.js:587`, `mp-engine.js:170`) and any other caller behave byte-for-byte the
  same; an acceptance criterion unit-asserts the default path emits exactly 10 particles.
- **Global-scope / load-order minefield.** Every new top-level func/`const` in `public/js/*` is a shared
  global and must be in `.eslintrc.json` `globals` or CI `no-undef` fails (that failure is the feature).
  **Mitigation:** add pure helpers to the already-loaded `logic.js` (early in the order, before
  `game.js`/`mp-engine.js`), wire UI/sound into the existing `game.js`/`mp-engine.js`/`sound.js`, and
  update the globals list in the same commit. No new file needs slotting into `index.html`.
- **`module.exports` / browser parity.** A new pure helper in `logic.js` must be added to both the
  eslint globals **and** the Node-guard export block, or tests/lint break. **Mitigation:** mirror the
  existing idiom; an acceptance criterion checks it.
- **Juice over-noise / motion sensitivity.** Bigger bursts + a shake on every high combo could feel
  busy or be uncomfortable for motion-sensitive players. **Mitigation:** keep the eat shake **small and
  short** (distinct from the death shake), gate it to x3+ only, make the curve/thresholds
  `gameConfig`-tunable, and verify "feel" via Claude_Preview that a x1 eat is unchanged and a max combo
  reads as celebratory, not jarring. (A future `prefers-reduced-motion` gate is out of scope here but a
  natural follow-up — see M3 a11y.)
- **Milestone double-fire / stale set across runs.** A forgotten reset would re-toast or carry over.
  **Mitigation:** reset in `startGame()` explicitly and rely on the `createInitialGameState` /
  `createMultiplayerState` rebuilds for `restartGame()` / new rounds; acceptance criteria cover both the
  idempotence and the reset.
- **PWA staleness.** New shell JS won't reach installed users until `CACHE` bumps. **Mitigation:** bump
  `sw.js` `CACHE` (criterion in §6); SW is network-first so online users get it on next load.

## 10. Verification / test plan

No local Node — verification is CI-bound + Claude_Preview, matched to each change type:

1. **Vitest (CI, primary for the pure bits).**
   - `checkMilestones(score, firedSet, config)` in `logic.js` gets unit tests in `tests/logic.test.js`
     (pattern at `tests/logic.test.js:1-30`): crossing a threshold returns it; an already-fired
     threshold returns nothing (idempotence); a higher score crosses the *next* threshold; an empty
     fired set after reset re-allows the first.
   - `spawnFoodBurst` intensity scaling: a small new suite (or extend an existing one) `require`s
     `public/js/effects.js` via its Node export block (`effects.js:146-156`) and asserts the default
     call pushes exactly 10 particles + one `maxR: 34` ripple, while a high `intensity` pushes strictly
     more particles and a larger `maxR` — and that `resetEffects()` (`effects.js:138-143`) clears them.
   - `npm test` is **blocking** in CI (`.github/workflows/deploy.yml`).
2. **`node --check` (CI).** The syntax pass over every edited `public/js/*.js` proves the new args /
   branches parse.
3. **Lint (CI).** `npm run lint` proves the eslintrc `globals` list was updated for every new top-level
   decl — the primary guardrail for this global-scope codebase.
4. **`python -m http.server` + Claude_Preview (feel).** Serve `public/`; **unregister the SW + clear
   caches first** (network-first SW serves stale assets locally). Drive a run and confirm: a x1 eat looks
   like today; a high combo blooms (more particles, wider ring); a x3+ eat kicks slightly; a maxCombo eat
   flashes; and a milestone toast + sting fires once at 100/250/500/1000 and not again. Use
   `mcp__Claude_Preview__preview_eval` to read `effects.particles.length` right after a scripted
   high-intensity `spawnFoodBurst` call as an authoritative check (screenshots time out — prefer eval
   reads; use snapshots qualitatively). Force the controller view with `?session=123456` in a second tab
   and exercise the **multiplayer** eat path to confirm per-player toasts + colored pops + scaled juice.
5. **No scratch Firebase project / no rules change.** This change is host-local and transport-agnostic;
   `firestore.rules` / `database.rules.json` are untouched, so no emulator or scratch project is needed,
   and **no production `firebase deploy` by hand**.

## 11. Analytics & observability

Route any new event through the hardened `trackEvent()` (`public/js/utils.js`) — no-ops offline, never
throws, auto-tags `device_role`; **never** log the 6-digit code or PII (re `mp-engine.js:212`).

- **Add `milestone_reached` `{ milestone, mode }`** fired from the milestone watcher in both eat paths
  (`mode` = `'solo' | 'multi'`, from `gameState.mode`). This directly measures **which thresholds
  players actually hit per run** — the proxy for whether the added depth is extending sessions, which is
  the whole point of the initiative.
- **Existing events suffice for the rest.** `game_over` / `post_score` already carry the final score
  (`game.js:613-614`); `mp_game_over` already carries the round outcome (`mp-engine.js:210-213`). No new
  combo-juice event is warranted — the juice is presentation, and `milestone_reached` is the meaningful
  funnel signal.
- **Watch in GA4:** average `milestone_reached` count per run (session-depth proxy) and the distribution
  of which milestones are reached (do players ever cross 500/1000?) — these tell us if the combo/juice
  loop is actually pulling players into longer runs.
