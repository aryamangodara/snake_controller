# M13 · Cross-device capability smoke + documented support matrix

> **Tier** medium · **Focus** Launch-readiness · **Impact** Low · **Effort** M · **Priority** 38/100
> **Status** `Not started` · **Depends on** none · **Part of** [Roadmap](./README.md)

## 1. Problem — what we're solving

The phone controller — the primary surface for real users, and overwhelmingly iOS Safari — depends on
a cluster of browser APIs that are each feature-detected **ad hoc, inline, and untested**. There is no
single place that records what we rely on, how each capability degrades, or which browsers we've
actually verified. A regression on iOS Safari (an OS update, a removed API, a typo in a guard) would
ship to production undetected because CI exercises none of these paths.

Concrete inventory of the guarded capabilities (verified file:line):

- **Vibration / haptics** — `public/js/controller.js:240` `triggerHaptic()`. `:242` detects
  `typeof navigator.vibrate === 'function'`; when absent (iOS Safari, where `navigator.vibrate` has
  **never** existed) it falls back to the hidden `<input switch>` trick (`:243-251`, Safari 17.4+),
  and `:252-254` swallows every error so haptics "never throw into gameplay". This elaborate fallback
  is exactly the kind of code that breaks silently.
- **Web Share** — `public/js/share.js:68` `if (navigator.share)`; used for the Instagram path
  (`shareToInstagram`, `:67`).
- **Async Clipboard** — `public/js/share.js:73` `if (navigator.clipboard && navigator.clipboard.writeText)`
  with a toast fallback (`:77`) when unavailable.
- **Web Audio** — `public/js/sound.js:14` `const AC = window.AudioContext || window.webkitAudioContext;`
  and `:15` `if (AC)` before constructing; `playTone` (`:28`) returns early if no context.
- **`crypto.randomUUID`** — `public/js/leaderboard.js:76-78` `(window.crypto && crypto.randomUUID)`
  with a `Date.now()/Math.random()` fallback for the per-device id.
- **Touch + Pointer events** — `public/js/controller.js:91-97` registers `touchstart`/`touchmove`/
  `touchend` (with `{ passive: false }` at `:92`); `getPointerPosition` (`:114-124`) normalizes both
  mouse `clientX/Y` and `e.touches[0]`.

None of these has a test. The only protocol coverage (`tests/protocol.test.js`) drives the
localStorage sync path and never touches capability detection. There is no `support_matrix.md`.

## 2. Why it matters

This is a **launch-readiness** item: it does not add a feature, it protects the ones we ship to real
phones. The phone controller is the make-or-break surface — if haptics, sharing, or the joystick break
on iOS Safari, the product feels broken to the exact users we're trying to grow. Two cheap, durable
guarantees come out of this:

1. A **vitest capability smoke test** that asserts every API is *guarded* (called through a `typeof`/
   truthiness check, never bare) and that each guard's **absent branch is a safe no-op** — so a future
   edit that removes a guard, or assumes an API exists, fails CI before it reaches production.
2. A **living support matrix** (`.agent/system/support_matrix.md`) that documents what we depend on,
   the graceful-degradation contract for each, and the browser/device combinations we've verified —
   so "does this work on iOS Safari?" has a written, dated answer instead of a shrug.

## 3. Goals

- A new vitest test file (e.g. `tests/capabilities.test.js`) that exercises the real production guards
  for: `navigator.vibrate`, the `<input switch>` haptic fallback, `navigator.share`,
  `navigator.clipboard.writeText`, `AudioContext`/`webkitAudioContext`, `crypto.randomUUID`, and the
  touch/pointer normalization in `getPointerPosition`.
- Each capability tested in **both** states: present (the happy path runs) and absent (the guard
  degrades to a documented no-op / fallback **without throwing**).
- A documented support matrix at `.agent/system/support_matrix.md`: one row per capability × the
  browser/device tiers we care about (iOS Safari first), with the degradation behavior and a
  "last verified" date.
- CI (`lint` + `vitest` + `node --check`) stays green; the new test runs inside the existing
  `npm test` with no config changes.
- Cross-references wired up: `CLAUDE.md` and `.agent/system/architecture.md` point to the new doc.

## 4. Non-goals

- **No behavior change** to any production file. This is test + documentation only; the guards already
  exist and are correct — we are characterizing them, not rewriting them.
- **No polyfills / no new fallbacks.** If a capability is missing we document the existing degradation;
  we do not add new shims.
- **No real-device CI / BrowserStack / Sauce Labs integration.** The smoke test runs in jsdom under
  vitest; physical-device verification is a manual checklist captured in the matrix, not automated.
