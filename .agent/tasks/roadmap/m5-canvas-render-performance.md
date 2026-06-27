# M5 · Canvas render performance: tame shadowBlur, idle throttle, context hints

> **Tier** medium · **Focus** Polish / Performance · **Impact** High · **Effort** M (1-2 days) · **Priority** 66/100
> **Status** `Not started` · **Depends on** none · **Part of** [Roadmap](./README.md)

## 1. Problem — what we're solving

The desktop canvas renderer carries three compounding paint costs. All are confirmed in source; the
"9x on HiDPI" premise specifically depends on a real device-pixel-ratio backing store, which I
verified exists (the caveat in the brief).

**(0) The HiDPI backing store is real — premise verified.** The `<canvas id="game-canvas">` is
declared `width="600" height="600"` in markup (`public/index.html:125`), but those attributes are
**overwritten at runtime**: `setupHiDPICanvas()` (`public/js/game.js:40-48`) sets
`canvas.width = Math.round(600 * dpr)` / `canvas.height = Math.round(600 * dpr)` where
`dpr = window.devicePixelRatio || 1` (`game.js:42`), then `ctx.setTransform(dpr,0,0,dpr,0,0)` so game
math stays in logical 600x600 pixels. CSS holds the on-screen size at `600px` (`desktop.css:213-214`,
with `max-height:60vh` on narrow screens at `desktop.css:514-519`). So on a 2x screen the backing
store is 1200x1200 (4x the pixels) and on a 3x phone-class display 1800x1800 (**9x the pixels**). The
`shadowBlur` premise scales with that pixel count — the brief's "~9x" is accurate for a 3x display.

**(1) `shadowBlur` (the most expensive Canvas2D primitive) is applied per-segment, per-frame.**
`drawSnake()` sets `ctx.shadowBlur = 8` once, then fills a glowing `arc()` for **every body segment**
in a loop (`game.js:405-414`); the head adds a second blurred fill with
`shadowBlur = 12 + (currentSpeed - baseSpeed) * 3` (`game.js:423-428`); food adds a third at
`shadowBlur = 15` (`game.js:491-497`). On top of that, **every particle** in the juice layer sets
`shadowBlur = 6` and fills its own arc (`effects.js:110-113`) — a food burst spawns 10 particles
(`effects.js:26`). A 30+ segment snake therefore issues 30+ shadow-blurred fills per frame, each
re-rasterized against the HiDPI buffer. This is the dominant paint cost and the most likely source of
mobile/low-end jank and battery drain.

**(2) The loop repaints the full board every rAF even when nothing is moving.** `updateGame()` calls
`renderGame()` **unconditionally** every frame (`game.js:236`), and re-arms rAF whenever
`gameState.gameRunning` is true (`game.js:239-241`) — which it is during `WAITING_FOR_START` and
`GAME_OVER`, not just `PLAYING`. `renderGame()` clears and repaints the entire board every call
(`game.js:457-534`), and the food's pulse uses `Math.sin(Date.now() * 0.005)` (`game.js:495`), so the
frame is *always* visually dirty — the renderer can never early-out. On a 144Hz monitor sitting on the
lobby or the game-over screen, that is **144 full board repaints per second** (each including the
expensive food shadow blur) for zero gameplay benefit.

**(3) `getContext("2d")` passes no performance hints despite a fully opaque board.** `game.js:17` is
`canvas.getContext('2d')` with no options. The board background is fully opaque — `renderGame()` paints
`colors.background` (`#0a0a0a`, `config.js:109`) over the whole canvas first (`game.js:463-464`), and
the CSS canvas background is the opaque `var(--color-background)` (`desktop.css:218`). With no
`alpha:false`, the browser still composites the canvas as if it had a transparent layer.

**(4) Minor: per-eat `sqrt`/`pow` and an un-debounced resize.** `generateFood()` computes
`Math.sqrt(Math.pow(dx,2) + Math.pow(dy,2))` per candidate against every segment of every snake
(`game.js:377-379`), then compares to `gameConfig.segmentSpacing * 2` — a distance comparison that
needs no square root. And the resize listener calls `setupHiDPICanvas(); renderGame();` on **every**
resize event with no debounce (`game.js:20`), so a drag-resize thrashes canvas reallocation.

