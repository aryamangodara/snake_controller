# Q7 · Global error trap + listener-error recovery

> **Tier** quick-win · **Focus** Launch-readiness · **Impact** Medium · **Effort** S (hours) · **Priority** 70/100
> **Status** `Not started` · **Depends on** none · **Part of** [Roadmap](./README.md)

## 1. Problem — what we're solving

There are **zero** `window.onerror` / `window.addEventListener('error', …)` / `unhandledrejection`
handlers anywhere in `public/` (confirmed: a repo-wide search for
`onerror | unhandledrejection | addEventListener('error'` returns **no matches** under `public/`).
An uncaught throw anywhere in the app therefore fails **silently** — nothing is logged to GA4, the
user sees no signal, and in the worst case the game **wedges with no recovery**:

- **The `requestAnimationFrame` loop is single-threaded and self-re-arming.** `updateGame()` in
  `public/js/game.js:206-242` only schedules the next frame at the very end:
  `gameLoop = requestAnimationFrame(updateGame)` (`public/js/game.js:240`). Everything that runs
  *before* that line is unguarded — `updateMultiplayerFrame()` (`game.js:215`), `moveSnake()`
  (`game.js:222`), `updateSnakeDirection()` (`game.js:218`), and `renderGame()` (`game.js:236`).
  If **any** of them throws once, the function unwinds before line 240, the loop is **never
  re-armed**, and the game is frozen permanently with no error surfaced. The start path
  (`startGameLoop()`, `game.js:143`) has the same shape. There is no `try/catch` around the frame
  body and no top-level trap to even *report* the freeze.

- **Firebase listeners can drop their error callback silently.** The desktop attaches two live
  listeners with **no error handler**:
  - RTDB joystick stream: `sessionManager.realtimeRef.on('value', (snapshot) => { … })`
    (`public/js/network.js:128`) — `.on()` takes an optional second `errorCallback` that is
    **not supplied**, so a permission-denied / network error cancels the listener with no signal
    and the desktop stops receiving joystick input.
  - Firestore actions/roster snapshot:
    `sessionManager.firestoreUnsubscribe = sessionDoc.onSnapshot((doc) => { … })`
    (`public/js/network.js:149`) — `onSnapshot` accepts an optional error callback that is **not
    supplied**; on error the listener detaches and start/restart actions from the phone silently
    stop arriving. Neither listener is ever **re-subscribed** after a drop.

The only error visibility today is `console.error(...)` at scattered call sites (e.g.
`network.js:173`, `network.js:378`) — invisible to GA4 and to the player. For a publicly-linked,
share-driven app this means a launch-day regression on some device/browser could wedge silently
with **no telemetry to even know it happened**.

## 2. Why it matters

**Launch-readiness / "pushing for real users".** The growth model is "share the link / scan the
QR" — the app runs on a long tail of phones and browsers we never test. A single uncaught throw on
one of those devices currently produces a **black-box freeze**: no recovery affordance for the user
and no signal for us. Two concrete wins:

- **Recovery for the user.** A non-blocking "something went wrong — reload" affordance turns a dead
  page into a one-tap recovery, salvaging the session (and, for a host, the QR pairing) instead of
  losing the player.
- **Observability for us.** Routing uncaught errors through `trackEvent('js_error', …)` gives a
  GA4 signal that a class of devices is failing — the difference between *finding out from the
  metrics* and *finding out from a bad review*. This directly de-risks "go live": you can watch the
  `js_error` rate after each deploy.

The fix is small (hours), additive, and reuses the already-hardened `trackEvent()` wrapper — high
launch-readiness leverage per line changed.

## 3. Goals

- Install a **global error trap** (uncaught `error` events **and** `unhandledrejection`) once, early,
  on every device role, that reports each error via `trackEvent('js_error', { … })` with
  **bounded, low-cardinality** params (never the message text raw, never PII, never the 6-digit code).
- Surface a **non-blocking** "Something went wrong — Reload" affordance when a real error is trapped,
  so a wedged page is recoverable with one tap. It must not cover gameplay or fire on benign noise.
