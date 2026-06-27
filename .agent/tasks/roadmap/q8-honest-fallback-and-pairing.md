# Q8 · Honest 2-device localStorage fallback + desktop-host pairing nudges

> **Tier** quick-win · **Focus** Growth · **Impact** Medium · **Effort** S (hours) · **Priority** 66/100
> **Status** `Not started` · **Depends on** none · **Part of** [Roadmap](./README.md)

## 1. Problem — what we're solving

Two related pairing-funnel defects make the "phone joins desktop" handshake quietly lie to the
user — exactly the created-but-never-paired drop-off the M2 measurement work wants to see.

**(A) The localStorage fallback is dishonest across two physical devices.**
`connectViaRobustHybrid()` in `public/js/controller.js` only fails into single-device mode when it
*should* — but it does so with the wrong copy and in a case where it cannot possibly work:

- When the session doc is genuinely missing, the code already does the right thing: it tags the
  error `notFound` (`controller.js:371-373`), resets retries, and shows
  `'Session not found — check the 6-digit code on the game screen.'` (`controller.js:382-386`).
- But when the doc **was found** and a *later* step fails (the RTDB `.set()` at
  `controller.js:357`, the Firestore `connected:true` update at `controller.js:350`, a transient
  network blip, or `waitForFirebaseReady()` timing out — none of which set `error.notFound`),
  the retry loop exhausts (`gameConfig.connectionRetries = 5`, `config.js:94`) and the catch falls
  through to `showConnectionError('Could not connect via Firebase. Trying local mode...')` then
  `connectViaLocalStorage(sessionCode)` (`controller.js:394-397`).
- `connectViaLocalStorage()` (`controller.js:406-436`) then checks
  `localStorage.getItem('currentSession') === sessionCode`. On a **real phone**, this key was
  written by `setupLocalStorageSession()` on the *desktop's* `localStorage` (`network.js:216`) —
  a different device, different storage. It can never match, so the phone shows
  `'Session not found. Make sure the game is running on desktop…'` (`controller.js:434`). The user
  just watched "Trying local mode…" promise a recovery that is **structurally impossible** between
  two devices. localStorage only bridges two tabs on **one** machine (the documented single-device
  test path, CLAUDE.md "localStorage fallback").

**(B) The desktop host "Waiting for mobile controller…" state is invisible and unhelpful.**

- `updateConnectionStatus()` (`public/js/game.js:684-686`) **only `debugLog`s** — it writes nothing
  to the DOM. So the host strings `'Waiting for mobile controller...'` (`network.js:170`) and
  `'Mobile controller connected ✅'` (`network.js:137`) are never shown to the user at all. The
  desktop pairing card (`index.html:173-210`) shows the QR, three steps, and a static
  "No camera? … enter `123456`" note (`index.html:206-209`) — but **no live status, no timeout
  nudge, and no "still waiting?" prompt** if a phone never connects.
- There is **no in-app camera** anywhere in the codebase (`grep getUserMedia|mediaDevices` over
  `public/` returns zero matches): the phone scans the QR with its **native camera app**, so the
  brief's "camera-permission-denied help" is a misframe — the actionable nudge is a **"can't scan?
  open/copy this link"** affordance, not an in-app permission prompt. A copyable join link already
  exists *only* in the QR-library-unavailable fallback (`renderJoinFallback()`, `network.js:299-331`)
  and as plain static text in `.qr-fallback-note` (`index.html:206`); neither is offered as a live
  "still not paired after N seconds?" escalation.

Net effect: a user who scans and hits any post-lookup hiccup, or who simply can't scan, gets either
a structurally-impossible "local mode" promise or a dead-end static card — with the host showing no
sign anything is wrong. That is precisely the silent pairing-funnel leak this initiative targets.

## 2. Why it matters

This is a **Growth** quick-win on the single most fragile step of the product: the cross-device
handshake. Every player arrives the same way — scan/enter code → become a controller — and any
honesty gap here converts a curious visitor into a bounce **before they ever play**. Two concrete
wins:

- **Stop lying to phones.** Replacing the impossible "Trying local mode…" promise with an honest,
  actionable retry/error message means a phone that hit a transient Firebase hiccup tells the user
  to re-tap Connect (which often succeeds) instead of dead-ending in "Session not found."