## 2. Why it matters

This is the **Polish / Performance** lane, and it directly serves "pushing for real users". The neon
board is the product's whole visual identity, and the people most likely to churn on first contact are
exactly the ones who feel this: someone trying the live demo on a mid-range Android phone (3x DPR,
weaker GPU) where the snake stutters and the device warms up. Taming `shadowBlur` and idling the loop
cuts both jank and battery use without touching the look that makes the game feel premium — the head
and food keep their glow. The lobby/game-over idle throttle also stops a 144Hz desktop from spinning
the fan while the player reads the QR instructions, which is a quiet but real quality signal.

## 3. Goals

- Restrict `shadowBlur` to a handful of shapes per frame (head + food, and optionally the eaten-food
  burst), independent of snake length — body segments render glow-free or via a cheaper technique,
  while the **neon identity is preserved** (head glow + food glow survive).
- Stop full-board repaints when idle: throttle `WAITING_FOR_START` / `GAME_OVER` to ~15-30fps, and
  fully pause the rAF loop while the tab is hidden (`document.hidden`), resuming on visibility.
- Acquire the 2D context with `{ alpha: false, desynchronized: true }`.
- Drop the `sqrt`/`pow` in `generateFood()`'s proximity check in favour of squared-distance.
- Debounce the `resize` handler so drag-resizing doesn't thrash `setupHiDPICanvas()`.
- A/B the board visually before/after to confirm the glow identity is intact (per the brief's caveat).
- No measurable change to gameplay feel, collision, scoring, or the multiplayer arena.

## 4. Non-goals

- **No** removal of head or food glow — the neon look is sacred; only the per-body-segment blur changes.
- **No** rewrite to WebGL / OffscreenCanvas / a render worker — keep Canvas2D and the classic-script,
  global-scope architecture.
- **No** change to the fixed-timestep movement model (`movementUpdateMs`, `game.js:221`) or to any
  `logic.js` pure math — turning/collision/speed stay byte-for-byte identical.
- **No** new build tooling, ES modules, or bundler.
- **No** change to Firebase sync, RTDB joystick stream, or the localStorage fallback — this is a
  render-only change with no protocol surface.
- **No** redesign of the `effects.js` particle system beyond the single `shadowBlur` decision.

## 5. Proposed solution

All edits are confined to `public/js/game.js` and `public/js/effects.js` (the brief's two files); no new
file is needed, which keeps the load-order/globals surface minimal.

**A. Context hints (`game.js:17`).** Change `canvas.getContext('2d')` to
`canvas.getContext('2d', { alpha: false, desynchronized: true })`. Safe because the board is fully
opaque (`game.js:463-464` paints `colors.background` over the whole canvas each frame). `desynchronized`
is a hint browsers ignore where unsupported, so no capability check is required.

**B. Tame body-segment `shadowBlur` while keeping head + food glow (`drawSnake()`,
`game.js:403-452`).** Today the body loop (`game.js:409-414`) draws every segment with
`shadowBlur = 8`. Replace that with a **glow-free** body fill — keep `ctx.fillStyle = colorPair.body`
but leave `shadowBlur = 0` for the body loop, and instead get the body's depth from a cheap visual that
costs O(1): either a flat fill, or a single `ctx.createRadialGradient` per snake (computed once outside
the segment loop) for a subtle sheen. The **head keeps** its speed-reactive `shadowBlur`
(`game.js:423-428`) and the **food keeps** its `shadowBlur = 15` (`game.js:491-497`) — a fixed, small
number of blurred shapes per frame (1 head + 1 food per alive snake-or-board) regardless of length.
Because solo and multiplayer both render through the same `drawSnake()` (`game.js:483` and `game.js:486`),
this single edit fixes both modes at once — no `mp-engine.js` change.

**C. Particle `shadowBlur` (`effects.js:110-113`).** A food burst is 10 particles each setting
`shadowBlur = 6`. Drop the per-particle `shadowColor`/`shadowBlur` (keep `globalAlpha` fade + fill) so a
burst is 10 cheap fills instead of 10 blurred ones. The ring/ripple already uses no shadow
(`effects.js:90-97`); this brings particles in line. Visual loss is negligible against the food's own
glow at the same spot.

**D. Idle throttle + pause-when-hidden (`updateGame()` / loop arm, `game.js:206-242`).** Two parts,
reusing the existing `performance.now()` timestamps already threaded through the loop
(`gameState.lastUpdateTime`, `game.js:209`):
- **Idle FPS cap:** when `gameState.currentState !== GameState.PLAYING` (lobby or game-over), only call
  `renderGame()` if at least ~33-66ms have elapsed since the last *paint* (an `IDLE_FRAME_MS` constant,
  ~15-30fps). The food pulse keeps animating, just at a slower cadence. During `PLAYING` the behaviour
  is unchanged (every-frame render), so gameplay smoothness is untouched.
- **Pause on hidden:** add a single `document.addEventListener('visibilitychange', …)` in
  `initializeDesktopGame()` (alongside the existing `resize` wiring at `game.js:20`). When
  `document.hidden`, `cancelAnimationFrame(gameLoop)` and stop re-arming; on visible, reset
  `gameState.lastUpdateTime`/`lastMoveTime` to `performance.now()` (so the frame-step clamp at
  `MAX_FRAME_STEP`, `game.js:248/258`, doesn't fire a catch-up jump) and re-arm
  `requestAnimationFrame(updateGame)`. There is **no existing `visibilitychange` handler** anywhere in
  the tree (verified), so this is purely additive. `gameLoop` is already a writable global
  (`.eslintrc.json:57`), and the existing `blur` handler (`game.js:105-108`) is precedent for this kind
  of window-level lifecycle wiring.

**E. Squared-distance in `generateFood()` (`game.js:377-380`).** Replace
`Math.sqrt(Math.pow(dx,2)+Math.pow(dy,2)) < segmentSpacing*2` with `dx*dx + dy*dy < (segmentSpacing*2)²`
(precompute the squared threshold once). Identical placement behaviour, no `sqrt`/`pow` on the eat
frame. `generateFood()` is shared by solo (`game.js:329`) and multiplayer (`mp-engine.js:142`), so both
benefit; the function signature is unchanged.

**F. Debounce resize (`game.js:20`).** Wrap the `resize` handler in a small trailing-edge debounce
(e.g. ~150ms `setTimeout`/`clearTimeout`) so a drag-resize reallocates the backing store once at rest
instead of every event. Keep the immediate `renderGame()` only after the debounced
`setupHiDPICanvas()`.

**Helpers/patterns to reuse:** `debugLog()` (`utils.js`) for any new dev chatter; the existing
`performance.now()` timing already in `updateGame` (`game.js:209-210`); the `gameLoop` writable global
(`.eslintrc.json:57`); the `TARGET_FRAME_MS` / `MAX_FRAME_STEP` constants (`game.js:247-248`) for the
visibility-resume clamp; `colors.background` opacity (`config.js:109`) as the justification for
`alpha:false`. New top-level constants (e.g. `IDLE_FRAME_MS`) must be added to `.eslintrc.json` globals.

## 6. Acceptance criteria

- [ ] **Given** the desktop game is initialized, **then** `game.js:17` acquires the context via
  `getContext('2d', { alpha: false, desynchronized: true })` and the board still renders fully opaque
  (no transparent halo / no visible regression).
- [ ] **Given** a snake of ≥30 segments while `PLAYING`, **then** the number of shapes drawn with a
  non-zero `shadowBlur` per frame is **constant** (head + food, plus at most the active particle burst if
  kept), **not** proportional to snake length — verified by reading the body loop (`game.js:409-414`) no
  longer sets `shadowBlur`.
- [ ] **Given** the same snake, **then** the **head glow** (`game.js:423-428`) and **food glow**
  (`game.js:491-497`) are visually preserved (A/B screenshot before/after shows the neon identity intact).
- [ ] **Given** the lobby (`WAITING_FOR_START`) or `GAME_OVER` screen on a high-refresh display, **when**
  the player is idle, **then** `renderGame()` is invoked at ≤~30fps (not at the monitor's full refresh),
  while the food pulse still visibly animates.
- [ ] **Given** the player is mid-game (`PLAYING`), **then** rendering is **unthrottled** (every rAF) —
  the idle cap must not touch active gameplay.
- [ ] **Given** the browser tab is hidden (`document.hidden === true`), **then** the rAF loop is paused
  (no `renderGame()` calls); **when** the tab becomes visible again, the loop resumes **without** a
  catch-up movement jump (timestamps reset on resume).
- [ ] **Given** the snake is steered toward a wall while the tab is then hidden and re-shown, **then** the
  snake does **not** teleport through the wall on resume (the `MAX_FRAME_STEP` clamp + timestamp reset
  holds).
- [ ] **Given** `generateFood()` runs, **then** the proximity check uses squared-distance (no
  `Math.sqrt` / `Math.pow` in the loop, `game.js:377-379`) and food placement behaviour is unchanged
  (still avoids spawning within `segmentSpacing*2` of any body segment).
- [ ] **Given** a continuous window drag-resize, **then** `setupHiDPICanvas()` runs once on settle
  (debounced), not on every resize event, and the canvas remains crisp afterward.
- [ ] **Multiplayer arena** (`gameState.mode === 'multi'`): all N snakes render through the same
  `drawSnake()` change, head/food glow preserved, no per-segment body blur — no regression to the arena.
- [ ] **localStorage fallback path** still works (render changes are transport-agnostic; no Firebase
  surface touched).
- [ ] `.eslintrc.json` `globals` updated for any **new top-level** `function`/`const`/`let` (e.g.
  `IDLE_FRAME_MS`, a resize-debounce timer, a visibility handler) — CI `no-undef` green.
- [ ] No PII and **never** the 6-digit session code logged by any new `debugLog`/analytics.
- [ ] `npm run lint`, `npm test` (Vitest, incl. `tests/protocol.test.js`), and `node --check` all green
  in CI.
- [ ] `sw.js` `CACHE` bumped from `snake-shell-v11` (`sw.js:8`) since shell JS changed, so installed PWAs
  pick up the new code after one reload.

## 7. Affected files

| File | Change |
| --- | --- |
| `public/js/game.js` | Context hints (`getContext` opts); `drawSnake()` body-segment glow removal + head/food glow kept; idle FPS cap + `visibilitychange` pause/resume in the loop; squared-distance in `generateFood()`; debounced `resize` handler. May add top-level constants (e.g. `IDLE_FRAME_MS`) + a debounce timer var. |
| `public/js/effects.js` | Drop per-particle `shadowColor`/`shadowBlur` (`effects.js:110-113`); keep alpha-fade fill. |
| `public/sw.js` | **Bump `CACHE`** `snake-shell-v11` → `v12` (`sw.js:8`) — shell JS changed. |
| `.eslintrc.json` | **Bump `globals`** for any new top-level declaration introduced (e.g. `IDLE_FRAME_MS`, resize-debounce timer, visibility handler) so `no-undef` stays green. |

No new files. No CSS change required (the canvas CSS at `desktop.css:209-222` already declares an opaque
background, which is what makes `alpha:false` safe).

## 8. Dependencies & sequencing

- **Depends on:** none. Self-contained render change.
- **Unblocks / enables:** a later "raise `maxPlayers` to 6" change (`config.js:102`) becomes safer once
  per-segment body blur is gone — six longer snakes would otherwise multiply the exact cost this fixes.
- **Sequencing within the change:** land the cheap, zero-risk wins first (context hints, squared-distance,
  resize debounce, particle shadow), then the `drawSnake` glow change (needs an A/B visual check), then the
  idle-throttle + visibility pause (needs the resume-jump verification). Each is independently revertable.

## 9. Risks & mitigations

- **Global scope / load order (the standing minefield).** Any new top-level `function`/`const`/`let` in
  `game.js` must be added to `.eslintrc.json` `globals` or CI `no-undef` fails (that failure is the
  feature). *Mitigation:* keep additions minimal (a couple of constants + maybe one handler), and update
  the globals list in the same commit. Prefer keeping new state on the existing `gameState` object or as
  module-local constants rather than new globals where possible.
- **Visibility-resume catch-up jump.** Re-arming rAF after the tab was hidden could feed a multi-second
  `deltaTime` into the loop. *Mitigation:* reset `lastUpdateTime`/`lastMoveTime` to `performance.now()` on
  resume; the existing `MAX_FRAME_STEP` clamp (`game.js:248`, `mp-engine.js:37`) is a second line of
  defence. Covered by an explicit acceptance criterion.
- **Glow identity regression.** Removing body-segment blur could flatten the look more than intended.
  *Mitigation:* keep head + food glow untouched; A/B screenshot before/after (the brief's caveat); if the
  body reads too flat, add the O(1) radial-gradient sheen rather than restoring per-segment blur.
- **`desynchronized` tearing.** On some compositors `desynchronized:true` can show minor tearing.
  *Mitigation:* it's a hint, low blast radius; if it regresses visibly in the Claude_Preview A/B, drop just
  that flag and keep `alpha:false`.
- **Idle throttle masking a real frame.** If the food-pulse cadence at 15-30fps looks choppy on the lobby,
  *mitigation:* tune `IDLE_FRAME_MS` toward 30fps; gameplay (`PLAYING`) is never throttled, so the risk is
  cosmetic and confined to idle screens.
- **Multiplayer parity.** Because both modes share `drawSnake()`/`generateFood()`, a mistake hits both.
  *Mitigation:* the shared code path is the point — verify both a solo run and a ≥2-player arena round in
  preview.

## 10. Verification / test plan

Iteration is CI-bound (no local Node), so the plan leans on CI gates + the local Python-server visual A/B:

- **CI gates (blocking, `.github/workflows/deploy.yml`):** `npm run lint` (confirms globals list updated,
  `no-undef` green), `npm test` (Vitest — `generateFood` proximity behaviour is exercised indirectly; the
  jsdom `tests/protocol.test.js` smoke test must still pass), and `node --check` syntax pass on the edited
  files.
- **Pure-logic safety:** the change deliberately does **not** touch `logic.js`, so the existing
  `tests/logic.test.js` collision/turn/joystick coverage continues to guard gameplay math unchanged. If
  the squared-distance threshold is factored into a helper, add a small Vitest case asserting it matches
  the old `sqrt`-based decision at the boundary.
- **Visual A/B (the brief's required check):** `python -m http.server` over `public/`, open the desktop
  view, and use Claude_Preview `eval`/`snapshot` (screenshots time out — use eval/snapshot). **Unregister
  the network-first SW and clear caches first** so stale JS isn't served. Capture before/after of: (a) a
  long-snake `PLAYING` frame to confirm head+food glow survives and body is clean; (b) the lobby idle
  screen; (c) the game-over screen. Confirm the neon identity is visually intact.
- **Idle/visibility behaviour:** via Claude_Preview `eval`, instrument a counter around `renderGame()` and
  assert call-rate drops on the lobby vs `PLAYING`, and drops to ~0 while a `document.hidden` is simulated,
  then resumes — and that the snake position does not jump after a simulated hide/show.
- **Multiplayer path:** open with `?session=…` flow / force `gameState.mode = 'multi'` in preview and run a
  short round to confirm the arena renders correctly with the new `drawSnake`.
- **No Firebase rules touched**, so **no** emulator / scratch-project step is needed for this change.

## 11. Analytics & observability

Largely N/A — this is a render-only change with no funnel events to add, and the guardrails forbid logging
the session code or PII. Optional, low-priority observability (route through the hardened `trackEvent()` in
`utils.js`, which no-ops offline and never throws):

- **Optional** one-time `perf_render` event on first `PLAYING` frame carrying coarse, non-identifying
  context — `device_pixel_ratio` (already auto-tagged role via `trackEvent`) and a bucketed
  `fps`/`frame_ms` sample — to quantify the real-world win across devices. Strictly optional; only add if
  it can be sampled cheaply (e.g. once per session) so the measurement doesn't reintroduce overhead. **No**
  per-frame events. **Never** include the session code.
- For day-to-day debugging, gate any new chatter behind `debugLog()` / `DEBUG` (`utils.js`) — e.g. a one-
  liner when the loop pauses/resumes on visibility — never raw `console.log`.
