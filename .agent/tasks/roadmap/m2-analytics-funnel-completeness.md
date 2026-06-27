# M2 · Analytics funnel completeness: failures, retention, run-length, NSM

> **Tier** medium · **Focus** Growth · **Impact** Medium · **Effort** S-M · **Priority** 54/100
> **Status** `Not started` · **Depends on** Q6 (consent gate) MUST land first · **Part of** [Roadmap](./README.md)

## 1. Problem — what we're solving

GA4 today instruments the **happy path** but is **blind on the parts that decide whether the growth
model actually works** — failure, abandonment, retention, and engagement depth. Concretely, walking
the funnel against the real call sites:

- **No created→paired conversion is computable.** The desktop fires `session_created`
  (`public/js/network.js:28`) and the phone fires `controller_arrival`
  (`public/js/controller.js:16`), but there is **no failure-exit event**. A desktop code that **no
  phone ever scans** looks *identical* to a session that paired successfully — both emit
  `session_created` and nothing else. We can count sessions created and (separately)
  `controller_connected` (`network.js:138`, `controller.js:330`), but we cannot attribute a drop:
  a phone that opens the link and never connects, or types a wrong code, simply produces no signal.

- **No failure telemetry on the connect path.** `connectViaRobustHybrid()` has three distinct
  unhappy endings and **none is tracked**: session-not-found
  (`controller.js:382-386`, `err.notFound`), Firebase retries exhausted →
  localStorage fallback (`controller.js:394-398`), and the localStorage "session not found"
  branch (`controller.js:433-435`). The desktop's own Firebase setup can also silently fall back to
  localStorage (`network.js:172-176`) with no event.

- **No error / crash telemetry at all.** There is **no `window.onerror` / `unhandledrejection`
  handler** anywhere in `public/` (repo-wide search returns none). A JS exception that breaks the
  game loop is invisible in analytics. The codebase swallows errors deliberately on the gameplay
  path (`trackEvent` `utils.js:52-54`, `triggerHaptic` `controller.js:252-254`,
  `sendHapticFeedback` `network.js:398`) — good for stability, but it means **we never learn** a
  feature is broken in the field.

- **`game_start` / `game_over` carry almost nothing.** `startGame()` fires `game_start` with **`{}`**
  (`game.js:153`); `gameOver()` fires `game_over` with only `{ score, is_high_score }`
  (`game.js:613`). There is **no mode, no player count, no run duration, no food_eaten, no
  max_combo** — so we cannot answer "how long is a typical round?", "do longer rounds correlate with
  return visits?", or "do multiplayer rounds retain better than solo?".

- **Multiplayer uses a *separate event namespace* that blocks segmentation.** MP fires
  `mp_game_start` (`mp-engine.js:28`), `mp_elimination` (`mp-engine.js:176`), and `mp_game_over`
  (`mp-engine.js:210`) — names that are **disjoint** from the solo `game_start` / `game_over`. In GA4
  you cannot trivially compare "rounds played" across modes because they live under different event
  names; every funnel/retention exploration has to union two name sets by hand.

- **No retention signal and no North-Star Metric (NSM).** GA4 auto-collects `first_visit` /
  `session_start`, but nothing ties a *returning device* to *engaged play*. There is no user property
  that segments a one-and-done visitor from a repeat host, and no single "value delivered" event the
  business can rally around.

- **No high-intent rematch signal.** The post-defeat moment is the highest-intent point in the loop
  (the share card is already defeat-aware — `share.js:32-43` builds "rematch?" captions), yet we emit
  **no `rematch_prompt`** event when that card is shown, so we can't measure rematch intent → actual
  replay.

Net: the funnel has a **measurable hole at every transition that isn't success**, plus no depth or
retention instrumentation. This blocks any data-driven growth decision.

## 2. Why it matters

**Focus = Growth, and the whole product is "send the link / scan the QR".** You cannot improve a
funnel you cannot see. The single most important growth number — **created → paired conversion** — is
literally uncomputable today because the failure exits are silent. Adding a failure-exit event and a
60s "never connected" timeout turns a blind spot into a measurable, optimizable rate.

- **Diagnose the pairing drop.** With `controller_connect_failed{reason}` + `controller_never_connected`
  we can split "code typo" from "QR worked but phone abandoned" from "Firebase fell back" — each
  implies a *different* fix (clearer code UI vs. faster join vs. infra).
