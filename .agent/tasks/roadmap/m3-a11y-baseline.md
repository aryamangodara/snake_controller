# M3 · Baseline accessibility pass: focus, reduced-motion, screen-reader output

> **Tier** medium · **Focus** Polish · **Impact** High · **Effort** S-M · **Priority** 80/100
> **Status** `Not started` · **Depends on** none (pairs with Q1) · **Part of** [Roadmap](./README.md)

## 1. Problem — what we're solving

Three concrete WCAG gaps ship in production today. Each was verified against the source:

**(1) Keyboard focus is invisible on every icon-only control.** The only focus rule in the
codebase is `.btn:focus-visible` in `public/css/base.css:130-133`, and it *removes* the outline
(`outline: none;`) — replacing it only with a box-shadow ring that the gradient/`overflow:hidden`
pills then clip. The icon-only controls have **no** `:focus-visible` rule at all:
- `.social-link` (LinkedIn / Instagram / mute / leaderboard buttons) — `public/css/desktop.css:138-150`
  with `overflow: hidden` at line 149; hover/`::before` shimmer states only (lines 164-187), no focus.
- `.center-btn` (the phone start/restart button) — `public/css/mobile.css:177-212`; `:disabled`,
  `:hover`, `:active` states only, no `:focus-visible`.
- `.share-btn` (WhatsApp / X / Facebook / Instagram on the phone game-over card) —
  `public/css/mobile.css:397-415`; `:active` only.

The only correct example in the tree is `.lb-close:focus-visible` (`public/css/leaderboard.css:51-52`),
which uses the existing `--focus-outline` token. Net effect (WCAG 2.4.7 Focus Visible): a
keyboard-only or switch user tabbing the header social row, the phone joystick start button, or the
share row gets **zero** visual indication of where focus is.

**(2) `prefers-reduced-motion` is honored by only ~3 selectors.** The single
`@media (prefers-reduced-motion: reduce)` block lives in `public/css/multiplayer.css:179-183` and
disables exactly three multiplayer animations (`.mp-chip--joined`, `.win-flash`, `.mp-wait-note`).
Meanwhile the following animate **unconditionally** for every user:
- Full-viewport scrolling grid — `body::before { animation: gridMove 20s linear infinite }`
  (`public/css/base.css:44`).
- Full-viewport floating particles — `body::after { animation: float 15s ... infinite }`
  (`public/css/base.css:67`, the `float` keyframe rotates 180°).
- Gradient-shifting title — `.game-title { animation: gradientShift 3s ... infinite }`
  (`public/css/desktop.css:77`).
- Pulsing logo glow — `.game-logo { animation: logoGlow 4s ... infinite }` (`public/css/desktop.css:111`).
- QR/cue/spinner/combo loops — `pulse` (desktop.css:253), `cueBounce` (desktop.css:359),
  `qrGlow` (desktop.css:435), `spin` (desktop.css:465), `comboPop` (desktop.css:595),
  `comboDeplete` (desktop.css:610/`game.js:573`), `lossShake` (mobile.css:348-349).
- **Canvas screen-shake + particle bursts in JS** — `triggerShake(9, 340)` and `spawnFoodBurst()`
  fire on every crash (`public/js/game.js:585-587`) and every food eat (`public/js/game.js:322`),
  with no `matchMedia` check. The shake physically translates the whole board
  (`getShakeOffset()`, `public/js/effects.js:67-75`; applied at `game.js:467-469`).

This is a WCAG 2.3.3 (Animation from Interactions) / vestibular-trigger risk: the always-on
full-viewport scroll + 180° rotation + screen shake can induce nausea/dizziness for affected users.

**(3) The solo canvas/score/game-over emits nothing to a screen reader.** `<canvas id="game-canvas">`
(`public/index.html:125`) has no `role` and no `aria-label`. The live score `<span id="score">`
(`public/index.html:162`, written by `updateScore()` at `public/js/game.js:539-544`) and the
game-over final score (`public/index.html:135`, written in `gameOver()` at `game.js:593-596`) have
no `aria-live`. So a blind solo player gets **no spoken outcome** — no "game over", no final score.
(Multiplayer already has the right pattern: `#mp-announcer` is an `sr-only` `aria-live="polite"`
region — `public/index.html:187` — driven by `mpAnnounce()`. Solo never got the equivalent.)

## 2. Why it matters