- Make the `requestAnimationFrame` frame body **crash-tolerant**: an exception inside one frame must
  be reported and must **not** permanently kill the loop (best-effort re-arm), so a transient throw
  degrades to a dropped frame, not a dead game.
- Give both desktop Firebase listeners (`on('value', …)`, `onSnapshot(…)`) an **error callback** and
  **re-subscribe** the dropped listener (bounded retries with backoff), reporting the drop via
  `trackEvent`.
- Stay **guardrail-clean**: hardened/no-throwing reporting (reuse `trackEvent`), bounded GA4
  cardinality, `.eslintrc.json` globals updated for any new top-level declarations, `sw.js` `CACHE`
  bumped, lint + `node --check` + Vitest green.

## 4. Non-goals

- **No third-party error-reporting SDK** (Sentry/Bugsnag/etc.). Reporting goes through the existing
  GA4 `trackEvent` path only — no new vendor, no new `<script>` tag, no new CSP/SRI surface.
- **No source-map upload / stack-symbolication pipeline.** We capture a coarse, bounded signal, not
  full stack traces.
- **No change to the localStorage fallback transport's data flow.** (The localStorage `storage`
  listener in `network.js:226` is synchronous and already `safeParse`-guarded; it has no async
  error channel to re-subscribe. The global trap still covers any throw it raises.)
- **No automatic game state reload / hot-recovery** beyond re-arming the loop and re-subscribing
  listeners — the user-facing recovery is an explicit "Reload" affordance, not a silent reset.
- **No retry of the *one-shot* session-setup path** (`setupRobustHybridSession`) — it already falls
  back to localStorage on failure (`network.js:172-176`). Scope is the **long-lived listeners**.

## 5. Proposed solution

Three additive pieces. None changes existing data shapes, so **both transports** (Firebase hybrid +
localStorage) and **both modes** (solo `game.js` + multi `mp-*.js`) are covered by the same trap.

### 5.1 A hardened error-reporting helper in `utils.js`

Add **one** small function next to `trackEvent` (`public/js/utils.js:46-55`) that turns an arbitrary
error into a **bounded, enumerated** GA4 event. It must mirror `trackEvent`'s "never throw into
gameplay" discipline (its own `try/catch`).

```js
// public/js/utils.js  (new — exported in eslintrc globals + module.exports for Vitest)
/**
 * Report an uncaught error to GA4 as a low-cardinality signal. NEVER logs the raw
 * message (cardinality + PII risk) — only a bounded `reason` enum, a clamped error
 * NAME, and a numeric source line. Reuses trackEvent (no-ops offline, never throws).
 * @param {string} reason - bounded enum: 'window_error' | 'unhandled_rejection' |
 *                          'raf_loop' | 'rtdb_listener' | 'firestore_listener'
 * @param {*} err - the thrown value (Error or otherwise)
 * @param {object} [extra] - additional low-cardinality params (numbers/bounded enums only)
 */
function reportError(reason, err, extra = {}) {
    try {
        const name = (err && err.name ? String(err.name) : 'Error').slice(0, 40);
        trackEvent('js_error', { reason, error_name: name, ...extra });
        if (typeof console !== 'undefined') console.error('[js_error]', reason, err);
    } catch (_) { /* reporting must never throw */ }
}
```

Key cardinality decisions (to avoid a GA4 dimension blowup):

- `reason` is a **fixed enum** of ~5 values.
- `error_name` is the JS error **constructor name** (`TypeError`, `RangeError`, …) **clamped to 40
  chars** — bounded, not the free-text `.message`.
- **Never** include `err.message`, `err.stack`, URLs, or the session code — those are unbounded and
  can carry PII/the 6-digit code.

### 5.2 Global trap installed in `main.js`

Install the trap **as early as possible** — in `main.js` at module-evaluation time (top level), not
inside the `DOMContentLoaded` callback (`public/js/main.js:53-57`), so errors during the rest of boot
are caught too. `main.js` is the **last** script loaded (`index.html:317`), so `reportError` /
`trackEvent` from earlier files are already defined.