- **Find the field breakages.** `js_error` / `offline_fallback` surface the bugs that the
  stability-first error swallowing currently hides — essential before "pushing for real users".
- **Pick the right things to build.** `mode` / `duration` / `food_eaten` / `max_combo` on the game
  events let us see whether multiplayer or longer solo runs drive return visits, so roadmap effort
  goes where engagement actually is.
- **A North-Star to steer by.** "Weekly rounds completed by paired hosts" gives the project one number
  that captures real, repeated value — and `player_tier` + `round_completed` make it queryable.
- **Convert the high-intent moment.** `rematch_prompt` at the defeat card measures the exact spot where
  virality and retention compound.

All of it is **purely additive** once Q6's consent gate is in place: every new event routes through the
already-gated `analytics` handle, so it inherits consent with zero per-call-site work.

## 3. Goals

- Make **created → paired conversion computable** by emitting an explicit failure/abandonment signal on
  every non-success exit of the connect path.
  - `controller_connect_failed{reason}` on the phone's known failure branches.
  - `controller_never_connected` fired by a **60s no-connect timer** armed when a controller view opens.
  - `offline_fallback{side}` when either side silently drops Firebase → localStorage.
- Add **error telemetry** (via Q7 / this spec): a global `window.onerror` + `unhandledrejection`
  handler that emits `js_error` with a bounded, PII-free shape.
- **Unify and enrich game events:** `game_start` and `game_over` carry
  `mode` (`solo`|`multi`), `players` (int), `duration_s` (int), `food_eaten` (int), and `max_combo`
  (int) for **both** engines, so solo and MP are one comparable funnel.
- Define an **NSM = weekly rounds completed by paired hosts**, instrumented via:
  - a `player_tier` GA4 **user property** (e.g. `new` | `returning` | `engaged`), and
  - a `round_completed` event fired on every finished round (solo and multi).
- Fire **`rematch_prompt`** at the post-defeat high-intent moment (defeat/game-over card shown).
- Keep every `reason` / enum string **bounded** (low-cardinality) and **never** log PII or the
  6-digit session code.
- Zero gameplay regression; lint + `node --check` + vitest all green; eslintrc globals + `sw.js`
  `CACHE` kept consistent.

## 4. Non-goals