- **No new analytics events** beyond confirming the existing ones (the matrix may *note* which events
  already cover a capability's usage, but adds none).
- **No changes to the localStorage / Firebase transports or the solo/multi engines.**

## 5. Proposed solution

### 5a. Capability smoke test (`tests/capabilities.test.js`)

Follow the **two patterns already in the repo**:

- For pure helpers, the `module.exports` footer pattern (`public/js/utils.js:73`,
  `public/js/logic.js:265`) lets vitest `import` them directly — see `tests/utils.test.js`.
  `getPointerPosition` (`controller.js:114`) is pure and a good candidate to expose via a guarded
  `module.exports` footer (it has none today) so it can be imported and unit-tested with synthetic
  mouse/touch event objects.
- For the DOM-coupled guards (`triggerHaptic`, `shareToInstagram`, `getAudioContext`, `getPlayerId`),
  reuse the **JSDOM + `vm.runInContext`** harness from `tests/protocol.test.js:32-46` (`makePage()`).
  That harness already evaluates the real `<script>` files into one shared lexical context exactly
  like sequential script tags, and already stubs `firebase` to force offline mode. The capability test
  loads the relevant subset (e.g. `utils, controller` for haptics; `utils, share` for share/clipboard;
  `utils, sound` for audio; `utils, leaderboard` for `randomUUID`) and then **mutates `navigator` /
  `window` on the JSDOM context** to toggle each capability present/absent before invoking the guard.

Per-capability assertions:

- **Vibration present:** define `ctx.navigator.vibrate` as a spy; call `triggerHaptic(40)`; assert the
  spy was called with `40` and **no `<label>` element was appended** to `document.body`.
- **Vibration absent (iOS path):** delete `navigator.vibrate`; call `triggerHaptic([120,60,120])`;
  assert it **does not throw**, that a hidden `<input switch>` was created and `click()`ed, and that
  the label is removed afterward (`controller.js:251` `finally { label.remove(); }` — assert
  `document.querySelectorAll('label').length` returns to 0).
- **Vibration throws:** make `navigator.vibrate` throw; assert `triggerHaptic` still returns normally
  (the `:252` catch holds the "never throws into gameplay" contract).
- **Web Share present:** stub `navigator.share` returning a resolved promise; call
  `shareToInstagram(text, url)`; assert `navigator.share` got `{ text, url }` and `window.open` was
  **not** called.
- **Web Share absent + clipboard present:** delete `navigator.share`, stub
  `navigator.clipboard.writeText` → resolved; assert it was called with `"${text} ${url}"` and
  `window.open('https://www.instagram.com/', ...)` fired.
- **Web Share + clipboard both absent:** delete both; assert `shareToInstagram` does not throw and
  still calls `window.open` (the `else` toast branch at `share.js:77`).
- **Web Audio present:** stub `window.AudioContext`; assert `getAudioContext()` constructs once and
  memoizes (second call returns the same instance — `sound.js:13`).
- **Web Audio absent:** delete both `AudioContext` and `webkitAudioContext`; assert `getAudioContext()`
  returns `null` (or `undefined`) and that `playTone(660, 100)` is a no-op that **does not throw**
  (`sound.js:30` early return).
- **`crypto.randomUUID` present:** assert `getPlayerId()` returns the UUID and persists it to
  `localStorage` under `PLAYER_ID_KEY`.
- **`crypto.randomUUID` absent:** delete `crypto.randomUUID`; assert `getPlayerId()` returns a
  non-empty `p-…` fallback id (`leaderboard.js:78`) and still persists.
- **Pointer normalization:** import `getPointerPosition`; assert it reads `clientX/clientY` from a
  mouse-style event, reads `touches[0]` from a touch-style event, and returns `null` for an event with
  neither (`controller.js:122`).

Reuse existing helpers throughout — `safeParse` (utils), the `makePage()`/`bridgeStorage` scaffolding,
and the `$(page, sel)` query helper — rather than re-implementing a JSDOM bootstrap.

### 5b. Support matrix doc (`.agent/system/support_matrix.md`)

A new living record in the project's semantic index, matching the heading/voice style of the existing
`.agent/system/*.md` files (`architecture.md`, `analytics.md`, `firebase_schema.md`). Contents:

- **Capability table:** | Capability | API | Detection site (file:line) | Degradation when absent |
  Covered by test | — one row per item in §1.
- **Browser/device support table:** rows for the device/OS tiers we care about, **iOS Safari first**
  (then iPadOS Safari, Android Chrome, Android Firefox, desktop Chrome/Edge, desktop Firefox, desktop
  Safari), columns for each capability, cells = ✅ native / ⚠️ fallback / ❌ no-op, plus a
  **"Last verified (date / version)"** column.
- A short **"How to re-verify"** section: the manual phone checklist (scan QR, drag joystick, eat food
  → feel/await haptic, lose → loss flash, tap share) plus the note that the SW is network-first and the
  local-preview SW must be unregistered + caches cleared first (per `CLAUDE.md` gotchas).
- A pointer back to the smoke test as the automated half of the guarantee.

**Both-transports / both-modes note:** these capabilities live entirely on the **phone controller**
and are independent of the sync transport — `triggerHaptic` is deliberately driven off the state edge
so the loss buzz fires in **both** Firebase and localStorage modes (`controller.js:516-521`), and off
the audio mute by design. The matrix should state this so nobody assumes a transport dependency. No
desktop-engine (solo vs multi) path is affected.

## 6. Acceptance criteria

- [ ] **Given** `navigator.vibrate` is a function, **when** `triggerHaptic(40)` runs, **then** it
      calls `navigator.vibrate(40)` and appends **no** `<label>`/`<input>` to the DOM.
- [ ] **Given** `navigator.vibrate` is undefined (iOS), **when** `triggerHaptic([...])` runs, **then**
      it does not throw, creates+clicks a hidden `<input switch>`, and removes the label afterward
      (no leaked DOM nodes).
- [ ] **Given** `navigator.vibrate` throws, **when** `triggerHaptic` runs, **then** it returns
      normally (the never-throws-into-gameplay contract holds).
- [ ] **Given** `navigator.share` exists, **when** `shareToInstagram` runs, **then** it calls
      `navigator.share({ text, url })` and does **not** call `window.open`.
- [ ] **Given** no `navigator.share` but `navigator.clipboard.writeText` exists, **when**
      `shareToInstagram` runs, **then** it writes `"${text} ${url}"` to the clipboard and opens
      instagram.com.
- [ ] **Given** neither Share nor Clipboard exists, **when** `shareToInstagram` runs, **then** it does
      not throw and still calls `window.open`.
- [ ] **Given** `AudioContext`/`webkitAudioContext` exist, **when** `getAudioContext()` is called
      twice, **then** it constructs once and returns the memoized instance.
- [ ] **Given** no audio constructor exists, **when** `getAudioContext()` then `playTone(...)` run,
      **then** the former returns falsy and the latter is a no-op that does not throw.
- [ ] **Given** `crypto.randomUUID` exists, **when** `getPlayerId()` runs, **then** it returns that
      UUID and persists it under `PLAYER_ID_KEY`.
- [ ] **Given** no `crypto.randomUUID`, **when** `getPlayerId()` runs, **then** it returns a non-empty
      `p-…` fallback id and still persists.
- [ ] `getPointerPosition` returns `{x,y}` from a mouse event, from a touch event, and `null` when
      neither is present.
- [ ] `.agent/system/support_matrix.md` exists with (a) the capability table, (b) the
      browser/device table with iOS Safari as the first row and a "Last verified" column, and
      (c) a "How to re-verify" section.
- [ ] `CLAUDE.md` and `.agent/system/architecture.md` reference the new doc.
- [ ] **Guardrails:** `npm run lint`, `npm test`, and `node --check` (the CI triad) all pass; the new
      test runs under the existing `vitest run` with **no** new config file.
- [ ] **Guardrail (globals):** if `getPointerPosition` (or any helper) gains a `module.exports` footer,
      no new top-level global is introduced, so `.eslintrc.json` `globals` needs **no** change; if any
      new top-level `function`/`let`/`const` *is* added to a `public/js/*` file, `.eslintrc.json`
      `globals` is updated in the same change (CI `no-undef` enforces this).
- [ ] **Guardrail (no PII/code):** no test fixture or doc example logs or hard-codes a real 6-digit
      session code or any PII (use the existing `'123456'` placeholder convention from
      `protocol.test.js:30`).
- [ ] **Guardrail (SW):** `public/sw.js` `CACHE` is **not** bumped (no shell asset changed) — confirm
      it is untouched.

## 7. Affected files

| File | Change |
| --- | --- |
| `tests/capabilities.test.js` | **NEW** — capability smoke test; reuses `protocol.test.js`'s JSDOM `makePage()` harness + the `module.exports` import pattern. |
| `.agent/system/support_matrix.md` | **NEW** — living support matrix (capability table + browser/device matrix + re-verify checklist). |
| `public/js/controller.js` | **Possible** tiny change: add a guarded `module.exports` footer exposing `getPointerPosition` (and optionally `triggerHaptic`) for vitest, mirroring utils.js/logic.js. No behavior change. If added, **no** new global → no `.eslintrc.json` change. |
| `CLAUDE.md` | Add a one-line pointer to `support_matrix.md` (Architecture / launch-readiness section). |
| `.agent/system/architecture.md` | Cross-link the new matrix. |

**Flags:** `.eslintrc.json` globals — **no bump expected** (a `module.exports` footer adds no top-level
global). `sw.js` `CACHE` — **no bump** (no shell asset touched).

## 8. Dependencies & sequencing

- **Depends on:** none — the guards already exist; this characterizes them.
- **Unblocks / complements:** any future launch-readiness work that wants a trustworthy "what works
  where" reference. Pairs naturally with analytics-funnel review (the matrix can cite which
  `trackEvent` already covers `share` / `pwa_install`). Should land **before** any refactor of
  `triggerHaptic` or the share path, so that refactor inherits regression coverage.

