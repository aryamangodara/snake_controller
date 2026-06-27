# Q3 · First-run controller guidance + numeric keypad + branded status

> **Tier** quick-win · **Focus** Growth / Polish · **Impact** High · **Effort** S (hours) · **Priority** 84/100
> **Status** `Not started` · **Depends on** none · **Part of** [Roadmap](./README.md)

## 1. Problem — what we're solving

The phone controller has three first-run friction points, all verifiable in the current tree:

1. **The joystick is unlabeled and the analog model is non-obvious.** After connecting, the controller shows only a bare circle (`#joystick-base` + `#joystick-handle`, `public/index.html:261-265`). Nothing tells a first-timer that the circle is *draggable*, and nothing communicates the project's core mechanic — **direction is continuous (radians) and speed scales with push magnitude** (`public/js/controller.js:149-159`, `sendJoystickInput(normalizedX, normalizedY)` where the normalized magnitude is the speed). A new player who taps instead of drags, or who barely nudges the stick, gets a crawling snake and no explanation.

2. **The 6-digit code input summons a QWERTY keyboard, not a number pad.** The code field is `<input type="text" id="session-input" maxlength="6" placeholder="123456" pattern="[0-9]{6}">` (`public/index.html:242`). There is **no `inputmode`** and **no `autocomplete`**, so mobile browsers open the full alphabetic keyboard for a field that only ever accepts digits, and iOS won't surface the SMS/one-time-code suggestion bar. The JS already enforces digits-only (`public/js/controller.js:40`, `sessionCode.length === 6 && /^\d+$/.test(sessionCode)`), so the text keyboard is pure friction.

3. **Connection status uses jarring hardcoded hex that clashes with the brand and leaks internal retry counters.** Status text is colored with raw hex via inline `style.color`: green `#00ff00` (`showConnectionSuccess`, `public/js/controller.js:464`), pink `#ff1493` (`showConnectionError`, `:468`), orange `#ff6b35` (`showConnectionStatus`, `:472`) — none of which are brand tokens (the brand teal is `--color-primary` / `--color-teal-500`, success/error/warning tokens already exist; see §5). Worse, raw retry math is shown **to the user**: `Connecting to game... (1/3)` (`:305`) and `Connection failed. Retrying... (2/3)` (`:391`) expose `sessionManager.connectionRetries` / `gameConfig.connectionRetries` as if they were product copy.

Net effect: the very first 30 seconds on a phone — the part that decides whether a shared link converts — looks unbranded and reads like a debugger.

## 2. Why it matters

This is a **growth + polish** lever on the highest-leverage screen: the phone someone just picked up after scanning a friend's QR. Pushing for real users means the cold-start path must be self-explanatory and on-brand.

- **Activation:** the drag/speed hint directly teaches the analog mechanic that makes this Snake feel different; without it, first-timers underuse the joystick and bounce.
- **Friction:** `inputmode=numeric` + `autocomplete=one-time-code` removes a keyboard-fumble step on manual-code entry (the non-QR path that `trackEvent('controller_arrival', { method: 'manual_code' })` already measures, `public/js/controller.js:16`).
- **Trust/brand:** replacing neon hex with semantic tokens makes the controller match the desktop's teal identity in **both light and dark mode** (the tokens are theme-aware; raw hex is not), and hiding `Retrying 2/3` keeps internal state out of the user's face.

All three are hours-scale, zero-dependency, and touch only the controller surface.

## 3. Goals

- Show an auto-fading **"Drag to steer — push further to go faster"** hint over the joystick on first connect; dismiss it the instant the player first drags.
- Make the hint `pointer-events: none` so it never intercepts the very drag it's teaching.
- Add `inputmode="numeric"` and `autocomplete="one-time-code"` to `#session-input` so phones open the number pad and offer OTP autofill.
- Replace the three hardcoded status hex values with **semantic, theme-aware tokens** (`--color-success` / `--color-error` / `--color-warning`) applied via a CSS class, not inline color.
- Keep retry/attempt counts out of user-visible copy; route the numbers to `debugLog` only.
- Ship with no regressions in the existing localStorage fallback, multiplayer client path, or `?session=` auto-connect flow.

## 4. Non-goals