This is the **Polish** theme and a direct **launch-readiness / real-users** lever. The game is
publicly live (https://go-console-84748.web.app/) and being pushed for real players. Today a
keyboard user literally cannot see what they're about to activate, a motion-sensitive user is
forced into a constantly-scrolling, screen-shaking viewport with no escape, and a blind solo player
gets no feedback that the run even ended. These are the three most common, most cited automated-audit
failures (focus visibility, reduced-motion, live-region output) — fixing them lifts the Lighthouse
a11y score, removes a real barrier to a chunk of potential players, and signals product quality.
The cost is tiny (mostly additive CSS plus two small JS guards) and the change is **purely additive**
to the global-scope architecture — no behavior changes for existing users beyond honoring a
preference they explicitly set.

## 3. Goals

- Every keyboard-focusable interactive control shows a clear, token-driven focus indicator
  (`.social-link`, `.center-btn`, `.share-btn`, plus the existing `.btn` / inputs / links), using
  the existing `--focus-outline` token, visible against the gradient pills.
- A single global `@media (prefers-reduced-motion: reduce)` rule in `base.css` neutralizes the
  ambient/decorative animations (grid, particles, title gradient, logo/QR glows, pulses, combo pop,
  loss shake) **without** `display:none` — using `animation-duration: 0.01ms` so any JS that reads
  animation events (e.g. the combo `comboDeplete` reflow in `restartComboTimer()`) still fires.
- `effects.js` particle spawns and screen-shake are gated behind
  `matchMedia('(prefers-reduced-motion: reduce)')` so the canvas stays still for motion-sensitive
  users (food/crash still register via sound + score + state).
- The solo canvas exposes `role="img"` + a descriptive `aria-label`; the live score is `aria-live`;
  and "Game over, final score N" is pushed to a polite live region on the `GAME_OVER` transition.
- No regression to the existing localStorage protocol smoke test or any unit test; lint, `node --check`,
  and Vitest stay green.

## 4. Non-goals

- **Full WCAG 2.1 AA conformance.** This is a *baseline* pass on three specific gaps, not an audit
  remediation of color contrast, full ARIA landmark structure, focus-trapping the leaderboard modal,
  or keyboard operability of the joystick drag.
- **Making the canvas game itself screen-reader playable** (e.g. spoken snake position / spatial
  audio). Out of scope — we only announce score and game-over outcomes.
- **Reduced-motion for multiplayer-only selectors** already handled at `multiplayer.css:179-183`
  (we keep that block; the new global block is additive and must not conflict).
- **A user-facing motion toggle / settings UI.** We honor the OS-level `prefers-reduced-motion`
  only; no new control, no persisted preference.
- **Changing the gameplay feel** for users who have *not* requested reduced motion — the juice
  (shake, particles, gradients) stays exactly as-is for them.

## 5. Proposed solution

All changes are additive and respect the no-bundler / one-global-scope / fixed-load-order rules.

**(A) Shared focus-visible rule (CSS only).** In `public/css/base.css`, add one rule covering all
interactive controls, reusing the existing `--focus-outline` token (`variables.css:75`, already
dark-mode-aware at `variables.css:201`) exactly as `.lb-close:focus-visible` does:

```css
.btn:focus-visible,
.social-link:focus-visible,
.center-btn:focus-visible,
.share-btn:focus-visible,
.btn-connect:focus-visible,
.btn-play-again:focus-visible,
a:focus-visible,
input:focus-visible {
  outline: var(--focus-outline);
  outline-offset: 2px;
}
```

- Replace the existing `.btn:focus-visible { outline: none; ... }` (`base.css:130-133`) — keep the
  box-shadow ring but **restore a real outline** so it survives the gradient pills' `overflow:hidden`.
- `outline` (unlike `box-shadow`) is **not** clipped by `overflow:hidden`, which is why it works on
  `.social-link` (desktop.css:149) and `.center-btn`/`.share-btn` (mobile.css `overflow:hidden`).
- `:focus-visible` (not `:focus`) means mouse/touch taps on the phone joystick/share buttons do **not**
  draw a ring — only keyboard/AT focus does, preserving the current touch look.

**(B) Global reduced-motion block (CSS only).** Add to `public/css/base.css` (loaded before
desktop/mobile/multiplayer per `index.html:10-14`, so later files can still override if ever needed):

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

- Use `0.01ms`, **not** `display:none` / `animation: none`, so `comboDeplete`
  (`restartComboTimer()`, `game.js:568-574`, which forces a reflow then reassigns
  `fill.style.animation`) and the `loss-flash`/`win-flash` reflow re-arm logic still get an
  `animationend`-equivalent tick and don't hang waiting on a class that never animates.
- This is intentionally broad (the standard reduced-motion reset). It supersedes nothing in
  `multiplayer.css:179-183` (that block stays — `animation: none` there is fine and more specific).

**(C) Gate JS juice behind matchMedia (`effects.js`).** Add a tiny module-level helper in
`public/js/effects.js` (the natural home — it owns shake + particles) and have the spawn/shake
entry points early-return when reduced motion is requested:

```js
// In effects.js — evaluated once; matchMedia is live so it tracks OS changes.
const reducedMotionMql =
  typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
function prefersReducedMotion() { return !!(reducedMotionMql && reducedMotionMql.matches); }
```

Then guard at the top of `spawnFoodBurst()`, `spawnScorePop()`, and `triggerShake()`
(`effects.js:24/50/59`) with `if (prefersReducedMotion()) return;`. `getShakeOffset()` and
`updateAndDrawEffects()` already no-op when their arrays/`shake.until` are empty, so no further
change is needed — the board simply stays still and clean. Food/crash still give feedback via
`playFoodSound()` / `playCrashSound()` (`game.js:327,582`) and the score/state updates.

- Add `reducedMotionMql` and `prefersReducedMotion` to the `effects.js` Node/Vitest export block
  (`effects.js:146-156`) **and** to `.eslintrc.json` `globals` (both `readonly`) — they are new
  top-level declarations in a `public/js/*` file, so `no-undef` requires the registration or CI fails.

**(D) Screen-reader output (HTML + `game.js`).** Reuse the existing `sr-only` /
`aria-live="polite"` pattern (`#mp-announcer`, `index.html:187`; `.sr-only` defined at
`multiplayer.css:59-62`):
- In `public/index.html`: add `role="img"` + a static `aria-label="Snake game board"` to
  `<canvas id="game-canvas">` (line 125); add `aria-live="polite" aria-atomic="true"` to
  `<span id="score">` (line 162); add a new solo live region next to it, e.g.
  `<span id="game-announcer" class="sr-only" aria-live="assertive"></span>` inside `#desktop-view`.
- In `public/js/game.js` `gameOver()` (line 579): set
  `document.getElementById('game-announcer').textContent =
  \`Game over. Final score ${gameState.score}.\`` right after the final-score write (line 593-596).
  Guard the lookup (`if (el) ...`) like every other DOM access in the file.
- No new top-level JS function is strictly required (we can write inline in `gameOver()`); if a
  helper like `announceGame(text)` is extracted, it **must** be added to `.eslintrc.json` globals.

**Both-transports / both-modes note.** This change is presentation/AT-only — it touches no Firestore
/ RTDB / localStorage payload, so the **localStorage fallback and Firebase paths are identical**.
The shake/particle guard sits in the shared solo render path; multiplayer uses the same
`drawSnake`/`effects` helpers, so the reduced-motion guard benefits the arena too without a separate
branch. No rules change, no schema change.

## 6. Acceptance criteria

Focus visibility:
- [ ] Given keyboard focus on a `.social-link` (mute/leaderboard/LinkedIn/Instagram), When it
  receives `:focus-visible`, Then a `var(--focus-outline)` outline with `outline-offset: 2px` is
  visible and **not** clipped by the pill's `overflow:hidden`.
- [ ] Given keyboard focus on the phone `.center-btn` and each `.share-btn`, Then the same outline
  shows.
- [ ] Given a **mouse/touch** tap (not keyboard) on those controls, Then no focus outline is drawn
  (rule uses `:focus-visible`, not `:focus`) — negative case.
- [ ] `base.css` no longer contains a bare `.btn:focus-visible { outline: none }` that suppresses the
  outline; the merged rule sets `outline: var(--focus-outline)`.

Reduced motion (CSS):
- [ ] Given the OS reports `prefers-reduced-motion: reduce`, Then `body::before` (grid),
  `body::after` (particles), `.game-title` (gradientShift), and `.game-logo` (logoGlow) are
  effectively static (duration `0.01ms`, iteration count `1`).
- [ ] The reduced-motion block uses `animation-duration:0.01ms !important`, **never** `display:none`
  or `animation:none` on `*` (so `comboDeplete`/`loss-flash` reflow logic still settles) — negative case.
- [ ] The existing `multiplayer.css:179-183` reduced-motion block is unchanged and still present.

Reduced motion (JS / canvas):
- [ ] Given `matchMedia('(prefers-reduced-motion: reduce)').matches === true`, When the snake eats
  food, Then `spawnFoodBurst`/`spawnScorePop` early-return (no new entries in `effects.particles` /
  `effects.scorePops`) and `playFoodSound()` still runs.
- [ ] Given the same, When the snake crashes (`gameOver()`), Then `triggerShake` early-returns
  (`effects.shake.until` stays `0`) so `getShakeOffset()` returns `{x:0,y:0}` and the board does not
  translate; `playCrashSound()` still runs.
- [ ] Given reduced motion is **not** requested, Then shake + particles behave exactly as today
  (no behavior change) — negative case.

Screen-reader output:
- [ ] `<canvas id="game-canvas">` has `role="img"` and a non-empty `aria-label`.
- [ ] `<span id="score">` has `aria-live="polite"` (and `aria-atomic="true"`).
- [ ] Given a solo run ends (`GAME_OVER` transition in `gameOver()`), Then the
  `#game-announcer` live region's `textContent` becomes `Game over. Final score <N>.` with `<N>` ==
  `gameState.score`.
- [ ] The new live region uses the existing `.sr-only` class (visually hidden, not removed from the
  a11y tree).

Guardrails:
- [ ] `.eslintrc.json` `globals` updated for every NEW top-level decl added to `effects.js`/`game.js`
  (`reducedMotionMql`, `prefersReducedMotion`, and any extracted announcer helper); `npm run lint`
  green.
- [ ] `node --check` passes on `effects.js` and `game.js`.
- [ ] `npm test` (Vitest, incl. `tests/protocol.test.js`) green — the existing game-over assertions
  (`final-score` === '40') still pass, and no test throws on the new `matchMedia`/live-region code
  under jsdom.
- [ ] `const CACHE` in `public/sw.js` bumped (shell HTML/CSS/JS changed) — e.g. `snake-shell-v11` →
  `snake-shell-v12`.
- [ ] No PII and no 6-digit session code added to any `aria-label` / live region / log.

## 7. Affected files

| File | Change |
| --- | --- |
| `public/css/base.css` | Merge/replace `.btn:focus-visible` into a shared `:focus-visible` rule (`.social-link`/`.center-btn`/`.share-btn`/`.btn-connect`/`.btn-play-again`/`a`/`input`) using `--focus-outline`; add global `@media (prefers-reduced-motion: reduce)` reset. |
| `public/css/desktop.css` | No edit expected (focus + motion handled globally in `base.css`); verify the new outline is not visually clipped on `.social-link` (`overflow:hidden`, line 149). |
| `public/css/mobile.css` | No edit expected; verify `.center-btn` / `.share-btn` outline renders (both have `overflow:hidden`). |
| `public/js/effects.js` | Add `reducedMotionMql` + `prefersReducedMotion()`; early-return guards in `spawnFoodBurst`/`spawnScorePop`/`triggerShake`; extend the `module.exports` block. |
| `public/js/game.js` | In `gameOver()`, push `"Game over. Final score N."` into `#game-announcer`. |
| `public/index.html` | Add `role="img"`+`aria-label` to `#game-canvas`; `aria-live`/`aria-atomic` to `#score`; add `#game-announcer` `sr-only` live region in `#desktop-view`. |
| `.eslintrc.json` | **Globals bump** — register `reducedMotionMql`, `prefersReducedMotion` (and any announcer helper) or `no-undef` fails CI. |
| `public/sw.js` | **CACHE bump** — `snake-shell-v11` → `snake-shell-v12` (shell assets changed). |

No new files required. (`.sr-only` already exists in `multiplayer.css:59`; if preferred it can be
hoisted to `base.css`, but that is optional and not required.)

## 8. Dependencies & sequencing

- **Depends on:** none. Pairs with **Q1** (whatever Q1 touches in the same CSS/markup — land them in
  either order, but if both edit `base.css` / `index.html`, sequence to avoid a merge conflict).
- **Unblocks:** a future full WCAG AA audit and a Lighthouse-a11y CI gate (both become meaningful once
  these baseline failures are gone). Independent of multiplayer and Firebase-rules work.
- Self-contained: can be done in one PR on a `feature/a11y-baseline` branch.

## 9. Risks & mitigations

- **Global-scope / load-order (the main minefield):** new top-level `const`s in `effects.js`
  (`reducedMotionMql`, `prefersReducedMotion`) collide with `no-undef` / `no-redeclare` if not
  registered. *Mitigation:* add them to `.eslintrc.json` `globals` in the same commit; names are
  unique (grep-checked — no existing `prefersReducedMotion`/`reducedMotionMql`). They're declared in
  `effects.js`, which loads before `game.js` (`index.html:308` vs `312`), so `game.js` can read them.
- **Over-broad reduced-motion `*` selector** could flatten a transition that some JS waits on via
  `transitionend`. *Mitigation:* use `0.01ms` (not `0`/`none`) so the event still fires; the only
  reflow-dependent code (`restartComboTimer`, loss/win-flash re-arm) re-assigns `style.animation`
  directly and does not block on `animationend`.
- **`matchMedia` undefined in the jsdom test context** (`tests/protocol.test.js` runs `effects.js`).
  jsdom *does* provide `window.matchMedia` returning `{ matches: false }`, but to be safe the helper
  is typeof-guarded (`typeof matchMedia === 'function'`) and defaults to "motion allowed", so the
  existing game-over/particle assertions are unaffected. *Mitigation:* the guard + default; verified
  against the test's expectations.
- **Outline clipped by `overflow:hidden`** on the pills. *Mitigation:* `outline` is painted outside
  the box and is **not** subject to `overflow` clipping (unlike `box-shadow`); `outline-offset:2px`
  pushes it clear of the gradient edge. This is exactly why `.lb-close:focus-visible` already works.
- **Stale SW serving old CSS locally.** *Mitigation:* bump `CACHE`; when verifying locally,
  unregister the SW + clear caches (network-first SW can serve stale shell assets — per CLAUDE.md).

## 10. Verification / test plan

No local Node — iteration is CI-bound. Concretely for this change:

1. **`npm run lint` (CI, blocking):** confirms the `.eslintrc.json` globals bump matches the new
   `effects.js` declarations; catches a missed registration immediately.
2. **`node --check` (CI, blocking):** syntax-validates the edited `effects.js` and `game.js`.
3. **`npm test` / Vitest (CI, blocking):** `tests/protocol.test.js` already drives a real
   `gameOver()` via the localStorage path and asserts `#mobile-final-score === '40'` — this must
   still pass, proving the new live-region/matchMedia code in `gameOver()` and `effects.js` doesn't
   throw under jsdom. Optionally extend this test (or a new `tests/effects.test.js`) to assert
   `prefersReducedMotion() === false` by default and that `spawnFoodBurst` pushes when motion is
   allowed — pure-logic, fits the existing Vitest harness. (Toggling `matches: true` to assert the
   early-return would require stubbing `matchMedia` in the test context.)
4. **`python -m http.server` + Claude_Preview (manual, visual):** unregister the SW + clear caches
   first. Then:
   - Tab through the header → confirm a visible outline on each `.social-link`; tab the phone view
     (`?session=123456`) → outline on `.center-btn` and each `.share-btn`; mouse-tap → no outline.
   - Emulate reduced motion (DevTools *Rendering → Emulate prefers-reduced-motion: reduce*): confirm
     the grid/particles/title/logo are static and that eating food / crashing produces **no** screen
     shake or particle burst (sound + score still update).
   - Inspect the a11y tree: `#game-canvas` exposes name "Snake game board" (role img); after a
     crash, `#game-announcer` contains "Game over. Final score N."
5. **No scratch Firebase project / emulator needed** — zero rules or schema changes.

## 11. Analytics & observability

Largely N/A — this is presentation/AT polish with no funnel step of its own, and we must **not** add
high-cardinality or PII events. One optional, low-risk signal (route through the hardened
`trackEvent()` in `utils.js`, which no-ops offline and never throws):

- `trackEvent('a11y_reduced_motion', { active: prefersReducedMotion() })` fired **once** at desktop
  init (e.g. end of `initializeDesktopGame()`), to quantify how many real players run with reduced
  motion and validate the effort. Fire at most once per session; no session code, no PII.

If even that is deemed unnecessary, omit it — no analytics change is required for correctness.
