# M9 · Modal & name-edit a11y/UX hardening (focus trap, replace native prompt)

> **Tier** medium · **Focus** Polish · **Impact** Medium · **Effort** M · **Priority** 58/100
> **Status** `Not started` · **Depends on** follows M3 · **Part of** [Roadmap](./README.md)

## 1. Problem — what we're solving

Two related accessibility/UX gaps live in the desktop leaderboard modal and the phone's
multiplayer name editor.

**A. The leaderboard modal violates the standard modal contract.** The markup is correctly
declared `role="dialog" aria-modal="true" aria-labelledby="lb-title"`
(`public/index.html:216`), but the JS never honors it:
- `openLeaderboard()` (`public/js/leaderboard-ui.js:7-13`) only removes `.hidden` and renders
  rows — it **never moves focus into the panel**. A keyboard or screen-reader user opening the
  board is left with focus on the trophy button behind the overlay.
- There is **no Tab trap**. With `aria-modal="true"` set, Tab/Shift+Tab still walk the focus
  ring out of the panel into the obscured desktop game (the score card, QR card, mute/share
  links), so the "modal" is modal in name only.
- `closeLeaderboard()` (`public/js/leaderboard-ui.js:15-18`) only adds `.hidden`; it **does not
  restore focus** to whatever opened the modal (the `#leaderboard-btn`). After Escape or the
  close button, focus is lost to `<body>`.

Only the close button has a visible focus style today (`.lb-close:focus-visible`,
`public/css/leaderboard.css:51-54`), which underlines that the keyboard path was never finished.

**B. Multiplayer name editing drops to an unstyled native `prompt()`.** The phone "✏️"
edit-name button calls `window.prompt('Your player name (1–16 chars):', current)`
(`public/js/mp-ui.js:323-340`). This:
- renders **unstyled OS chrome** that cannot be themed to match the neon controller UI;
- **cannot be `<input maxlength>`-constrained, validated inline, or focused on open**;
- is **blocked or silently no-ops in some installed-PWA / iOS standalone contexts**, leaving the
  player with no way to rename;
- is **inconsistent** with the styled, in-page name entry the desktop already ships
  (`#name-entry` / `#player-name`, `public/index.html:139-145`; logic in `showNameEntry()`,
  `public/js/game.js:658-679`).

Note the desktop solo name entry (`showNameEntry`) is **already** keyboard-correct (focus on
open, Enter-to-confirm, red `.lb-invalid` border on reject) — this initiative brings the modal and
the phone editor up to that same bar.

## 2. Why it matters

This is **Polish** that directly supports **pushing for real users**:

- A modal that traps focus and returns it on close is the baseline keyboard/screen-reader
  contract. The current board fails WCAG 2.1 **2.4.3 Focus Order** and **2.1.2 No Keyboard Trap**
  (it traps *nothing*, which is the inverse failure — focus escapes behind the overlay). Fixing it
  removes an obvious a11y red flag on the most prominent "social proof" surface of the game.