- **Make the host pairing card actively help.** A live "Waiting for your phone…" status, a "still
  waiting?" nudge after a timeout, and a one-tap **Copy link** affordance give the can't-scan user
  a path forward — directly attacking the created-but-never-paired drop-off M2 wants to *measure*
  by also *reducing* it. Pairing-success is the top-of-funnel that everything else (leaderboard,
  multiplayer, sharing) depends on, so a few percentage points here compound. Supports "pushing
  for real users": the live demo (https://go-console-84748.web.app/) should never show a recovery
  that cannot work.

## 3. Goals

- **Honest fallback:** never show "Trying local mode…" (or silently enter localStorage mode) on the
  phone when a **remote** session was actually found. localStorage fallback on the controller is
  reserved for genuine single-device testing (same machine, two tabs), detected before claiming it.
- **Honest post-lookup failure copy:** when the doc was found but a later step fails after retries
  exhaust, the phone shows a clear, retryable message ("Couldn't finish connecting — tap Connect to
  try again") rather than a false promise.
- **Live host pairing status:** the desktop pairing card surfaces a real "Waiting for your phone…"
  → "Phone connected ✅" status (make `updateConnectionStatus()` actually render).
- **Timeout nudge on host:** after a configurable wait (no phone connected), the host shows a "Still
  waiting? Make sure both devices have internet, or copy the link below" nudge.
- **Manual link/copy affordance on host:** a always-available "Copy link" (and the join URL) so a
  user who can't scan can paste it into their phone — reusing the URL already built in
  `generateQRCode()` (`network.js:262`).
- **Instrument the funnel:** emit `trackEvent` for the new nudge/fallback states so M2 can measure
  the created-but-never-paired gap (never logging the 6-digit code).

## 4. Non-goals

- **No in-app camera / `getUserMedia`.** There is none today; we are not adding an in-browser QR
  scanner or a camera-permission prompt. The "can't scan" path is link/copy, not camera.
- **Not** reworking the multiplayer join/lobby journey (`mp-client.js` / `mp-net.js` / `mp-ui.js`).
  The doc-found multiplayer branch (`controller.js:321-323`) already routes to `connectMultiplayer`
  and never touches the legacy localStorage fallback; we only ensure the *legacy* path's fallback
  is honest. (Host-side status/nudge/copy benefits both modes since they share the pairing card.)
- **Not** changing the throttle/retry *counts* or `gameConfig.connectionRetries` /
  `retryDelayMs` semantics — only what we show when they exhaust.
- **Not** touching `firestore.rules` / `database.rules.json` (no transport/schema change) — so no
  scratch-project rules deploy is required.
- **Not** removing the localStorage single-device test path — it stays for `npm start` two-tab use.
- **Not** a visual redesign of the pairing card; additive status/nudge/copy elements that reuse
  existing tokens and the existing `.qr-fallback-note` styling.

## 5. Proposed solution

### 5.1 Honest controller fallback (`public/js/controller.js`)

The root cause is the blanket fall-through at `controller.js:394-397`. Two changes:

1. **Track whether the remote session was found.** In `connectViaRobustHybrid()`, after
   `docSnapshot.exists` is true (`controller.js:314`), set a flag on `sessionManager` (e.g.
   `sessionManager.remoteSessionFound = true`) **before** the later RTDB/Firestore steps that can
   throw. (Reuse the existing `sessionManager` global — `state.js` — rather than a new module
   global, to avoid an `.eslintrc.json` globals churn.)

2. **Gate the localStorage fallback on "no remote session found".** Replace the unconditional
   `connectViaLocalStorage(sessionCode)` at `controller.js:397` with:
   - If `sessionManager.remoteSessionFound` is **true** (remote doc existed; a later step failed):
     do **not** enter localStorage mode. Show an honest, retryable error, e.g.
     `showConnectionError('Couldn't finish connecting. Check your connection and tap Connect to try again.')`
     and reset `sessionManager.connectionRetries = 0` so the next tap is a clean attempt. Emit
     `trackEvent('controller_connect_failed', { reason: 'post_lookup' })`.
   - If `sessionManager.remoteSessionFound` is **falsy** (we never confirmed a remote doc — e.g.
     `waitForFirebaseReady()` rejected before the `.get()`, so Firebase is effectively unavailable
     to this controller): keep the existing `connectViaLocalStorage(sessionCode)` call — this is the
     only case where same-device localStorage testing could legitimately apply.

3. **Relabel the transition copy.** The pre-fallback line
   `showConnectionError('Could not connect via Firebase. Trying local mode...')`
   (`controller.js:396`) is only reached in the falsy branch now; reword it to not promise
   cross-device "local mode" (e.g. `'Couldn't reach the game server — retrying locally for same-device testing…'`),
   keeping it accurate for the single-device case it actually serves.

4. **Keep the `notFound` branch unchanged** (`controller.js:382-386`) — it is already honest.

All copy goes through the existing `showConnectionError()` / `setConnectionStatus()` helpers
(`controller.js:455-473`); no new DOM wiring on the phone.

### 5.2 Make host status visible + add nudge & copy (`public/js/game.js`, `public/js/network.js`, `index.html`, `public/css/desktop.css`)

1. **Render the status.** Upgrade `updateConnectionStatus()` (`game.js:684-686`) from a `debugLog`-only
   stub to also write into a new `#desktop-pairing-status` element on the pairing card (created in
   `index.html` inside `.connection-card`, near `index.html:186-189`). Keep the `debugLog` line. The
   function is already in `.eslintrc.json` globals (`updateConnectionStatus`, line 198) and already
   called from `network.js:137/170/233/246`, so this is a behavior upgrade with **no new global**.
   - "Waiting for your phone…" while waiting (replace the dev-flavored
     `'Waiting for mobile controller...'` user-facing copy; the localStorage variant at
     `network.js:246` can stay debug-only or read "Waiting (same-device test mode)…").
   - "Phone connected ✅" on the `controllerTracked` edge (`network.js:135-139`).

2. **Timeout nudge.** When the host session becomes ready (`network.js:168-170`, hybrid) start a
   single `setTimeout` (new tunable `gameConfig.pairingNudgeMs`, e.g. `20000`, added in `config.js`
   beside `connectionRetries`/`retryDelayMs` at `config.js:93-95`). If no controller has connected
   by then (`!sessionManager.controllerTracked`), reveal a "Still waiting? Make sure both devices
   are online — or copy the link below." nudge (`#desktop-pairing-nudge`, hidden by default) and
   emit `trackEvent('pairing_nudge_shown', { transport: 'hybrid' })`. Clear/skip the nudge once
   `controllerTracked` flips true (in the existing guard at `network.js:135-139`), and emit
   `trackEvent('controller_connected', { side: 'desktop', via: 'paired_after_nudge'|'paired' })`
   — actually, keep the existing `controller_connected` call untouched and add a separate
   `pairing_succeeded` event carrying whether the nudge had fired, so the funnel math is clean.

3. **Manual link / copy affordance.** Add a "Can't scan? Copy link" button + the join URL to the
   pairing card. Reuse the URL `generateQRCode()` already computes
   (`const gameUrl = …?session=${sessionCode}`, `network.js:262`) — factor that one expression into
   a tiny helper or stash it on `sessionManager` so both the QR and the copy button use the same
   string. Wire the button to `navigator.clipboard.writeText(gameUrl)` with a graceful fallback
   (select-the-text) and a transient "Copied!" confirmation; emit `trackEvent('pairing_link_copied')`.
   - **XSS-safety:** build the link/URL with `textContent`/`href` exactly as `renderJoinFallback()`
     does (`network.js:319-325`) — never `innerHTML` with the URL. The 6-digit code already appears
     on-screen in `#session-code` (`index.html:208`); the **copied link contains the code in its
     query string** — that's fine to put in the user's clipboard (it's the join URL), but the code
     must **never** be sent to `trackEvent` (see §11).

4. **Styling.** Add `.pairing-status`, `.pairing-nudge`, and a copy-button rule to
   `public/css/desktop.css`, mirroring the existing `.qr-fallback-note` / `.code-value` token usage
   (`desktop.css:397-418`): `var(--color-text-secondary)`, `var(--color-warning)` for the nudge,
   `var(--font-size-sm)`, `var(--space-*)`, `var(--radius-*)`. No new color values.

### 5.3 Both-transports / both-modes implications

- **Transports:** The controller fix is transport-aware by construction — it distinguishes "remote
  Firestore doc found" from "Firebase unavailable to this device," which is exactly the
  hybrid-vs-localStorage boundary. The host status/nudge primarily targets the **hybrid** path
  (`setupRobustHybridSession`, `network.js:66-177`); the localStorage host path
  (`setupLocalStorageSession`, `network.js:212-247`) keeps its status debug-only or labels it
  "same-device test mode" so it isn't mistaken for real cross-device waiting.
- **Modes:** Solo (`game.js`) and multi (`mp-*.js`) share the **same pairing card**
  (`index.html:173-210`), so the host status/nudge/copy benefit both. The honest-fallback gating is
  in the **legacy** controller path only; the multiplayer branch (`controller.js:321-323`) returns
  into `connectMultiplayer` before any fallback and is unaffected.

## 6. Acceptance criteria

Controller (phone) honesty:

- [ ] **Given** a phone connecting to a code whose session doc **exists** in Firestore, **When** a
  *post-lookup* step (RTDB `.set`, Firestore update, or transient error **without** `error.notFound`)
  fails and all `gameConfig.connectionRetries` retries are exhausted, **Then** the phone shows a
  retryable error (no "local mode" wording) and **does not** call `connectViaLocalStorage()`, and
  `sessionManager.connectionRetries` is reset to `0`.
- [ ] **Given** that same exhausted-post-lookup state, **When** the user taps **Connect** again,
  **Then** a fresh `attemptConnection()` runs (clean retry counter).
- [ ] **Given** a phone where `waitForFirebaseReady()` **rejects** (Firebase never became available)
  and the remote doc was therefore **never** confirmed, **When** retries exhaust, **Then** the
  localStorage path is still attempted (single-device behavior preserved) and any copy shown is
  framed as same-device testing — never an impossible cross-device "local mode" promise.
- [ ] **Negative:** **Given** a wrong/typo'd code (doc missing, `error.notFound` true), **When**
  connecting, **Then** behavior is unchanged: `'Session not found — check the 6-digit code on the
  game screen.'`, retries reset, no fallback (`controller.js:382-386` path intact).
- [ ] The string `Trying local mode...` no longer appears for any case where a remote session was
  found (grep the repo: it must only remain — if at all — on the genuine single-device branch with
  same-device wording).

Host (desktop) pairing card:

- [ ] **Given** a freshly created hybrid session, **When** the card renders, **Then** a visible
  status reads "Waiting for your phone…" (i.e. `updateConnectionStatus()` now writes to
  `#desktop-pairing-status`, not just `debugLog`).
- [ ] **Given** a controller connects (the `controllerTracked` edge fires, `network.js:135`),
  **When** the status updates, **Then** the card shows "Phone connected ✅" and the timeout nudge is
  cleared/never shown.
- [ ] **Given** no controller connects within `gameConfig.pairingNudgeMs`, **When** the timer fires,
  **Then** the "Still waiting? … copy the link below." nudge becomes visible and
  `trackEvent('pairing_nudge_shown', …)` is emitted **once**.
- [ ] **Given** the pairing card, **When** the user clicks **Copy link**, **Then** the join URL
  (`…?session=<code>`, identical to the QR target) is copied to the clipboard (or selected as a
  fallback when `navigator.clipboard` is unavailable), a transient "Copied!" confirmation shows, and
  `trackEvent('pairing_link_copied')` fires.
- [ ] The copy link/URL is rendered via `textContent`/`href` (never `innerHTML`) — verified by code
  review against the `renderJoinFallback()` pattern (`network.js:319-325`).

Guardrails:

- [ ] `.eslintrc.json` `globals` updated for **every** new top-level `function`/`let`/`const` added
  in `public/js/*` (e.g. any new helper for the gameUrl/copy/nudge, plus the new `gameConfig`
  tunable is on the existing `gameConfig` object so needs no new global). If no new top-level
  declaration is introduced (preferred — hang state on `sessionManager`/`gameConfig`), state that
  explicitly. CI `no-undef` stays green.
- [ ] `sw.js` `const CACHE` **bumped** — `index.html` (shell asset) changes, and an already-installed
  SW must serve the new pairing markup after one reload (network-first SW; project gotcha).
- [ ] **No PII and no 6-digit session code** passed to any `trackEvent()` call (the code may be in
  the clipboard URL and on-screen, but never in analytics params).
- [ ] CI green: `npm run lint`, `npm test` (Vitest, incl. `tests/protocol.test.js` jsdom smoke), and
  the `node --check` syntax pass all succeed.

## 7. Affected files

| File | Change |
| --- | --- |
| `public/js/controller.js` | Set `sessionManager.remoteSessionFound = true` after `docSnapshot.exists` (~line 314). Gate the post-retry fallback (~lines 394-397) on that flag: honest retryable error + retry reset when a remote session was found; only fall to `connectViaLocalStorage()` when Firebase was never available. Reword the localStorage-branch copy (~line 396) to same-device framing. Add `trackEvent('controller_connect_failed', …)`. |
| `public/js/game.js` | Upgrade `updateConnectionStatus()` (lines 684-686) to also write the status into `#desktop-pairing-status` (keep `debugLog`). No signature change → no globals change. |
| `public/js/network.js` | Surface user-facing host status copy ("Waiting for your phone…" / "Phone connected ✅") via `updateConnectionStatus` (lines 137, 170; localStorage variants 233, 246 stay debug/test-framed). Start the pairing-nudge `setTimeout` when the hybrid session is ready (~line 168-170); clear it on the `controllerTracked` edge (~line 135). Reuse/stash the `gameUrl` from `generateQRCode()` (line 262) for the copy button. Add the copy handler + `trackEvent('pairing_nudge_shown' / 'pairing_link_copied' / 'pairing_succeeded')`. |
| `public/index.html` | Add `#desktop-pairing-status`, `#desktop-pairing-nudge` (hidden), and a "Copy link" button + join-URL element inside `.connection-card` (near lines 186-209). **Shell asset → requires `sw.js` `CACHE` bump.** |
| `public/css/desktop.css` | Add `.pairing-status` / `.pairing-nudge` / copy-button rules mirroring `.qr-fallback-note` & `.code-value` token usage (lines 397-418). No new color values. |
| `public/js/config.js` | Add `pairingNudgeMs` (e.g. `20000`) to the `gameConfig` Connection-settings block (lines 93-95). On the existing `gameConfig` object → no new global. |
| `public/sw.js` | Bump `const CACHE` (shell `index.html` changed). |
| `.eslintrc.json` | Update `globals` **iff** a new top-level `function`/`let`/`const` is added in `public/js/*` (prefer hanging state on `sessionManager`/`gameConfig` to avoid this). |

## 8. Dependencies & sequencing

- **Depends on:** none. Self-contained; no transport/schema/rules change.
- **Relationship to M2 (created-but-never-paired measurement):** this initiative both *reduces* and
  *instruments* that drop-off. If M2 defines the canonical funnel event names, align the new
  `pairing_*` events with that taxonomy; otherwise these events seed it. Not a hard blocker either
  way.
- **Independent of** the multiplayer presence/host-resilience work (`m12-…`) — that touches the
  roster/presence layer, not the pairing-card status; no merge coupling expected beyond both editing
  `network.js` (different functions).

## 9. Risks & mitigations

- **Risk: mis-gating the fallback** — accidentally suppressing localStorage for a legitimate
  same-device test, or accidentally entering it cross-device. **Mitigation:** the gate keys on a
  single, unambiguous fact (`docSnapshot.exists` was observed for this attempt) set right where the
  doc is read (`controller.js:314`); acceptance criteria cover both branches plus the `notFound`
  negative.
- **Risk: nudge fires after the phone already connected** (race between the timer and the
  `controllerTracked` edge). **Mitigation:** the timer callback re-checks
  `!sessionManager.controllerTracked` before showing the nudge, and the connect edge cancels the
  timer; the `controllerTracked` guard already exists (`network.js:135`).
- **Risk: `navigator.clipboard` unavailable (insecure context / older browser).** **Mitigation:**
  feature-detect and fall back to selecting the visible URL text; never throw (mirror the
  best-effort, never-throw posture of `triggerHaptic` and `trackEvent`).
- **Risk: leaking the 6-digit code into analytics** (it's in the copied URL). **Mitigation:**
  `trackEvent` calls carry only categorical params (`transport`, boolean "nudge had fired"); a code
  review check + acceptance criterion forbid the code/PII (CLAUDE.md analytics rule).
- **Risk: global-scope / load-order breakage** (everything shares one scope; `no-undef` is on).
  **Mitigation:** prefer storing new state on existing globals (`sessionManager`, `gameConfig`); if
  any new top-level decl is unavoidable, add it to `.eslintrc.json` `globals` in the same change
  (that CI failure is the feature). `updateConnectionStatus` is already declared.
- **Risk: stale pairing card via installed PWA SW.** **Mitigation:** bump `const CACHE` in `sw.js`;
  SW is network-first so online users get fresh markup on next load (one reload for installed SW).

## 10. Verification / test plan

No local Node; CI-bound. Layered proof:

1. **CI gates (blocking):** push the branch; confirm `npm run lint` (esp. `no-undef` with any
   globals delta), `npm test` (Vitest incl. the `tests/protocol.test.js` jsdom smoke), and
   `node --check` all stay green. No rules emulator needed (rules untouched).
2. **Unit-testability:** the honest-fallback decision is a pure branch on
   `sessionManager.remoteSessionFound` + `error.notFound`. If feasible without DOM, extract the
   decision into a tiny pure predicate (or assert via the existing protocol smoke harness) so the
   "found-but-later-failed ⇒ no localStorage" rule is covered in `tests/`. Otherwise document it as
   manual.
3. **`python -m http.server` + Claude_Preview (visual/behavioral proof)** — **unregister the SW and
   clear caches first** (network-first SW serves stale assets locally):
   - **Host card:** load the desktop view, confirm "Waiting for your phone…" is visible
     (`preview_eval` reads `#desktop-pairing-status.textContent`). Force the nudge by setting
     `gameConfig.pairingNudgeMs` low (or `preview_eval` calling the nudge directly) and assert
     `#desktop-pairing-nudge` becomes visible and `pairing_nudge_shown` was queued.
   - **Copy link:** click **Copy link** via `preview_click`; assert the clipboard write (or
     text-selection fallback) and the transient "Copied!" state; confirm the copied string equals
     the QR target (`…?session=<code>`).
   - **Controller honesty (simulate post-lookup failure):** open the controller view
     (`?session=123456`), use `preview_eval` to stub `firestore`/`database` so the doc `.get()`
     resolves `{exists:true}` but the subsequent RTDB `.set()` rejects; drive `attemptConnection`
     and assert (a) no `connectViaLocalStorage` call (spy), (b) the retryable non-"local mode"
     message, (c) retries reset. Repeat with `waitForFirebaseReady` rejecting to confirm the
     single-device branch still runs.
   - **Grep check:** confirm "Trying local mode..." no longer appears on any remote-found path.
4. **No scratch Firebase project required** — no `firestore.rules` / `database.rules.json` change.
   (Optional end-to-end smoke on a scratch project if you want a real two-device pairing pass, but
   not required for this change.)

## 11. Analytics & observability

Route everything through the hardened `trackEvent()` (`utils.js`), which no-ops offline and never
throws, auto-tagging `device_role`. **Never include the 6-digit code or any PII** (the code lives in
the clipboard URL and on-screen only).

New events to add:

- `pairing_nudge_shown` — `{ transport: 'hybrid' }` — host timeout nudge surfaced (no phone after
  `pairingNudgeMs`). The created-but-never-paired signal M2 wants.
- `pairing_link_copied` — `{}` — user used the "can't scan" copy affordance (measures scan-failure
  recovery demand).
- `pairing_succeeded` — `{ after_nudge: true|false }` — a controller connected; `after_nudge`
  distinguishes "nudge helped" from clean pairs. Pairs with the existing
  `trackEvent('controller_connected', { side: 'desktop' })` (`network.js:138`) for funnel math —
  do **not** remove that call.
- `controller_connect_failed` — `{ reason: 'post_lookup' }` — phone-side: remote session found but
  the handshake couldn't finish after retries (the honest-error branch). Complements the existing
  `controller_arrival` / `controller_connected` funnel (`controller.js:16`, `controller.js:330`).

Watch in GA4: `session_created` → (`pairing_nudge_shown`?) → `pairing_succeeded` /
`controller_connect_failed`, plus `pairing_link_copied` rate, to quantify the pairing drop-off and
whether the nudge/copy affordances recover it.