- No change to joystick **math/physics** (`handleJoystickDrag`, `sendJoystickInput`) or to throttling.
- No change to the desktop view, QR generation, or the multiplayer **lobby** hint (`#mp-center-hint`) — we *reuse its styling*, we don't alter it.
- No new analytics funnel events are required (optional one in §11); no Firebase rules, schema, or transport changes.
- No persistence of "hint already seen" across sessions/devices (it's per-page-load by design; keep it stateless).
- Not redesigning the connection card layout or copy beyond the status-color change.

## 5. Proposed solution

Three independent, small changes. Each is one transport-agnostic UI tweak — no sync/gameplay/data path is touched, so there are **no both-transport or both-mode branches to mirror**.

### 5a. First-run joystick hint (HTML + CSS + tiny JS)

- **HTML** (`public/index.html`, inside `.joystick-area`, sibling to `#joystick-base` at `:261-265`): add an overlay element, hidden until the controller interface is shown:
  ```html
  <p id="joystick-hint" class="joystick-hint">Drag to steer — push further to go faster</p>
  ```
- **CSS** (`public/css/mobile.css`): style `.joystick-hint` by **reusing the existing `mp-center-hint` recipe** (`public/css/multiplayer.css:153-156`: `color: var(--color-text-secondary); font-size: var(--font-size-sm); text-align: center;`). Position it over/under the joystick, and critically set **`pointer-events: none`** (same technique already used elsewhere in this codebase, e.g. the toast at `public/css/mobile.css:450` and the haptic shim at `public/js/controller.js:245`). Add a `.joystick-hint.dismissed` state that fades it out via `opacity` + `var(--duration-normal) var(--ease-standard)` (tokens already in `variables.css:143-145`). Keep it non-interactive so it can never swallow the first drag.
- **JS** (`public/js/controller.js`): dismiss on **first drag**, in both drag-entry points so a tap-to-snap also counts:
  - In `startJoystickDrag` (`:104`) and `moveJoystickToPosition` (`:174`), call a new `dismissJoystickHint()` helper that adds `.dismissed` (idempotent / guarded so it runs at most once). This piggybacks on the existing pointer/touch handlers — no new listeners on `document`.
  - The hint starts hidden and is revealed when `showControllerInterface()` (`:442`) runs, so it only appears once the joystick is actually on screen (mirrors how the interface is already toggled there). Reuse the `mp-center-hint`/`hidden`-class show pattern rather than inventing a new visibility mechanism.
- **Auto-fade fallback:** if the player never drags (e.g. they read, then press ▶), a short timer (e.g. `setTimeout` ~6 s) also calls `dismissJoystickHint()` so the hint never lingers permanently. Guarded by the same once-only flag.

### 5b. Numeric keypad + OTP autofill (HTML only)

- **HTML** (`public/index.html:242`): change
  ```html
  <input type="text" id="session-input" maxlength="6" placeholder="123456" pattern="[0-9]{6}">
  ```
  to add `inputmode="numeric"` and `autocomplete="one-time-code"` (keep `type="text"` — `type="number"` would add spinners and break leading-zero codes; `inputmode` is the correct lever). The existing `pattern="[0-9]{6}"` and the JS guard at `:40` are unchanged.

### 5c. Branded status via semantic tokens (CSS + JS)

- **CSS** (`public/css/mobile.css`, near `.connection-status` at `:101-107`): add three modifier classes that color the status text from theme-aware tokens:
  ```css
  .connection-status.is-success { color: var(--color-success); }
  .connection-status.is-error   { color: var(--color-error); }
  .connection-status.is-info    { color: var(--color-warning); } /* in-progress / connecting */
  ```
  (`--color-success` / `--color-error` / `--color-warning` are defined for both light and dark in `variables.css:66-68` and `:185-187`.)
- **JS** (`public/js/controller.js`): refactor `setConnectionStatus(message, color)` (`:455-461`) to `setConnectionStatus(message, variant)` where `variant ∈ {'success','error','info'}`. It sets `textContent`, then toggles the `is-success`/`is-error`/`is-info` classes (clearing the others) instead of writing `statusElement.style.color`. Update the three callers:
  - `showConnectionSuccess` (`:463-465`) → `'success'`
  - `showConnectionError` (`:467-469`) → `'error'`
  - `showConnectionStatus` (`:471-473`) → `'info'`
- **De-leak retry counters:** change the two user-facing strings that embed `(n/max)`:
  - `:305` `showConnectionStatus('Connecting to game... (1/3)')` → `showConnectionStatus('Connecting…')`, and move the attempt math to `debugLog('hybrid attempt', sessionManager.connectionRetries + 1, '/', gameConfig.connectionRetries)` (the `debugLog` line at `:304` already logs this — keep/extend it, drop it from the visible string).
  - `:391` `showConnectionError('Connection failed. Retrying... (n/max)')` → `showConnectionError('Connection trouble — retrying…')`, with the count routed to `debugLog` (the `:390` `debugLog` already carries the delay; add the count there). `debugLog` is gated behind `DEBUG` in `utils.js:15-17`, so production stays quiet.
  - Leave the genuine end-state messages (`Session not found — check the 6-digit code…` at `:384`, `Could not connect via Firebase. Trying local mode...` at `:396`) as-is — they're already user-appropriate and carry no internal counters.

**Globals note:** if `setConnectionStatus` keeps its name (recommended), no `.eslintrc.json` change is needed for it (already listed at `.eslintrc.json:229`). The **one new top-level function** `dismissJoystickHint` MUST be added to the `globals` block in `.eslintrc.json` or `no-undef` fails CI. No new top-level `let`/`const` is required if the once-only flag is kept inside the function (e.g. a property on the element / a module-scoped `let joystickHintDismissed` — if a module-scoped `let` is used, it ALSO must be added to globals).

## 6. Acceptance criteria

- [ ] **Given** a phone has just connected and the joystick is visible, **when** the controller interface shows, **then** a hint reading "Drag to steer — push further to go faster" is visible over/near the joystick.
- [ ] **Given** the hint is visible, **when** the user presses a finger down anywhere on the joystick (drag start *or* tap-to-snap), **then** the hint fades out and does not reappear for the rest of the page session.
- [ ] **Given** the hint is visible, **when** the user starts the drag *on the hint's own area*, **then** the drag still registers on the joystick (hint has `pointer-events: none`; first-drag input is not swallowed).
- [ ] **Given** the user never touches the joystick, **when** ~6 s elapse, **then** the hint auto-fades (no permanent overlay).
- [ ] `#joystick-hint` is hidden before `showControllerInterface()` runs and is never shown on the connection form screen.
- [ ] **Given** a mobile browser, **when** the user focuses `#session-input`, **then** a numeric keypad is requested (`inputmode="numeric"`) and `autocomplete="one-time-code"` is present; `type` remains `text` (leading-zero codes like `012345` are still enterable) and `pattern="[0-9]{6}"` is retained.
- [ ] Connection status text color comes from `var(--color-success)` / `var(--color-error)` / `var(--color-warning)` via a class — **no inline `style.color`** and **no hardcoded hex** (`#00ff00`, `#ff1493`, `#ff6b35`) remain in `controller.js`.
- [ ] Status colors render correctly in **both** `prefers-color-scheme: light` and `dark` (tokens resolve per `variables.css`).
- [ ] No user-visible string contains a retry/attempt fraction (`(1/3)`, `Retrying 2/3`, etc.); attempt counts appear only via `debugLog` (gated by `DEBUG`).
- [ ] **Negative:** the localStorage fallback path (`connectViaLocalStorage`) and the multiplayer path (`connectMultiplayer`) still set status correctly through the refactored `setConnectionStatus` (success/error variants), with no console errors.
- [ ] **Negative:** the `?session=` QR auto-connect (`initializeMobileController` → `connectToSession`, `controller.js:18-24`) still works and the joystick hint still appears after auto-connect.
- [ ] **Guardrails:** `.eslintrc.json` `globals` updated for `dismissJoystickHint` (and any new module-scoped `let`); no PII or the 6-digit code is logged (the digit code is never passed to `trackEvent`/console in the new code); `npm run lint`, `node --check` on changed JS, and `npm test` (Vitest, incl. `tests/protocol.test.js`) are all green.
- [ ] **Guardrails:** `const CACHE` in `public/sw.js` is bumped from `snake-shell-v11` (`public/sw.js:8`) because `index.html`, `controller.js`, and `mobile.css` are shell assets — installed SWs need the version bump to pick up the change on next reload.

## 7. Affected files

| File | Change |
| --- | --- |
| `public/index.html` | Add `#joystick-hint` `<p>` inside `.joystick-area` (after `#joystick-base`, ~`:265`); add `inputmode="numeric" autocomplete="one-time-code"` to `#session-input` (`:242`). |
| `public/js/controller.js` | Add `dismissJoystickHint()` helper; call it from `startJoystickDrag` (`:104`) and `moveJoystickToPosition` (`:174`); reveal hint in `showControllerInterface` (`:442`); refactor `setConnectionStatus` to class-based variants (`:455`); update `showConnectionSuccess`/`showConnectionError`/`showConnectionStatus` (`:463-473`); de-leak retry counters at `:305` and `:391` (route to `debugLog`). |
| `public/css/mobile.css` | Add `.joystick-hint` (+ `.dismissed`) reusing `mp-center-hint` recipe with `pointer-events: none` + opacity fade; add `.connection-status.is-success/.is-error/.is-info` near `:101`. |
| `.eslintrc.json` | **Globals bump:** add `"dismissJoystickHint": "readonly"` (and any new module-scoped `let` for the once-flag). Without it `no-undef` fails CI. |
| `public/sw.js` | **CACHE bump:** `snake-shell-v11` → `snake-shell-v12` (`:8`) — shell assets changed. |

No new files. No change to `firestore.rules`, `database.rules.json`, RTDB/Firestore schema, or any `mp-*.js`.

## 8. Dependencies & sequencing

- **Deps:** none. Independent of all roadmap items.
- **Internal ordering (single PR):** the three sub-changes (5a/5b/5c) are independent and can land together. Within the PR, update `.eslintrc.json` in the **same commit** that introduces `dismissJoystickHint` so no intermediate commit fails lint. Bump `sw.js` CACHE last.
- Reuses existing primitives only (`mp-center-hint` CSS recipe, semantic color tokens, `debugLog`, the `hidden`-class toggle pattern) — nothing new to build first.

## 9. Risks & mitigations

- **Hint intercepts the first drag** (the exact thing it teaches). → `pointer-events: none` on `.joystick-hint`; acceptance criterion explicitly tests a drag started on the hint area.
- **`type="number"` temptation breaks leading zeros / adds spinners.** → Keep `type="text"`, add only `inputmode`; codes like `012345` stay valid. Called out in §5b and AC.
- **`setConnectionStatus` signature change breaks a caller.** → Only four call sites in one file (`controller.js`), all updated together; `connectMultiplayer` (mp-client.js) calls `showConnectionSuccess`/`showConnectionError` wrappers, not `setConnectionStatus` directly (verify during impl). Vitest + lint catch arity/undeclared-global slips.
- **Stale SW serves old shell** so the change "doesn't show" in testing. → Bump `CACHE`; during local verify, unregister the SW + clear caches (project memory / CLAUDE.md gotcha).
- **Forgetting the eslintrc globals entry** → CI `no-undef` failure (that failure is the feature). Listed as a hard AC.
- **Auto-fade timer fires after the player already dragged** → once-only guard makes `dismissJoystickHint()` idempotent; double-dismiss is a no-op.

## 10. Verification / test plan

No local Node — verification is CI-bound + visual via local static server.

1. **CI (authoritative, blocking):** push a branch; `.github/workflows/deploy.yml` runs `npm run lint` (must pass with `dismissJoystickHint` in globals), `node --check` on changed JS, and `npm test` (Vitest incl. the jsdom `tests/protocol.test.js`). Green CI is the gate. Do **not** hand-deploy.
2. **Lint focus:** confirm `no-undef` passes (proves the globals list is correct) and no new hardcoded-hex lingers (grep the diff for `#00ff00`/`#ff1493`/`#ff6b35`).
3. **Visual (local):** `python -m http.server` over `public/`, open with `?session=123456` to force the controller view; **unregister the SW + clear caches first** (network-first SW can serve stale shell). Use Claude_Preview eval/snapshot (screenshots time out):
   - Resize to a phone viewport; confirm the joystick hint renders with `pointer-events: none` (computed style) and the correct copy.
   - Simulate a pointerdown on `#joystick-base`; assert `#joystick-hint` gains `.dismissed` and fades.
   - Focus `#session-input`; assert `inputMode === 'numeric'` and `autocomplete === 'one-time-code'` via `preview_eval`.
   - Drive `showConnectionSuccess/Error/Status` and assert the element carries `is-success/is-error/is-info` and that `getComputedStyle(...).color` matches the resolved token (check under both color schemes via `preview_eval` toggling `data-color-scheme`).
   - Assert no status string matches `/\d\/\d/` (no leaked counters).
4. **Fallback/MP smoke:** with Firebase unavailable (offline), confirm `connectViaLocalStorage` still colors status via the new classes; if feasible, exercise a multiplayer join in a scratch tab to confirm `connectMultiplayer`'s status messages still render.
5. **No emulator/scratch-Firebase needed** — this change touches zero rules/schema/transport.

## 11. Analytics & observability

- **No new event is required** for the core change; it's UI polish. The existing funnel already distinguishes the manual-code path (`trackEvent('controller_arrival', { method: 'manual_code' })`, `controller.js:16`) and connection success (`controller_connected`, `:330`) — watch whether the `inputmode`/OTP change lifts manual-code → connected conversion.
- **Optional (nice-to-have):** a lightweight `trackEvent('controller_hint', { action: 'dismissed_by_drag' | 'dismissed_by_timeout' })` fired once inside `dismissJoystickHint` to measure whether first-timers learn by dragging vs. time out. Route through the hardened `trackEvent` (no-ops offline, never throws). **Never** include the 6-digit code or any PII in params. Omit if it risks scope creep — the feature stands without it.
- **Observability:** retry/attempt counts remain available to developers via `debugLog` (gated by `DEBUG` in `utils.js`), so the de-leak doesn't reduce debuggability — it just removes the numbers from the user's screen.