- Replacing `prompt()` removes a real **functional dead-end on installed PWAs / iOS standalone**,
  where the native prompt can be suppressed — today a phone player there simply cannot rename
  themselves. Names are what make the multiplayer lobby and end-screen feel human ("⚔️ Defeated by
  Sam"), so a broken rename path quietly degrades the headline feature.
- It makes the phone rename **look like the rest of the app** instead of jarring OS chrome — a
  small but visible quality cue for first-time players deciding whether to share the link.

## 3. Goals

- On `openLeaderboard()`: save the previously-focused element, move focus to `#lb-close`, and
  trap Tab/Shift+Tab inside `.leaderboard-panel`.
- On close (button, Escape, or backdrop click): restore focus to the saved opener, guarding the
  edge cases (opener gone from DOM, empty panel, never-opened).
- Replace the phone `prompt()` rename with a small **in-DOM, themed** input that reuses the
  existing styled name-entry pattern: autofocus, `maxlength="16"`, Enter-to-confirm, Escape-to-
  cancel, inline invalid feedback + toast.
- Keep the same persistence + Firestore write behavior the current rename has (write to
  `players.<slot>.name`, bump `lastActivity`, persist via `setPlayerName`).
- (Optional) Give the phone center button (`#btn-center`) an `aria-label` that updates with state
  (Start / Restart / playing), since today it conveys state only via the visual glyph.

## 4. Non-goals

- No change to the **desktop** solo `#name-entry` flow (`game.js:658-679`) — it is already
  keyboard-correct and is the template, not the target.
- No change to leaderboard data, the Firestore `leaderboard` collection, the rank query, or
  `firestore.rules` (names are still validated server-side; rendered via `textContent`).
- No new dependency (no focus-trap library) — implement the trap inline with the existing global
  scope, no bundler.
- No redesign of the modal's visual style or the lobby/scoreboard layout.
- No reworking of how `mpClient`/`mpSession` sync — only the rename **input surface** changes, not
  the write path.

## 5. Proposed solution

### A. Leaderboard modal focus management (`public/js/leaderboard-ui.js`)

Add a module-level `let lbLastFocus = null;` and a small focus-trap helper, then wire them into the
existing open/close functions (do **not** add new entry points — keep the global surface minimal).

- In `openLeaderboard()` (`leaderboard-ui.js:7`): before `renderLeaderboard()`, capture
  `lbLastFocus = document.activeElement;` then, after un-hiding, focus `#lb-close`
  (`document.getElementById('lb-close')?.focus()`). `#lb-close` is always present and already has a
  `:focus-visible` style (`leaderboard.css:51`), so it is the natural initial target.
- Add a `keydown` handler **scoped to the modal** (attach inside the existing
  `DOMContentLoaded` block at `leaderboard-ui.js:75-85`, alongside the current Escape handler) that,
  when the modal is open and `e.key === 'Tab'`, computes the focusable elements within
  `.leaderboard-panel` and wraps: Shift+Tab on the first focusable → last; Tab on the last → first.
  Query focusables with a standard selector
  (`'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'`) filtered to
  visible/enabled. In practice the open board's only focusable is `#lb-close`, so the **negative
  edge case** "panel has exactly one focusable" must be handled: keep focus on that one element
  (preventDefault, no wrap-around jump out).
- In `closeLeaderboard()` (`leaderboard-ui.js:15`): after adding `.hidden`, restore focus —
  `if (lbLastFocus && document.contains(lbLastFocus)) lbLastFocus.focus(); lbLastFocus = null;`.
  Guard the **empty/never-opened** case (`lbLastFocus` null) and the **opener-removed** case
  (`document.contains` false) so we never throw or focus a detached node.
- The existing Escape handler and backdrop-click handler (`leaderboard-ui.js:81-84`) already call
  `closeLeaderboard()`, so restore-on-close covers all three close paths for free.

Reuse: the `--focus-outline` token (`public/css/variables.css:75`) and the existing
`.lb-close:focus-visible` rule (`leaderboard.css:51-54`). No CSS change is strictly required for
the trap; if other focusables are later added to the panel they should adopt the same
`:focus-visible { outline: var(--focus-outline); }` pattern.

### B. Replace the phone `prompt()` with a themed in-DOM input (`public/js/mp-ui.js` + `public/index.html`)

Add a small inline name-editor **inside the existing `#mp-player-banner`** (`index.html:254-258`),
mirroring the desktop `#name-entry` markup (`index.html:139-145`): a hidden wrapper holding an
`<input maxlength="16" autocomplete="off">` plus a confirm button, toggled in place of the static
banner text when "✏️" is tapped.

In `mp-ui.js`, replace the `prompt()` block (`mp-ui.js:323-340`) with handlers that:
- on "✏️" click: reveal the editor, prefill from `getPlayerName()`, clear `.lb-invalid`, and
  `setTimeout(() => input.focus(), 50)` (the **same focus delay** used by `showNameEntry`,
  `game.js:667`, which avoids the mobile-keyboard race);
- confirm on the button **or** Enter (`input.onkeydown`, mirroring `game.js:676`, with
  `e.preventDefault(); e.stopPropagation()`);
- on confirm, run the existing persistence unchanged: `setPlayerName(raw)` →
  if falsy, add `.lb-invalid` + `showToast('That name didn’t work — try another.')` and keep the
  editor open (don't lose the typed value); if valid, write
  `mpClient.sessionDocRef.update({ ['players.' + mpClient.slot + '.name']: clean, lastActivity: serverTimestamp() }).catch(() => {})`
  (identical to today, `mp-ui.js:332-337`), hide the editor, and `showToast('You are ' + clean)`;
- support **Escape to cancel** and clearing `.lb-invalid` on `input.oninput` (both mirroring
  `game.js:677-678`).

Reuse:
- `sanitizeName()` semantics are already applied inside `setPlayerName()`
  (`leaderboard.js:93-98` → `utils.js:65-70`) — do **not** re-sanitize; keep `setPlayerName` as the
  single gate so the 16-char clamp/whitespace rules stay in one place.
- `showToast()` from `share.js:46-58` (already used here).
- The `.input-group`, `#player-name`-style input, and `.lb-invalid` red-border treatment
  (`leaderboard.css:124-130`) — add a small parallel class for the phone editor (e.g.
  `.mp-name-edit`) in `multiplayer.css` next to the existing `.mp-edit-name` rule
  (`multiplayer.css:149-152`) rather than reusing the desktop-only `#player-name` id selector.
- The editor must be hidden whenever the round is `PLAYING`: `mpUiPhoneUpdate()` already hides the
  "✏️" trigger in that state (`mp-ui.js:248-249`); extend the same toggle to also collapse an open
  editor back to the banner so it can't linger across a round start.

### C. (Optional) Center button `aria-label` (`public/js/controller.js`)

`updateCenterButtonIcon()` (`controller.js:475-497`) already switches the glyph and class per
`GameState`. Add a matching `centerBtn.setAttribute('aria-label', …)` in each branch —
"Start game" (WAITING_FOR_START), "Play again" (GAME_OVER), "Game in progress" (PLAYING) — so the
button announces its action, not just an emoji. Pure additive; no new global.

**Both-transports / both-modes note:** none of these changes touch the Firestore/RTDB vs
localStorage sync paths or the solo-engine vs multi-arena split. The modal trap is desktop-host UI
only. The phone rename reuses the exact same `sessionDocRef.update()` write that exists today, so
the **hybrid** path is unchanged and the **localStorage** controller path (which has no rename UI)
is unaffected. The center-button label change rides on `updateCenterButtonIcon`, which is already
called from both the Firebase snapshot handler and the localStorage `storage` handler
(`controller.js:337,418,427`), so the label updates in both transports automatically.

## 6. Acceptance criteria

Behavior — leaderboard modal:
- [ ] Given the desktop board is closed and focus is on `#leaderboard-btn`, When I open it, Then
      focus moves to `#lb-close` and `lbLastFocus` is the trophy button.
- [ ] Given the board is open, When I press Tab repeatedly, Then focus stays within
      `.leaderboard-panel` and never lands on an element outside the modal (score card, QR card,
      mute/share links).
- [ ] Given the board is open with `#lb-close` as the only focusable, When I press Tab or
      Shift+Tab, Then focus remains on `#lb-close` (single-focusable edge case, no escape, no
      throw).
- [ ] Given the board is open, When I press Escape OR click the backdrop OR click `#lb-close`,
      Then the board hides AND focus returns to `#leaderboard-btn`.
- [ ] Given the opener element has been removed from the DOM, When the board closes, Then no error
      is thrown and focus is not set to a detached node (`document.contains` guard).
- [ ] Given the board was never opened, When `closeLeaderboard()` runs defensively, Then it
      no-ops on focus restore (null `lbLastFocus`).

Behavior — phone name edit:
- [ ] Given I am a connected phone player on the lobby/game-over screen, When I tap "✏️", Then an
      in-page themed input appears (no `window.prompt`), prefilled with my current name and
      autofocused.
- [ ] Given the editor is open, When I type a valid name and press Enter (or tap confirm), Then the
      name persists via `setPlayerName`, `players.<slot>.name` + `lastActivity` are written to
      Firestore, a "You are <name>" toast shows, and the editor collapses back to the banner.
- [ ] Given the editor is open, When I submit an empty/whitespace-only name, Then the input shows
      the `.lb-invalid` red border, a "didn’t work" toast shows, the editor stays open, and my typed
      text is not lost.
- [ ] Given the editor is open, When I press Escape, Then the editor closes without changing my
      name.
- [ ] Given a round transitions to PLAYING while my editor is open, Then the editor is collapsed/
      hidden (no stray input over the joystick).
- [ ] Negative: `grep -n "prompt(" public/js/mp-ui.js` returns no matches.

Behavior — center button (if included):
- [ ] Given the synced state is WAITING_FOR_START / GAME_OVER / PLAYING, Then `#btn-center` carries
      an `aria-label` of "Start game" / "Play again" / "Game in progress" respectively.

Guardrails:
- [ ] `.eslintrc.json` `globals` updated for any **new top-level** function or `let`/`const` added
      in `public/js/*` (e.g. a `lbLastFocus` writable global and any new focus-trap helper /
      rename helper); removed names pruned. (Helpers kept inside existing `DOMContentLoaded`
      closures need no globals entry — prefer that to keep the surface small.)
- [ ] `sw.js` `const CACHE` bumped from `snake-shell-v11` (`public/sw.js:8`) because shell HTML/CSS
      changed (new editor markup + class).
- [ ] No PII and no 6-digit session code logged by any new `trackEvent`/`debugLog`/`console` call.
- [ ] `npm run lint` (0 errors), `node --check` on changed `public/js/*`, and `npm test` (Vitest,
      incl. `tests/protocol.test.js`) all green in CI.

## 7. Affected files

| File | Change |
| --- | --- |
| `public/js/leaderboard-ui.js` | Add `lbLastFocus` capture in `openLeaderboard`, focus `#lb-close`; Tab/Shift+Tab trap in the `DOMContentLoaded` keydown handler (single-focusable edge case); restore focus in `closeLeaderboard` with `document.contains` guard. |
| `public/js/mp-ui.js` | Replace the `prompt()` rename (`:323-340`) with in-DOM editor wiring: reveal/prefill/focus, Enter-confirm, Escape-cancel, `.lb-invalid` + toast on reject, hide on PLAYING. |
| `public/index.html` | Add the themed name-editor markup inside `#mp-player-banner` (mirrors `#name-entry`). **Shell asset changed → bump `sw.js` CACHE.** |
| `public/js/controller.js` | (Optional) Add state-driven `aria-label` to `#btn-center` in `updateCenterButtonIcon`. |
| `public/css/multiplayer.css` | Add `.mp-name-edit` (and `.lb-invalid` reuse) styles for the phone editor, near the existing `.mp-edit-name` rule. |
| `public/sw.js` | **Bump `const CACHE`** (`v11` → `v12`) — shell HTML/CSS changed. |
| `.eslintrc.json` | **Update `globals`** for any new top-level decl in `public/js/*` (e.g. `lbLastFocus`, any new helper); prune removed names. |

## 8. Dependencies & sequencing

- **Follows M3.** M3 should land first; this builds on whatever leaderboard/name-entry refinements
  M3 introduces (confirm the `#name-entry` markup and `showNameEntry` signature are stable before
  cloning the pattern for the phone). If M3 reshapes the desktop name-entry DOM, rebase the phone
  editor markup onto the final shape.
- **Unblocks:** a clean, consistent name-entry surface usable by any future "rename" affordance
  (e.g. a desktop pre-game rename) and a fully keyboard-navigable leaderboard, reducing a11y debt
  before a wider user push.
- No transport, rules, or schema dependency — ships in any deploy.

## 9. Risks & mitigations

- **Global-scope / load-order minefield.** Adding a top-level `let`/function in `leaderboard-ui.js`
  or `mp-ui.js` without updating `.eslintrc.json` `globals` fails CI (`no-undef`). *Mitigation:*
  prefer closures inside the existing `DOMContentLoaded` blocks (no new globals); only `lbLastFocus`
  truly needs module scope — declare it as `"writable"` in `globals` if it lands at top level, or
  keep it inside the IIFE/closure to avoid touching the list. Run lint in CI before merge.
- **`mp-ui.js` loads before `controller.js`** (`index.html:314-315`); the rename handler uses
  `mpClient`, `getPlayerName`, `setPlayerName`, `showToast` — all defined earlier
  (`mp-client.js` is loaded **after** `mp-ui.js`, so `mpClient` is referenced via the global object
  at click time, not at parse time — the existing code already does this and works). *Mitigation:*
  keep all references inside the click handler (runtime), exactly as the current `prompt()` block
  does; don't hoist any `mpClient` read to module top.
- **Focus-trap selector brittleness.** A naive "focus the next element" can throw if the panel has
  zero focusables. *Mitigation:* the close button is always present; explicitly handle the 0- and
  1-focusable cases (no-op / hold).
- **Mobile keyboard race.** Focusing the input immediately on tap can be ignored on some mobile
  browsers. *Mitigation:* reuse the proven `setTimeout(…, 50)` focus delay from `showNameEntry`
  (`game.js:667`).
- **Stale PWA shell.** Forgetting to bump `CACHE` leaves installed users on old markup, so the new
  editor element is missing and the handler silently no-ops. *Mitigation:* bump `sw.js` CACHE as a
  checklist item (already an acceptance criterion).
- **Escape collision.** The new editor's Escape-to-cancel could bubble to the global Escape handler.
  On the phone there is no leaderboard modal open, so collision is unlikely; still call
  `e.stopPropagation()` on the editor's Escape to be safe.

## 10. Verification / test plan

Given the no-local-Node, CI-bound constraint:

- **CI (authoritative):** `npm run lint`, `node --check public/js/leaderboard-ui.js
  public/js/mp-ui.js public/js/controller.js`, and `npm test` (Vitest) must pass. The
  jsdom `tests/protocol.test.js` smoke test exercises the script-load order, so confirm the new
  globals don't break it. No new pure-logic functions are introduced (the work is DOM wiring), so
  **no new unit test is strictly required**; if a `lbFocusTrap(panel, e)` pure helper is factored
  out, add a small jsdom Vitest covering the wrap and single-focusable cases.
- **Local visual + interaction check** (per repo workflow): serve with `python -m http.server`
  from `public/`, **unregister the SW and clear caches first** (network-first SW serves stale
  assets locally), then drive with `Claude_Preview` `eval`/`snapshot` (screenshots time out):
  - Desktop: open the board, assert `document.activeElement.id === 'lb-close'`; dispatch Tab/
    Shift+Tab keydowns and assert focus stays inside `.leaderboard-panel`; dispatch Escape and
    assert `document.activeElement.id === 'leaderboard-btn'`.
  - Phone (append `?session=123456` in a second tab to force the controller view): claim a slot,
    tap "✏️", assert `#mp-player-banner` now contains a focused `<input>` and **no** native prompt;
    submit empty → assert `.lb-invalid`; submit valid → assert banner text updates and a toast
    appears.
- **No rules / no scratch Firebase project needed** — `firestore.rules` and
  `database.rules.json` are untouched; the rename write uses the existing
  `players.<slot>.name` field already accepted by the rules. (If anyone *does* touch rules, route
  through a scratch project per `.agent/workflows/deploy.md` — but this spec must not.)

## 11. Analytics & observability

Route everything through `trackEvent()` (`utils.js`), which no-ops offline and never throws; **no
PII, never the 6-digit code**.

- Add `trackEvent('name_edit', { surface: 'phone', valid: true|false })` on rename confirm
  (boolean validity only — **never** the name string). Optionally
  `trackEvent('name_edit_open', { surface: 'phone' })` when the editor opens, to measure how often
  the new in-DOM path is used vs the dead-ended old prompt.
- Optionally `trackEvent('leaderboard_view')` already fires on open (`leaderboard-ui.js:11`) — no
  new event needed for the modal; if useful, a `trackEvent('leaderboard_close', { via:
  'escape'|'backdrop'|'button' })` could quantify how users dismiss it, but keep it optional to
  avoid event noise.
- Watch in GA4 after deploy: a rise in `name_edit` with `valid:true` confirms phone players can now
  rename where the prompt previously failed (especially correlated with installed-PWA sessions).