## 9. Risks & mitigations

- **Global-scope / load-order minefield:** the JSDOM harness must load scripts in `index.html` order.
  *Mitigation:* copy the exact `SCRIPTS` ordering convention from `protocol.test.js:24-27`; load only
  the minimal prefix each capability needs (always `utils` first, since the guards call `safeParse` /
  `debugLog`).
- **jsdom ≠ real browser:** jsdom may *define* `navigator.clipboard`/`AudioContext` differently than a
  phone, so "absent" must be simulated by deleting/overriding on the context, and a green test does not
  prove iOS behavior. *Mitigation:* the test asserts the **guard logic**, not the platform; the
  browser/device matrix carries the real-device claims, each with a verification date, and the "How to
  re-verify" checklist keeps them honest.
- **Mutating shared `navigator`/`window` leaks across tests:** toggling capabilities on a shared JSDOM
  context can bleed into later assertions. *Mitigation:* construct a fresh `makePage()` per describe
  block (as `protocol.test.js` does in `beforeAll`), or save/restore the descriptor in
  `afterEach`; always `dom.window.close()` in `afterAll` to clear timers (`protocol.test.js:88-93`).
- **Adding a `module.exports` footer to `controller.js`:** risk of accidentally changing runtime
  behavior. *Mitigation:* footer is `typeof module !== 'undefined' && module.exports` guarded — a pure
  no-op in the browser classic-script context, identical to utils.js/logic.js.