- **No** server-side analytics, no BigQuery export setup, no GA4 console config beyond what's needed to
  register custom dimensions (that's an owner console task, documented not automated).
- **No** consent UI work — that is **Q6** and is a hard prerequisite (this spec assumes the gated
  `analytics` handle already exists).
- **No** error *reporting service* (Sentry et al.) — `js_error` is a lightweight GA4 event only;
  full crash-reporting infra is out of scope.
- **No** change to gameplay, physics, sync payloads, or Firestore/RTDB **rules/schema**. We read
  existing state to enrich events; we do not add new synced fields. (One *local* counter —
  `food_eaten` — is added to `gameState`; it is not written to Firebase.)
- **No** renaming/removal of the existing `game_start` / `game_over` events (keep continuity); MP's
  `mp_*` events are **retired in favor of** the unified names (see §5.4) — that *is* a rename, scoped
  to the three `mp_engine` calls only.
- **No** PII, no session codes, no player handles in any param (guardrail; the leaderboard handle
  `getPlayerName()` must **never** be sent).

## 5. Proposed solution

Everything routes through the existing hardened `trackEvent(name, params)` (`utils.js:46-55`), which
auto-tags `device_role` and no-ops when analytics is absent/declined. **No new analytics plumbing** —
just new call sites + one user-property helper + one global error handler. The `food_eaten` counter is
the only new gameplay-state field. All new top-level symbols must be added to `.eslintrc.json` globals.

### 5.1 Pairing-failure events (phone side — `public/js/controller.js`)

The connect path already has clearly-labelled failure branches; instrument each with a **bounded
`reason`**:

| Where (file:line today) | Branch | New call |
| --- | --- | --- |
| `controller.js:382-386` | `err.notFound` — code typo / host closed | `trackEvent('controller_connect_failed', { reason: 'not_found' })` |
| `controller.js:394-398` | Firebase retries exhausted → localStorage | `trackEvent('controller_connect_failed', { reason: 'firebase_unreachable' })` **and** `trackEvent('offline_fallback', { side: 'phone' })` |
| `controller.js:433-435` | localStorage "session not found" | `trackEvent('controller_connect_failed', { reason: 'ls_not_found' })` |

- `reason` is an **enum** — define a frozen set near the top of `controller.js`, e.g.
  `const CONNECT_FAIL_REASONS = { NOT_FOUND: 'not_found', FIREBASE: 'firebase_unreachable', LS_NOT_FOUND: 'ls_not_found' };`
  so the strings can't drift (low-cardinality guardrail).
- **60s never-connected timer.** In `initializeMobileController()` (`controller.js:8-27`), right after
  the existing `controller_arrival` call (`controller.js:16`), arm a one-shot timer:
  `controllerConnectTimer = setTimeout(() => trackEvent('controller_never_connected', { arrival: method }), 60000);`
  Clear it the moment a connection succeeds — i.e. inside `showControllerInterface()`
  (`controller.js:442-448`), which is the single funnel point both `connectViaRobustHybrid()` (success
  branch `controller.js:327`) and `connectViaLocalStorage()` (`controller.js:412`) pass through —
  `clearTimeout(controllerConnectTimer)`. Guard so MP joins (which go through `connectMultiplayer`,
  `controller.js:321-323`, and do **not** call `showControllerInterface`) also clear the timer: clear it
  in `mpUiPhoneJoined`/`mpUiPhoneQueued` paths too, or simpler — clear in `connectToSession()` success
  callbacks. Pick the single safest clear point: **clear on any successful slot/connection
  established**; document it so the timer can never fire after a real connect.

### 5.2 Desktop offline fallback (`public/js/network.js`)

`setupRobustHybridSession()` silently degrades to localStorage at `network.js:172-176`. Add
`trackEvent('offline_fallback', { side: 'desktop' })` in that catch block (before/after the existing
`setupLocalStorageSession(sessionCode)` call). This pairs with the phone's `offline_fallback{side:'phone'}`
so both transports are observable. `session_created` already records the chosen `connection`
(`network.js:28`); `offline_fallback` captures the **post-hoc** degradation that `session_created`
can miss (Firebase was "ready" at create time, failed during setup).

### 5.3 Global error telemetry — `js_error` (via Q7)

There is no error handler today. Add a single global handler (best placed in `utils.js` so it loads
first and catches early errors, or a tiny new `js/errors.js` loaded right after `utils.js`):

```js
window.addEventListener('error', (e) => {
  trackEvent('js_error', {
    // bounded + PII-free: message truncated, filename basename only, no stack, no URL query
    message: String(e.message || 'unknown').slice(0, 120),
    source: (e.filename || '').split('/').pop().slice(0, 40),
    line: e.lineno | 0
  });
});
window.addEventListener('unhandledrejection', (e) => {
  trackEvent('js_error', { message: String((e.reason && e.reason.message) || e.reason || 'rejection').slice(0, 120), source: 'promise', line: 0 });
});
```

- **Self-protection:** the handler must never re-throw or loop. `trackEvent` already swallows its own
  errors; additionally guard against the handler firing on its own failure (it won't, since `trackEvent`
  is try/caught, but keep the body trivial).
- **PII guardrail:** truncate `message` (stack traces / URLs can contain the `?session=` code — strip to
  message text only; **never** send `e.error.stack` or `window.location`). Use **basename** of
  `filename`, never the full URL. This is the critical review point.
- This is the "via Q7" piece; if Q7 ships separately, this spec consumes it. If not, M2 includes it.

### 5.4 Unify + enrich game events (`game.js` + `mp-engine.js`)

**Add a `food_eaten` counter** to the canonical state factory `createInitialGameState()`
(`state.js:29-52`) — `food_eaten: 0` — so it exists for solo and is reset by `restartGame()`
(`game.js:183`, which rebuilds via `createInitialGameState`). Increment it in `moveSnake()`'s eat block
(`game.js:305-337`, right where `gameState.score += gained`). For MP, per-player `food_eaten` can live on
the player object (sum at round end) or we report round-level `food_eaten` = total fruit consumed; choose
**round-level total** to keep MP param shape identical to solo.

**Record round start time** so duration is derivable. `startGame()` (`game.js:150-174`) and
`startMultiplayerGame()` (`mp-engine.js:16-29`) already set `lastUpdateTime`/`lastMoveTime`; add a
`gameState.roundStartedAt = Date.now()` at both. `duration_s = Math.round((Date.now() - roundStartedAt)/1000)`.

**Unify the events.** Introduce one shared param-builder, e.g. in `game.js` or `utils.js`:

```js
function gameEventParams() {
  const isMulti = gameState.mode === 'multi';
  return {
    mode: isMulti ? 'multi' : 'solo',
    players: isMulti ? gameState.players.length : 1,
    duration_s: gameState.roundStartedAt ? Math.round((Date.now() - gameState.roundStartedAt) / 1000) : 0,
    food_eaten: gameState.food_eaten || 0,
    max_combo: /* solo: track peak combo; multi: max over players */ 0
  };
}
```

- **`game_start`** — `startGame()` (`game.js:153`) and `startMultiplayerGame()` (`mp-engine.js:28`)
  both fire `trackEvent('game_start', { mode, players })` (duration/food are 0 at start; omit or send 0).
  **Retire** `mp_game_start` in favor of `game_start{mode:'multi'}`.
- **`game_over`** — solo `gameOver()` (`game.js:613`) keeps `score` + `is_high_score` **and** adds
  `mode/players/duration_s/food_eaten/max_combo`. MP `endMultiplayerGame()` (`mp-engine.js:210-214`)
  fires `game_over{mode:'multi', players, duration_s, food_eaten, max_combo, winner_score}` —
  **retiring** `mp_game_over`. (Keep `post_score` solo-only — it's a GA4-recommended event tied to the
  leaderboard; not meaningful for MP.)
- **`mp_elimination`** (`mp-engine.js:176`) — **keep** (it has no solo analog); optionally rename to
  `elimination` for consistency, but it's MP-only so low priority. Leave its `{cause, players_alive}`
  shape.
- **`max_combo`:** solo currently zeroes `gameState.combo` on game over before we'd read it
  (`game.js:590`). Track a **peak**: add `gameState.maxCombo` (or reuse a running max in the eat block,
  `game.js:311-315`) so the value survives the reset. MP: max of `players[*].combo` peak — track per
  player in `applyFoodEaten()` (`mp-engine.js:129-131`).

**Both-modes / both-transports:** these events fire off **engine state**, not sync, so they work
identically in Firebase and localStorage modes. Solo path = `game.js`; multi path = `mp-engine.js`;
the shared `gameEventParams()` keeps them aligned.

### 5.5 NSM: `player_tier` user property + `round_completed`

- **`round_completed`** — fire once per finished round (the moment a round reaches `GAME_OVER`), for
  **both** engines: in solo `gameOver()` (`game.js:579-624`) and MP `endMultiplayerGame()`
  (`mp-engine.js:194-214`). Params: `{ mode, players, duration_s }` (subset of `gameEventParams`). This
  is the **countable unit** behind the NSM; `game_over` already fires there, but `round_completed` is the
  explicit, stable NSM event (decoupled from any future `game_over` param churn).
- **`player_tier` user property** — set via `analytics.setUserProperties(...)`, mirroring the existing
  `device_role` tagging in `main.js:18-23` and `detectDevice()` (`main.js:11-37`). Derive the tier from a
  **localStorage round counter** (reuse the resilience pattern in `leaderboard.js` —
  `getHighScores()`/`recordScore()` at `leaderboard.js:13-48`, and the existing keys convention
  `snake_*`, e.g. `const ROUNDS_KEY = 'snake_rounds_played';`):
  - `new` — 0 prior rounds, `returning` — ≥1 prior round across ≥2 distinct days, `engaged` — ≥N rounds
    (pick N, e.g. 5). Exact thresholds are a tunable; keep them in one helper.
  - Set the property **once analytics is enabled** (post-consent). Because Q6 defers the `analytics`
    handle until consent, the tier-set must run **after** `enableAnalytics()` (Q6's new function), not
    unconditionally — wire it where Q6 moves the `device_role` tagging (Q6 §5.1 moves it into
    `enableAnalytics()`); add `player_tier` alongside it. Increment the round counter in
    `round_completed`.
- **NSM definition (for the doc, not code):** *weekly count of `round_completed` events where the
  device is a paired host* — i.e. `device_role = desktop_host` **and** the session reached pairing
  (a `controller_connected{side:'desktop'}` occurred this session). This is computed in GA4 from the
  events; the code's job is to emit the raw signals.

### 5.6 `rematch_prompt` at the defeat moment (`controller.js` / `share.js`)

The defeat-aware share card is shown when the phone transitions to `GAME_OVER`
(`updateMobileGameOver()` `controller.js:504-527`, which un-hides `#mobile-game-over`). Fire
`rematch_prompt` exactly once per loss, on the **same state edge** the loss buzz uses
(`lastSyncedState !== GameState.GAME_OVER`, `controller.js:518-521`):

```js
if (lastSyncedState !== GameState.GAME_OVER) {
  triggerHaptic([120, 60, 120, 60, 240]);
  playLossFlash(card);
  trackEvent('rematch_prompt', { mode: (mpClient.slot ? 'multi' : 'solo') });
}
```

This reuses the existing **once-per-loss edge guard** so it can't double-fire on repeated snapshot
deliveries. The desktop's `gameOver()` could fire its own `rematch_prompt{side implied by device_role}`
if desired, but the **phone** is where the share card and "rematch?" caption live (`share.js:37-42`), so
phone is the primary call site. Pairing with the existing `share` event (`share.js:88-91`) lets us
measure prompt → share conversion.

## 6. Acceptance criteria

- [ ] **Given** a phone opens a controller URL with a wrong code, **when** the not-found branch runs
      (`controller.js:382`), **then** exactly one `controller_connect_failed{reason:'not_found'}` fires
      and no other connect-failed event for that attempt.
- [ ] **Given** Firebase retries are exhausted on the phone (`controller.js:394-398`), **when** it falls
      back to localStorage, **then** `controller_connect_failed{reason:'firebase_unreachable'}` **and**
      `offline_fallback{side:'phone'}` both fire.
- [ ] **Given** localStorage mode with no matching session (`controller.js:433`), **when** connect fails,
      **then** `controller_connect_failed{reason:'ls_not_found'}` fires.
- [ ] **Given** the desktop's hybrid setup throws (`network.js:172`), **when** it degrades to
      localStorage, **then** `offline_fallback{side:'desktop'}` fires.
- [ ] **Given** a controller view opens and **no** connection succeeds within 60s, **then** exactly one
      `controller_never_connected{arrival:'qr'|'manual_code'}` fires.
- [ ] **Given** a controller connects successfully (solo, MP slot claim, **or** localStorage), **then**
      the 60s timer is cleared and `controller_never_connected` **never** fires for that session
      (negative case — verify via all three success paths, incl. the MP `connectMultiplayer` path that
      bypasses `showControllerInterface`).
- [ ] **Given** any uncaught error or unhandled rejection, **when** it propagates to the global handler,
      **then** a `js_error` event fires with `message` ≤120 chars, `source` = filename basename (no
      query string / no full URL), and the handler **never** throws or loops.
- [ ] **Negative (PII guardrail):** `js_error` params contain **no** stack trace, **no** full URL, and
      **no** `?session=` value; injecting an error from a page loaded as `?session=123456` produces a
      `js_error` with **no** `123456` anywhere in its params.
- [ ] **Given** a solo round ends, **then** `game_over` carries `mode:'solo'`, `players:1`, an integer
      `duration_s` > 0, integer `food_eaten` matching fruit eaten, and integer `max_combo` ≥ the peak
      multiplier reached (verify `max_combo` survives the `gameState.combo = 0` reset at `game.js:590`).
- [ ] **Given** a multiplayer round ends, **then** a single `game_over{mode:'multi', players:N,
      duration_s, food_eaten, max_combo, winner_score}` fires and **`mp_game_over` no longer fires**.
- [ ] **Given** any round starts (solo or multi), **then** `game_start{mode, players}` fires and
      **`mp_game_start` no longer fires**.
- [ ] **Given** a round finishes (solo or multi), **then** exactly one `round_completed{mode, players,
      duration_s}` fires.
- [ ] **Given** analytics is enabled post-consent, **then** a `player_tier` user property is set to one
      of `new`|`returning`|`engaged`, derived from the localStorage round counter, and set **only after**
      `enableAnalytics()` (Q6) — never before consent.
- [ ] **Given** the phone shows the defeat/game-over card (`controller.js:518` edge), **then** exactly
      one `rematch_prompt{mode}` fires per loss — and **not** again on repeated snapshots of the same
      `GAME_OVER` state.
- [ ] **Enum-bounded:** all `reason` values come from the frozen `CONNECT_FAIL_REASONS` set; no free-form
      strings reach `trackEvent`.
- [ ] **Consent gate respected:** with consent absent/declined (Q6), **none** of the new events emit a
      `/g/collect` beacon (they all no-op through the gated `analytics` handle) and nothing throws.
- [ ] **Guardrails:** `.eslintrc.json` `globals` updated for every new top-level symbol
      (`CONNECT_FAIL_REASONS`, `controllerConnectTimer`, `gameEventParams`, `ROUNDS_KEY`, the
      `player_tier`/tier helper, any `errors.js` symbols); `sw.js` `CACHE` bumped (`v11`→`v12`) **iff**
      a new shell file (`js/errors.js`) is added to `SHELL_ASSETS`; no PII/session code logged.
- [ ] **CI green:** `npm run lint` (no new `no-undef`), `node --check` on every edited file, and
      `npm test` (vitest, incl. `tests/protocol.test.js` jsdom smoke) all pass.

## 7. Affected files

| File | Change |
| --- | --- |
| `public/js/controller.js` | Add `CONNECT_FAIL_REASONS` enum; fire `controller_connect_failed{reason}` on the three failure branches (`:382`, `:394`, `:433`); arm 60s `controllerConnectTimer` in `initializeMobileController()` (`:16`) → `controller_never_connected`; clear it on any successful connect; add `offline_fallback{side:'phone'}` on Firebase fallback; add `rematch_prompt` on the loss edge in `updateMobileGameOver()` (`:518`). |
| `public/js/network.js` | Add `offline_fallback{side:'desktop'}` in the hybrid-setup catch (`:172-176`). |
| `public/js/game.js` | Increment `food_eaten` + track `maxCombo` in the eat block (`:305-337`); set `roundStartedAt` in `startGame()` (`:150`); enrich `game_start` (`:153`) and `game_over` (`:613`) via `gameEventParams()`; fire `round_completed` in `gameOver()`. |
| `public/js/mp-engine.js` | Set `roundStartedAt` in `startMultiplayerGame()` (`:16`); **rename** `mp_game_start`→`game_start{mode:'multi'}` (`:28`) and `mp_game_over`→`game_over{mode:'multi',...}` (`:210`); track per-player combo peak + round `food_eaten`; fire `round_completed` in `endMultiplayerGame()`. |
| `public/js/state.js` | Add `food_eaten: 0`, `roundStartedAt: 0`, and `maxCombo: 0` to `createInitialGameState()` (`:29-52`) so solo + restart reset them. |
| `public/js/utils.js` | (Option A) Add the global `window.onerror` + `unhandledrejection` → `js_error` handler here (loads first); OR keep `trackEvent` only and put the handler in a new `errors.js` (Option B). Possibly host `gameEventParams()` here. |
| `public/js/errors.js` | **NEW (Option B only).** Global error handler → `js_error`. If added: insert in `index.html` right after `utils.js`, add to `sw.js` `SHELL_ASSETS`, **bump `CACHE` v11→v12**, and register globals. |
| `public/js/main.js` | Add `player_tier` user-property set alongside Q6's relocated `device_role` tagging (`:18-23`); must run only after `enableAnalytics()` (Q6). |
| `public/js/leaderboard.js` *(or new tiny helper)* | A `ROUNDS_KEY` localStorage round counter + tier-derivation helper (reuse the `snake_*` key + `safeParse` resilience pattern, `:7-48`). May instead live in `utils.js`/`main.js` — keep it in one place. |
| `public/index.html` | (Option B only) `<script src="js/errors.js">` after `utils.js`, before `logic.js`/`config.js`. |
| `.eslintrc.json` | **Globals bump** — `CONNECT_FAIL_REASONS`, `controllerConnectTimer`, `gameEventParams`, `ROUNDS_KEY`, tier helper, any `errors.js` symbols. **CI fails otherwise.** |
| `public/sw.js` | **Bump `CACHE` v11→v12** *only if* a new shell file (`errors.js`) is added; also add it to `SHELL_ASSETS`. |
| `.agent/system/analytics.md` | Add the new events to the table (`:33-47`): `controller_connect_failed`, `controller_never_connected`, `offline_fallback`, `js_error`, `round_completed`, `rematch_prompt`; document the enriched `game_start`/`game_over` params, the retirement of `mp_game_start`/`mp_game_over`, the `player_tier` user property, and the NSM definition. |

## 8. Dependencies & sequencing

- **Hard dependency: Q6 (consent gate) MUST land first.** M2 *increases the volume and sensitivity* of
  collected events, and Q6 explicitly **GATES M2** (Q6 §1, §8). Because Q6 defers the `analytics` handle
  until consent, all new M2 events inherit consent for free — but the `player_tier` user-property set
  must hook into Q6's **`enableAnalytics()`** (Q6 §5.1), not run unconditionally. Do **not** start M2
  user-property wiring until that function exists.
- **Soft dependency: Q7 (error telemetry).** The brief routes `window.onerror → js_error` "via Q7". If
  Q7 lands first, M2 consumes its handler; if not, M2 includes §5.3. Either way the `js_error` shape and
  PII rules defined here are authoritative.
- **Internal ordering:** (1) state field + `gameEventParams` helper, (2) enrich solo + MP game events,
  (3) failure/abandonment events, (4) `round_completed` + `player_tier`, (5) `rematch_prompt`, (6)
  `js_error`. Each is independently shippable and CI-checkable.
- **GA4 console (owner task, not code):** register custom dimensions for the new params
  (`mode`, `reason`, `players`, `duration_s`, `food_eaten`, `max_combo`, `player_tier`) so they're
  queryable in Explorations. Document in `analytics.md`; do **not** automate.

## 9. Risks & mitigations

- **PII / session-code leak via `js_error` (highest risk).** Stack traces and `window.location` can
  contain the `?session=` code. **Mitigation:** send **only** truncated `message` + filename **basename**
  + line number; **never** stack, never URL. Acceptance test injects an error on a `?session=123456`
  page and asserts the code never appears. This is the must-review line.
- **Global-scope / load-order (the perennial one).** New top-level symbols in 4+ files break `no-undef`
  if not registered. **Mitigation:** update `.eslintrc.json` globals in the same PR (CI's `no-undef` is
  the safety net — that failure is the feature). If `errors.js` is added, place it **after `utils.js`**
  (needs `trackEvent`) and bump `CACHE` + `SHELL_ASSETS`.
- **`max_combo` read after reset.** `gameOver()` zeroes `combo` before event time (`game.js:590`).
  **Mitigation:** track a running `maxCombo` peak in the eat block, not the live `combo`.
- **Double-fire on snapshot replays.** Firestore/RTDB redeliver the same `GAME_OVER` snapshot.
  **Mitigation:** `rematch_prompt` and any per-loss event ride the existing
  `lastSyncedState !== GAME_OVER` edge guard (`controller.js:518`), the same one the loss buzz uses.
- **Timer fires after a real connect (false abandonment).** **Mitigation:** clear
  `controllerConnectTimer` at the **single** success choke point reachable by *all* connect paths (solo,
  MP, localStorage); add an acceptance test per path, incl. the MP path that skips
  `showControllerInterface`.
- **Event-name churn breaks existing GA4 reports.** Retiring `mp_game_start`/`mp_game_over` orphans any
  saved MP explorations. **Mitigation:** document the rename in `analytics.md`; the unified `game_*{mode}`
  is strictly more useful. Keep `mp_elimination` (no solo analog) to minimize churn.
- **Cardinality blow-up.** Free-form `reason`/`message` would explode GA4 dimensions. **Mitigation:**
  `reason` is a frozen enum; `message` is truncated and naturally bounded by the small code surface.
- **Consent regression.** If a new event is wired to a non-gated path it could fire pre-consent.
  **Mitigation:** *every* new event goes through `trackEvent` only (never `analytics.logEvent` directly,
  except the `player_tier` user-property set, which is hooked into Q6's `enableAnalytics()`).

## 10. Verification / test plan

Given **no local Node** (CI-bound) and a **network-first SW**:

1. **Vitest (CI, blocking).** Extract the pure helpers to be `module.exports`-testable like
   `utils.js:73-78` / `logic.js`: `gameEventParams()` shape (mode/players/duration/food/combo from a
   mock `gameState`), the `CONNECT_FAIL_REASONS` enum (frozen, exact values), the **`js_error`
   sanitizer** (given a message containing `?session=123456` and a full file URL, assert the output
   strips the code and keeps only the basename — this is the security-critical unit test), and the
   `player_tier` derivation (given counts/days → `new`|`returning`|`engaged`). Add to `tests/`.
2. **`node --check`** on every edited file proves they parse (part of CI).
3. **`npm run lint`** proves the globals list tracks the new symbols (the `no-undef` gate is the
   feature). Confirm no new `no-undef`; `no-unused-vars` warnings for cross-file functions are expected
   and OK.
4. **`python -m http.server` + Claude_Preview (manual, the real proof).** Serve `public/`, **unregister
   the SW + clear caches first** (network-first serves stale assets locally). With Q6 **accepted** so
   analytics is live, watch the Network panel for `https://www.google-analytics.com/g/collect`
   (`analytics.md:80-85`) and assert `en=<event>` for each:
   - Wrong code → `controller_connect_failed{reason:not_found}`.
   - Open `?session=999999` (no host) and wait 60s → `controller_never_connected`; then with a real
     host, connect within 60s → **no** such event.
   - Play and lose a solo round → `game_start{mode:solo}`, `game_over` with non-zero `duration_s` /
     `food_eaten` / `max_combo`, `round_completed`.
   - Throw a test error in the console (`throw new Error('x?session=123456')`) → `js_error` with **no**
     `123456` in `ep.*` params (inspect the beacon query string).
   - On the phone view, lose → `rematch_prompt` fires once; re-receiving the snapshot does **not** refire.
   - With Q6 **declined / DNT on** → **zero** `/g/collect` beacons for all the above (consent gate).
5. **No scratch Firebase project / emulator needed** — M2 touches **no** `firestore.rules` /
   `database.rules.json` and adds **no** synced fields, so the rules path is **N/A**.

## 11. Analytics & observability

New events (all via `trackEvent`, all `device_role`-tagged, all bounded/PII-free):

| Event | Params | Fired in |
| --- | --- | --- |
| `controller_connect_failed` | `reason` (`not_found`\|`firebase_unreachable`\|`ls_not_found`) | `controller.js` failure branches |
| `controller_never_connected` | `arrival` (`qr`\|`manual_code`) | `controller.js` 60s timer |
| `offline_fallback` | `side` (`desktop`\|`phone`) | `network.js` setup catch / `controller.js` fallback |
| `js_error` | `message` (≤120c, sanitized), `source` (basename/`promise`), `line` (int) | global `window.onerror`/`unhandledrejection` |
| `round_completed` | `mode`, `players`, `duration_s` | `game.js` `gameOver()` + `mp-engine.js` `endMultiplayerGame()` |
| `rematch_prompt` | `mode` (`solo`\|`multi`) | `controller.js` `updateMobileGameOver()` loss edge |

Enriched existing events: `game_start{mode, players}`; `game_over{score, is_high_score, mode, players,
duration_s, food_eaten, max_combo}`; MP `game_over` adds `winner_score`. **Retired:** `mp_game_start`,
`mp_game_over` (folded into `game_*{mode:'multi'}`). **Kept:** `mp_elimination`, `post_score` (solo).

User property: **`player_tier`** (`new`\|`returning`\|`engaged`), set via `analytics.setUserProperties`
alongside Q6's relocated `device_role` tag, post-consent only.

**North-Star Metric (definition, GA4-side):** *weekly `round_completed` events from paired desktop
hosts* — i.e. `device_role = desktop_host` sessions that also saw `controller_connected{side:desktop}`.
The code emits the raw signals; the NSM is a saved GA4 Exploration. **Funnels to watch:**
`session_created` → `controller_arrival` → `controller_connected` (with `controller_connect_failed` /
`controller_never_connected` as the leak), and `rematch_prompt` → `share` / next `game_start`.

**Observability:** confirm each event in GA4 **DebugView / Realtime** (`analytics.md:52-58`); confirm
**no** beacons under a declined/DNT session (absence is the consent test). Register the new params as
**custom dimensions** in GA4 Admin so they're queryable. **Doc:** update `.agent/system/analytics.md`
events table (`:33-47`) and add the NSM + `player_tier` notes.