```js
// public/js/main.js  (new top-level — runs on import, before DOMContentLoaded)
function installGlobalErrorTrap() {
    window.addEventListener('error', function (e) {
        reportError('window_error', e && e.error, { source_line: (e && e.lineno) || 0 });
        showErrorRecovery();
    });
    window.addEventListener('unhandledrejection', function (e) {
        reportError('unhandled_rejection', e && e.reason);
        showErrorRecovery();
    });
}
installGlobalErrorTrap();
```

The user-facing affordance `showErrorRecovery()` is **non-blocking**, **idempotent** (shows once —
guarded by a module-level boolean so an error storm doesn't stack banners), and offers a Reload
button (`location.reload()`). Render it as a small fixed-position toast/bar built with
`document.createElement` + `textContent` (XSS-safe, same discipline as `renderJoinFallback`,
`network.js:299-331`). Reuse the existing toast styling token surface if practical — note
`showToast` already exists in `share.js` (`.eslintrc.json:202`); prefer a **dedicated, dismissible**
recovery bar so it persists until the user acts (a transient toast would vanish before they read it).
It must sit above gameplay (`z-index`) but **not** intercept canvas pointer/touch events except on
its own button.

### 5.3 RAF loop hardening in `game.js`

Wrap the **body** of `updateGame()` (`public/js/game.js:206-242`) so a throw is reported and the loop
still re-arms — converting a permanent freeze into at most a dropped frame:

```js
function updateGame(currentTime) {
    if (!gameState.gameRunning) return;
    try {
        // … existing frame body (lines 209-237) unchanged …
    } catch (err) {
        reportError('raf_loop', err, { mode: gameState.mode === 'multi' ? 1 : 0 });
        // surface recovery but DON'T kill the loop — one bad frame shouldn't wedge the game
        if (typeof showErrorRecovery === 'function') showErrorRecovery();
    }
    if (gameState.gameRunning) {
        gameLoop = requestAnimationFrame(updateGame);
    }
}
```

`mode` is encoded as a **number** (0/1), not a string, to keep GA4 params numeric/low-cardinality.
The re-arm now lives **outside** the try, so it runs even when the body throws.

### 5.4 Listener error callbacks + re-subscribe in `network.js`

Give both desktop listeners their error callback and re-attach on drop with **bounded** retries and
backoff. Factor the existing inline listener bodies (`network.js:128-145` for RTDB,
`network.js:149-165` for Firestore) into named functions so the error path can re-call the same
attach logic without duplicating the closure.

```js
// public/js/network.js  — sketch
let mpListenerRetries = 0;                       // module-level, new eslintrc global
const MAX_LISTENER_RETRIES = 3;

function attachRealtimeListener(ref) {
    ref.on('value',
        (snapshot) => { /* existing body, network.js:129-144 */ },
        (err) => {                               // <-- NEW error callback
            reportError('rtdb_listener', err);
            resubscribeListeners('rtdb');
        });
}
// onSnapshot's 2nd arg is the error callback:
sessionManager.firestoreUnsubscribe = sessionDoc.onSnapshot(
    (doc) => { /* existing body, network.js:150-164 */ },
    (err) => { reportError('firestore_listener', err); resubscribeListeners('firestore'); }
);
```

`resubscribeListeners()` re-attaches the dropped listener (guarded by `firebaseReady` &&
`sessionManager.currentSession`), increments `mpListenerRetries`, and stops after
`MAX_LISTENER_RETRIES` (then leaves the "Reload" affordance as the user's recovery). Use a short
backoff (`setTimeout`) before re-attaching to avoid a permission-denied hot loop. **No new event
shape** is written, so the phone side and the rules are untouched.

> **Both-transports note:** the localStorage fallback path has no async error callback to wire — its
> `storage` handler is synchronous and `safeParse`-guarded (`network.js:226-242`). It is covered by
> the §5.2 global trap and needs no per-listener change.

## 6. Acceptance criteria

- [ ] **Trap exists & is early.** `public/js/main.js` registers both `window.addEventListener('error',
      …)` and `window.addEventListener('unhandledrejection', …)` at **top level** (runs before the
      `DOMContentLoaded` handler), on every device role.
- [ ] **Given** an uncaught synchronous error is thrown, **when** it bubbles to `window`, **then** a
      `js_error` GA4 event fires with `reason: 'window_error'` and a bounded `error_name` (constructor
      name, ≤40 chars) — verified via the `/g/collect` beacon query string (`en=js_error`).
- [ ] **Given** a rejected promise with no `.catch`, **when** `unhandledrejection` fires, **then** a
      `js_error` event fires with `reason: 'unhandled_rejection'`.
- [ ] **No raw message / no PII / no code.** The `js_error` event params contain **no** `err.message`,
      `err.stack`, URL, or the 6-digit session code — only the bounded `reason` enum, clamped
      `error_name`, and numeric fields (`source_line`, `mode`). Verified by inspecting the beacon and
      by code review.
- [ ] **`reportError` is hardened.** `reportError()` never throws even when `analytics` is undefined
      (offline/ad-block) and when passed a non-Error value (`reportError('x', undefined)`,
      `reportError('x', 'string')`, `reportError('x', null)` all no-throw). Covered by a Vitest unit.
- [ ] **RAF loop survives a throw.** **Given** the frame body throws once, **when** `updateGame`
      runs, **then** a `js_error` with `reason: 'raf_loop'` fires **and** the next
      `requestAnimationFrame(updateGame)` is still scheduled (the loop is NOT permanently wedged).
      Verified in Preview by forcing a one-shot throw and confirming the loop continues.
- [ ] **Recovery affordance.** A non-blocking, **dismissible** "Something went wrong — Reload" element
      appears when a real error is trapped; its Reload button calls `location.reload()`. It is
      idempotent (a second/third error does **not** stack a second banner) and does not block
      canvas input outside its own button.
- [ ] **Negative — no false positives.** The affordance does **not** appear during a normal
      session: load the app, create a session, play and lose a solo round, restart — **zero**
      `js_error` events and **no** recovery banner. (Guards against benign-noise misfires.)
- [ ] **RTDB listener error callback.** `realtimeRef.on('value', …)` is called with a **second
      error-callback argument**; on error it fires `js_error` with `reason: 'rtdb_listener'` and
      attempts re-subscribe (bounded to `MAX_LISTENER_RETRIES`).
- [ ] **Firestore listener error callback.** `sessionDoc.onSnapshot(…)` is called with an **error
      callback**; on error it fires `js_error` with `reason: 'firestore_listener'` and attempts
      re-subscribe (bounded).
- [ ] **Re-subscribe is bounded.** Listener re-subscription stops after `MAX_LISTENER_RETRIES`
      (no infinite permission-denied hot loop), with a backoff between attempts.
- [ ] **Guardrails.** `.eslintrc.json` `globals` updated for every new top-level declaration
      (`reportError`, `installGlobalErrorTrap`, `showErrorRecovery`, `attachRealtimeListener`,
      `resubscribeListeners`, `mpListenerRetries`, `MAX_LISTENER_RETRIES`, plus any helper added).
      `sw.js` `CACHE` bumped (`snake-shell-v11` → `v12`) since shell JS changed.
- [ ] **CI green.** `npm run lint` (no new `no-undef` errors), `node --check` on every touched file,
      and `npm test` (Vitest) all pass.

## 7. Affected files

| File | Change |
| --- | --- |
| `public/js/utils.js` | **New** `reportError(reason, err, extra)` helper (hardened, bounded params); add to `module.exports` for Vitest. |
| `public/js/main.js` | **New** top-level `installGlobalErrorTrap()` (registers `error` + `unhandledrejection`) and `showErrorRecovery()` (idempotent, dismissible recovery bar). |
| `public/js/game.js` | Wrap `updateGame()` frame body in `try/catch`; move the `requestAnimationFrame` re-arm **outside** the try so a throw can't wedge the loop; report via `reportError('raf_loop', …)`. |
| `public/js/network.js` | Add error callbacks to `realtimeRef.on('value', …)` and `sessionDoc.onSnapshot(…)`; **new** `attachRealtimeListener()` + `resubscribeListeners()` + module-level `mpListenerRetries` / `MAX_LISTENER_RETRIES`. |
| `tests/error-trap.test.js` | **New** Vitest unit for `reportError` (no-throw on missing analytics / non-Error inputs; bounded `error_name`; no raw message leaked). |
| `.eslintrc.json` | **BUMP** `globals`: add every new top-level decl (see AC) or CI `no-undef` fails. |
| `public/sw.js` | **BUMP** `const CACHE` `snake-shell-v11` → `snake-shell-v12` (shell JS changed; installed SWs need it to fetch fresh code). |
| `css/base.css` (or `desktop.css`/`mobile.css`) | *Optional* — style for the recovery bar if not done inline; if a new CSS file/class is added, keep load order and bump `CACHE`. |
| `.agent/system/analytics.md` | Add the `js_error` row to the events table (doc parity; not CI-blocking but expected). |

## 8. Dependencies & sequencing

- **Depends on:** none. `trackEvent()` (`utils.js:46`) already exists and is hardened, so
  `reportError` is a thin, immediate add.
- **Sequencing within the change:** `utils.js` (`reportError`) must land **before/with** the
  `main.js`, `game.js`, `network.js` call sites that use it — same load-order rule as every other
  cross-file global (utils.js is loaded **first**, `index.html:300`, so order is naturally satisfied).
- **Relationship to Q6 (privacy/consent gate):** Q6 notes the M2 funnel expansion includes
  `js_error` telemetry. This initiative is independent and can land first — because `js_error` routes
  through the **same** `trackEvent` no-op-when-no-consent path, if Q6 later withholds the `analytics`
  handle until consent, `js_error` events automatically degrade to no-ops with **no change here**.
- **Relationship to M4 (per-slot RTDB listeners):** if M4 reworks the RTDB listener topology, the
  §5.4 error-callback/re-subscribe wiring should be applied to the new per-slot listeners too; the
  `reportError`/recovery primitives from §5.1–5.2 are reused unchanged.

## 9. Risks & mitigations

| Risk | Mitigation |
| --- | --- |
| **GA4 cardinality blowup** from error text. | Never log `.message`/`.stack`; `reason` is a fixed ~5-value enum; `error_name` is the constructor name clamped to 40 chars; all other params numeric. |
| **PII / session-code leak** via an error string. | No free-text, no URL, no code in params (AC + code review). The 6-digit code never appears in any `js_error` field. |
| **Error storm** (the trap itself spams GA4 / stacks banners). | `showErrorRecovery()` is idempotent (module-level shown-once flag); consider a simple per-load cap on `js_error` sends; `reportError` swallows its own errors. |
| **Re-subscribe hot loop** on a permanent permission-denied error. | Bounded `MAX_LISTENER_RETRIES` with `setTimeout` backoff; after the cap, stop and rely on the user-facing Reload affordance. |
| **Recovery bar blocks gameplay** (covers canvas / eats touches). | Fixed-position, non-modal, `pointer-events` only on its own button; dismissible; sits in a corner, not over the board. |
| **Global trap masks a real crash in dev.** | `reportError` also `console.error`s (un-gated, per CLAUDE.md convention) so the raw error is still visible in DevTools; we only *report + recover*, we don't swallow-and-hide. |
| **`no-undef` CI failure** from forgetting a global. | The eslintrc `globals` bump is itself an AC; CI is the backstop ("that failure is the feature"). |
| **Stale SW serves old JS** after deploy. | Bump `CACHE` (AC); SW is network-first so online users get fresh code on next load anyway. |

## 10. Verification / test plan

No local Node — iteration is CI-bound; visual checks via `python -m http.server` + Claude_Preview.

1. **Vitest (pure-logic, CI-blocking).** New `tests/error-trap.test.js` exercises `reportError`
   (imported via the `module.exports` hook in `utils.js`, same pattern as `safeParse`/`sanitizeName`,
   `utils.js:73-78`): asserts it (a) does **not** throw when `analytics` is undefined, (b) does
   **not** throw on non-Error inputs (`undefined`, `null`, `'string'`, `{}`), (c) clamps a long
   `error.name` to ≤40 chars, and (d) — by stubbing/spying the `trackEvent`→`analytics.logEvent`
   path — that the emitted params contain **no** `message`/`stack` key. Run via `npm test`.
2. **Lint (CI-blocking).** `npm run lint` must report **no new `no-undef` errors** — i.e. every new
   top-level decl is in `.eslintrc.json` `globals`. (Cross-file `no-unused-vars` *warnings* for the
   new functions are expected and acceptable per CLAUDE.md.)
3. **`node --check` (CI-blocking).** Syntax pass on `utils.js`, `main.js`, `game.js`, `network.js`,
   `sw.js`.
4. **Claude_Preview (manual, visual).** Serve `public/` via `python -m http.server`; **unregister the
   SW and clear caches** first. Then:
   - **Trap + report:** in `preview_eval`, run `window.dispatchEvent(new ErrorEvent('error', { error:
     new TypeError('x'), lineno: 1 }))` and `Promise.reject(new Error('y'))`; confirm via
     `preview_network` a `/g/collect` beacon with `en=js_error` and `ep.reason=window_error` /
     `unhandled_rejection`, and via `preview_snapshot` that the recovery bar appears **once**.
   - **RAF survival:** temporarily monkeypatch `renderGame` to throw once
     (`preview_eval`), start a solo round, and confirm the loop **keeps running** afterward (snake
     still moves) and exactly one `raf_loop` `js_error` fired.
   - **No false positives:** play a clean solo round (create session, start, lose, restart) and
     confirm **zero** `js_error` beacons and **no** recovery bar via `preview_network` /
     `preview_snapshot`.
5. **Listener error path (scratch project / emulator).** The Firebase listener error callbacks are
   hard to trigger in prod safely. Verify on a **scratch Firebase project** (per
   `.agent/workflows/deploy.md`) by temporarily denying read on `controllers/{code}` /
   `sessions/{code}` rules to force a permission-denied, then confirm the `rtdb_listener` /
   `firestore_listener` `js_error` fires and re-subscribe attempts are bounded. **Do not** test rule
   changes against production.
6. **GA4 DebugView.** After deploy, open Firebase → Analytics → DebugView (`G-0DFSB38H21`) and
   confirm `js_error` events appear with only the bounded params, then watch the **Events** report
   for the `js_error` rate over the following days.

## 11. Analytics & observability

- **New event `js_error`** (routed through `trackEvent`, so it inherits `device_role` and the
  no-op-when-absent hardening):

  | Param | Type / values | Notes |
  | --- | --- | --- |
  | `reason` | enum: `window_error` \| `unhandled_rejection` \| `raf_loop` \| `rtdb_listener` \| `firestore_listener` | The only cardinality driver — fixed set. |
  | `error_name` | string, ≤40 chars | JS error **constructor** name (`TypeError`…), **not** the message. |
  | `source_line` | number | From `ErrorEvent.lineno` (0 when unknown). `window_error` only. |
  | `mode` | number 0/1 | Solo (0) / multi (1). `raf_loop` only. |

  **Never** include `message`, `stack`, URLs, or the 6-digit session code.

- **Add the `js_error` row** to the events table in `.agent/system/analytics.md:33-46` for doc parity.

- **What to watch post-launch:** the `js_error` event **rate** and its breakdown by `reason` and by
  `device_role` (desktop_host vs phone_controller) in GA4 Explore — a spike after a deploy is an
  early regression signal; a high `rtdb_listener` / `firestore_listener` share points at sync/rules
  health; a `raf_loop` spike points at a gameplay-path regression on specific devices.