- **Doc rot:** a support matrix is only useful if maintained. *Mitigation:* each row carries a
  "Last verified" date; the doc lives in `.agent/system/` (the index consulted before large changes)
  and is linked from `CLAUDE.md`.

## 10. Verification / test plan

Given the **no-local-Node, CI-bound** constraint, verification leans on CI plus the manual matrix:

1. **vitest (primary, automated):** the new `tests/capabilities.test.js` runs under `npm test`
   (`vitest run`) — blocking in CI (`.github/workflows/deploy.yml`). This is the load-bearing proof
   for the guard logic. No emulator needed (these paths never touch Firestore/RTDB rules).
2. **lint:** `npm run lint` (`eslint public tests`) must exit clean for the new test (the
   `tests/**/*.js` override sets `sourceType: module`, so `import` is fine — `.eslintrc.json:246-250`).
3. **`node --check`:** the CI syntax pass must pass for any touched `public/js/*` (only if the
   `module.exports` footer is added).
4. **python http.server + Claude_Preview (manual, for the matrix rows):** to fill/refresh the
   browser/device matrix, serve `public/` (`python -m http.server`), open with `?session=123456` to
   force the controller view, **unregister the SW and clear caches first** (network-first SW serves
   stale assets locally — `CLAUDE.md` gotcha), then exercise: joystick drag, food-eat haptic, loss
   flash + loss buzz, and each share button. Record the result + date per row.
5. **No scratch Firebase project / no rules changes** — this change ships no `firestore.rules` /
   `database.rules.json` edits, so the rule-deploy path is untouched.

Negative verification: temporarily delete a guard locally (e.g. drop the `if (AC)` check) and confirm
the capability test goes **red** — proving the smoke test would actually catch a regression. (Revert
before committing.)

## 11. Analytics & observability

No new events. The matrix should **cross-reference existing** `trackEvent` coverage so capability usage
remains observable in GA4 without adding anything:

- `share` (`share.js:88`) already records `method` (`whatsapp|x|facebook|instagram`) — the Instagram
  branch is the one gated by `navigator.share`/clipboard, so its volume is a *proxy* for Web Share
  reach on real devices.
- `pwa_install`, `controller_connected`, `controller_arrival` already cover the connect funnel.

If, during this work, we want field signal on the **iOS haptic fallback** actually firing, that is a
*separate, optional* follow-up (a single `trackEvent('haptic_fallback', { path: 'switch' })` at
`controller.js:243`) — explicitly **out of scope** here to keep this test-and-docs only, and noted in
the matrix as a future option. Any such event must route through the hardened `trackEvent()`
(`utils.js`), no-op offline, and **never** include the session code or PII.
