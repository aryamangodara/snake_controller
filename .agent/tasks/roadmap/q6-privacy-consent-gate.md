# Q6 · Privacy policy + analytics consent gate

> **Tier** quick-win · **Focus** Launch-readiness · **Impact** Medium · **Effort** S (hours) · **Priority** 72/100
> **Status** `Not started` · **Depends on** none — **GATES M2** · **Part of** [Roadmap](./README.md)

## 1. Problem — what we're solving

GA4 (Firebase Analytics) is initialised **unconditionally** and **before any user choice**:

- `public/index.html:29` loads `firebase-analytics.js` (v8 compat) in `<head>` alongside the other
  Firebase tags.
- `public/js/config.js:47-51` calls `analytics = firebase.analytics();` inside
  `initializeFirebase()`. That call boots the GA4 `gtag` runtime, which **sets first-party cookies
  (`_ga`, `_ga_<id>`)** and begins collecting `page_view` / `session_start` / device + geo + language
  plus acquisition data (`referrer`, `utm_*`) — see `.agent/system/analytics.md:30-31`.
- `public/js/main.js:18-23` then sets a `device_role` GA4 **user property** on every load.

There is **no consent banner, no privacy-policy link, and zero `navigator.doNotTrack` handling**
anywhere in the codebase (confirmed: a repo-wide search for `consent | doNotTrack | privacy | GDPR |
CCPA` returns **no matches** in `public/`). The analytics doc even states the choice explicitly:
"No cookie-consent banner is shown (owner choice; GA4 anonymizes IPs by default)"
(`.agent/system/analytics.md:5-6`).

For a **publicly-linked, share-driven** app (the whole growth model is "send the link / scan the QR"),
cookies-before-consent is a concrete **GDPR / ePrivacy / CCPA** exposure and a trust gap on the landing
screen. The planned **M2 analytics-funnel expansion** (more `trackEvent` calls, `js_error` telemetry)
**increases** the volume and sensitivity of what we collect, so the consent story must land **first** —
this initiative GATES M2.

The good news: `trackEvent()` (`public/js/utils.js:46-55`) is **already hardened to no-op** whenever
the `analytics` handle is absent — so if we simply *withhold* the handle until consent, every existing
call site (`session_created`, `game_over`, `share`, `pwa_install`, …) degrades to a silent no-op with
**no per-call-site changes**. The fix is therefore small and surgical.

## 2. Why it matters

- **Launch-readiness / "pushing for real users":** a public URL shared on Instagram/WhatsApp/X is
  exactly the audience consent law is written for (EU/UK/California visitors arriving cold). A visible
  privacy policy + a consent affordance is table-stakes credibility for a "go live" app and removes a
  blocker to confidently promoting the link.
- **Legal risk reduction:** GA cookies are non-essential. Dropping them before consent (and honouring
  Do-Not-Track) is the defensible default and de-risks the M2 telemetry expansion.
- **Trust:** a clean, on-brand "we use analytics — your call" prompt + policy reads as a *finished*
  product, not a hobby page. It costs one banner and one policy section.
- **Unblocks M2:** with the gate in place, adding more events (incl. `js_error`) is purely additive and
  carries no incremental consent risk.

## 3. Goals

- Do **not** call `firebase.analytics()` (no GA cookies, no `gtag` boot) until the user has either
  (a) actively accepted, or (b) been auto-accepted because no consent decision is required (see §5
  decision table).
- Honour `navigator.doNotTrack` (and the `Sec-GPC` / `navigator.globalPrivacyControl` signal where
  present): when DNT/GPC is on, **treat as declined** and never init analytics, never show the banner.
- Persist the user's choice (localStorage) so the banner shows **once**, not every visit.
- Provide a **privacy policy** (in-page section/modal) reachable from a visible link, documenting what
  GA4 collects, the cookies set, retention, and how to opt out / withdraw consent.
- Keep `trackEvent()` a **silent no-op** while consent is absent or declined (it already is — verify,
  don't rewrite).
- Show the consent affordance **desktop-host only by default** (the phone controller arrives via
  `?session=` deep link mid-flow; a banner there interrupts the join). Phones inherit "declined until
  the host site is visited" — analytics on the phone simply stays no-op. (Revisit in M2 if phone
  funnel coverage is needed; out of scope here.)
- Zero gameplay regression and zero new lint/CI failures.

## 4. Non-goals

- **No** server-side consent storage, no auth, no per-region geo-IP gating logic (the security model is
  no-auth by design — `.agent/system/firebase_schema.md`). A single client-side localStorage flag +
  DNT signal is the scope.
- **No** consent management platform (CMP) / third-party cookie library. Hand-rolled, dependency-free,
  in keeping with the no-bundler / plain-`<script>` architecture.
- **No** change to Firestore/RTDB (sessions, joystick stream, leaderboard) — those are **functional**
  data the user explicitly opts into by playing, not tracking cookies. Consent here is **analytics
  only**.
- **No** blocking the game behind consent. Snake must be fully playable whether the user accepts,
  declines, or ignores the banner. The banner is non-modal.
- **No** legal-copy authoring beyond a plain-English, accurate description of GA4 data + opt-out. (Owner
  may refine wording; the spec ships a correct default.)
- **No** cookie banner on the phone controller view (see Goals rationale).

## 5. Proposed solution

A tiny, dependency-free consent layer that sits **between** "Firebase core ready" and "analytics
booted", plus a privacy section. Lives mostly in a new `js/consent.js` to keep `config.js` lean.

### 5.1 Defer the analytics handle (`public/js/config.js:47-51`)

Today `initializeFirebase()` boots Firestore + RTDB **and** analytics in one shot. Split it: keep the
DB/firestore init unconditional (functional), but **gate the `firebase.analytics()` call** behind a
consent check.

- Extract the analytics-boot lines into a named function, e.g. `enableAnalytics()`, that:
  - is **idempotent** (early-return if `analytics` is already set, or if `firebase`/`firebase.analytics`
    is unavailable),
  - keeps the **existing inner try/catch** (`config.js:47-51`) so an analytics failure still never
    drops the app into offline mode (preserve that guarantee — it is load-bearing),
  - on success, calls the existing `device_role` user-property tagging currently in
    `main.js:18-23` (move or re-invoke it here so the property is only set once analytics actually
    exists; `main.js` already guards on `typeof analytics`).
- In `initializeFirebase()`, **do not** call `enableAnalytics()` directly. Instead call a new
  `consentInit()` (in `consent.js`) which decides whether to boot now, wait for a click, or stay off.

### 5.2 Consent decision table (`public/js/consent.js` — NEW)

Resolve a stored decision + the DNT/GPC signal at startup:

| Condition | Action |
| --- | --- |
| `navigator.doNotTrack === '1'` / `'yes'`, OR `navigator.globalPrivacyControl === true` | **Decline.** No analytics, no banner. (Respect the browser-level signal.) |
| localStorage `snake_consent` === `'granted'` | **Enable** analytics immediately (returning visitor who accepted). |
| localStorage `snake_consent` === `'denied'` | **Skip** analytics, no banner (returning visitor who declined). |
| No stored value, desktop host, DNT off | **Show the banner**; analytics stays off until "Accept". |
| Phone controller (`!sessionManager.isDesktop`) with no stored grant | **Skip** analytics + **skip** banner (don't interrupt the join). |

- Store key: `const CONSENT_KEY = 'snake_consent';` value `'granted' | 'denied'`. Reuse the existing
  `safeParse`/`localStorage` resilience mindset from `utils.js:27-35` (here a plain string read wrapped
  in try/catch is enough).
- DNT read must be defensive: `navigator.doNotTrack`, legacy `window.doNotTrack`, and
  `navigator.msDoNotTrack` all exist across browsers — normalise to a boolean.

### 5.3 Consent banner (markup in `public/index.html`)

A **non-modal** bottom banner inside `#desktop-view`, hidden by default (`.hidden`, reusing the
existing `.hidden { display:none !important }` rule at `base.css:77-79`):

```html
<div id="consent-banner" class="consent-banner hidden" role="region" aria-label="Privacy and analytics">
  <p class="consent-text">
    We use Google Analytics to understand how the game is used. No personal data or your session code
    is collected. <button id="consent-learn" class="consent-link" type="button">Privacy &amp; data</button>
  </p>
  <div class="consent-actions">
    <button id="consent-decline" class="btn consent-btn-secondary" type="button">Decline</button>
    <button id="consent-accept" class="btn consent-btn-primary" type="button">Accept</button>
  </div>
</div>
```

- Reuse the base `.btn` class (`base.css:114-133`) + the `--focus-ring` / `--focus-outline` tokens
  (`variables.css:74-75`) so the buttons match the rest of the UI and keep accessible focus rings.
- "Accept" → `setConsent('granted')` → `enableAnalytics()` → hide banner + fire a single
  `consent_update` event (see §11). "Decline" → `setConsent('denied')` → hide banner, analytics stays
  off. Both persist to localStorage so the banner never reappears.
- Wire listeners on `DOMContentLoaded`, mirroring the leaderboard-ui pattern
  (`leaderboard-ui.js:75-85`): `getElementById` + `addEventListener`, all null-guarded.

### 5.4 Privacy policy (markup in `public/index.html` + open/close in `consent.js`)

A `#privacy-modal` reusing the **exact leaderboard-modal pattern** for zero new CSS-architecture risk:
backdrop + centered panel, `role="dialog" aria-modal="true"`, a `&times;` close button, backdrop-click
and `Escape`-to-close — copy the wiring from `leaderboard-ui.js:75-85` and the `.leaderboard-modal` /
`.leaderboard-panel` styles (`leaderboard.css:5-54`). Content is **static, hand-authored** plain text
(rendered as literal HTML in the markup, so no XSS surface — unlike leaderboard rows there is no
user-supplied data here). It documents:

- **What GA4 collects:** page views, session/engagement, approximate geo (city-level, IP anonymised),
  device/browser/language, referrer + `utm_*` campaign tags, and the custom funnel events listed in
  `.agent/system/analytics.md:33-47`.
- **What is NOT collected:** no name/email/PII, **never the 6-digit session code** (guardrail), no
  precise location.
- **Cookies set:** `_ga`, `_ga_G-0DFSB38H21` (GA4), purpose + lifespan.
- **Opt out / withdraw:** "Decline" button, browser Do-Not-Track / GPC, and clearing site data; link to
  Google's data practices.

Open the modal from: the banner's "Privacy & data" button **and** a small persistent **"Privacy"**
footer link added to the desktop `top-header` social section (`index.html:106-119`) so the policy is
reachable **after** the banner is dismissed (regulatory requirement: policy must remain accessible).

### 5.5 New CSS

Add a small `.consent-banner` / `.consent-*` block. **Preferred location:** append to
`public/css/base.css` (shared by both views, already loaded) — this avoids adding a new stylesheet to
the load order **and** the `sw.js` shell list. Use existing tokens only (`--color-surface`,
`--color-border`, `--space-*`, `--radius-*`, `--shadow-lg`, `--focus-outline`). The privacy modal reuses
`.leaderboard-modal` styles where possible; only additive selectors if needed.

### Both-transports / both-modes implications

- **None for sync.** This touches only the GA4 boot path. Firestore (`sessions/{code}`), RTDB
  (`controllers/{code}`), and the **localStorage fallback** transports are untouched — they carry
  functional data the user opts into by playing.
- **Solo and multi** both route analytics through the same `analytics` global + `trackEvent()`; gating
  the single handle covers both engines with no mp-specific work.
- **localStorage fallback mode:** when Firebase init fails entirely, `analytics` is already `undefined`
  and `trackEvent()` no-ops — the banner simply never needs to enable anything. `consentInit()` must
  not throw in that path (guard on `typeof firebase`).

## 6. Acceptance criteria

- [ ] **Given** a first-time desktop visitor with DNT off, **when** the page loads, **then**
      `firebase.analytics()` has **not** been called and **no** `_ga*` cookie exists until they click
      "Accept" (verify via DevTools Application → Cookies, and a breakpoint / log on the analytics-boot
      function).
- [ ] **Given** the banner is shown, **when** the user clicks **Accept**, **then** `analytics` becomes
      defined, the `_ga` cookies appear, the banner hides, `localStorage['snake_consent'] === 'granted'`,
      and a single `consent_update` event fires.
- [ ] **Given** the banner is shown, **when** the user clicks **Decline**, **then** `analytics` stays
      `undefined`, **no** `_ga` cookie is set, the banner hides, and `localStorage['snake_consent'] ===
      'denied'`.
- [ ] **Given** a returning visitor with `snake_consent === 'granted'`, **when** the page loads, **then**
      analytics boots immediately and the banner is **not** shown.
- [ ] **Given** a returning visitor with `snake_consent === 'denied'`, **when** the page loads, **then**
      analytics stays off and the banner is **not** shown.
- [ ] **Given** `navigator.doNotTrack` is `'1'` (or GPC is on), **when** the page loads with no stored
      decision, **then** analytics never boots **and** the banner is **not** shown (signal honoured).
- [ ] **Given** the phone controller view (loaded via `?session=123456`), **when** it opens, **then** the
      consent banner is **not** shown and analytics stays no-op (join flow uninterrupted).
- [ ] **Given** consent is absent/declined, **when** any existing `trackEvent(...)` call fires (e.g.
      `game_over`, `share`), **then** it is a **silent no-op** and never throws (regression-guard on the
      `utils.js:46-55` behaviour).
- [ ] The privacy policy is reachable **both** from the banner's "Privacy & data" button **and** from a
      persistent footer/header "Privacy" link after the banner is dismissed.
- [ ] The privacy modal closes via the × button, backdrop click, and `Escape` (parity with the
      leaderboard modal).
- [ ] **Negative:** the privacy policy text **never** displays the 6-digit session code or any PII, and
      **no** `console.log` of the code/PII is introduced (guardrail).
- [ ] The game is fully playable in all three states (accepted / declined / banner ignored) on both
      desktop and phone — no gameplay path is blocked.
- [ ] **eslintrc globals updated:** every new top-level function/`const` in `consent.js` (and any new
      top-level symbol in `config.js`, e.g. `enableAnalytics`, `consentInit`, `setConsent`,
      `CONSENT_KEY`) is added to `.eslintrc.json` `globals`.
- [ ] **`sw.js` `CACHE` bumped** (`snake-shell-v11` → `v12`) **and** the new `js/consent.js` added to
      `SHELL_ASSETS` (`sw.js:8`, `sw.js:10-42`).
- [ ] New `<script src="js/consent.js">` inserted at the **correct load-order position** in
      `index.html` (after `config.js`, before `main.js` — it consumes `analytics`/`firebase` and is read
      by `main.js`). See §7.
- [ ] CI green: **lint** (no new `no-undef`), **`node --check`** syntax pass, **vitest** (incl.
      `tests/protocol.test.js` jsdom smoke test) all pass.
- [ ] Keyboard-accessible: banner buttons and modal are reachable by Tab, show a visible focus ring
      (`--focus-ring` / `--focus-outline`), and `Escape` closes the modal.

## 7. Affected files

| File | Change |
| --- | --- |
| `public/js/consent.js` | **NEW.** `consentInit()`, `setConsent()`, DNT/GPC read, banner + privacy-modal wiring, `CONSENT_KEY`. ≤~120 lines, plain global-scope script. |
| `public/js/config.js` | Extract `firebase.analytics()` (currently `:47-51`) into idempotent `enableAnalytics()`; call `consentInit()` (not analytics) from `initializeFirebase()`. Keep the inner try/catch + offline-mode guarantee. |
| `public/js/main.js` | Move/guard the `device_role` user-property tagging (`:18-23`) so it runs only when analytics is actually enabled (via `enableAnalytics()`), not unconditionally at `detectDevice()`. |
| `public/index.html` | Add `#consent-banner` + `#privacy-modal` markup; add a persistent "Privacy" link in the header social section; insert `<script src="js/consent.js">` **after** `config.js` (`:302`) and **before** `main.js` (`:317`). |
| `public/css/base.css` | Append `.consent-banner` / `.consent-*` styles using existing tokens. (Chosen over a new stylesheet to avoid touching the CSS load order **and** the SW shell list.) |
| `public/js/utils.js` | **No code change** — verify `trackEvent()` no-op behaviour holds; reference only. |
| `.eslintrc.json` | **Globals bump** — add every new top-level symbol (`consentInit`, `setConsent`, `enableAnalytics`, `CONSENT_KEY`, banner/modal helpers). **CI fails otherwise.** |
| `public/sw.js` | **Bump `CACHE`** `v11`→`v12` and add `./js/consent.js` to `SHELL_ASSETS`. |
| `.agent/system/analytics.md` | Update the "No cookie-consent banner is shown" note (`:5-6`) to document the new consent gate + DNT handling + the `consent_update` event. |

## 8. Dependencies & sequencing

- **Depends on:** none. This is self-contained and can land immediately.
- **Unblocks / GATES M2** (analytics-funnel expansion incl. `js_error` telemetry): per the brief,
  more tracking must **not** ship before a consent story exists. M2 should build on this gate (new
  events automatically inherit consent because they all route through the gated `analytics` handle /
  `trackEvent`).
- **Ordering within M-track:** land Q6 → then M2 adds events freely.

## 9. Risks & mitigations

- **Global-scope / load-order minefield (the big one).** `consent.js` consumes `firebase`,
  `analytics`, and `sessionManager`, and is read by `main.js`. **Mitigation:** place the
  `<script>` strictly **after `config.js` and `state.js`** (both define what it reads) and **before
  `main.js`**; declare **every** new top-level symbol in `.eslintrc.json` `globals` (CI's `no-undef`
  is the safety net — that failure is the feature). `enableAnalytics()` must be **idempotent** so the
  "accept" click and a returning-grant boot can't double-init.
- **Breaking the offline-mode guarantee.** The current inner try/catch (`config.js:47-51`) ensures an
  analytics failure never drops the app to localStorage mode. **Mitigation:** preserve that exact
  try/catch inside `enableAnalytics()`; `consentInit()` itself wrapped so it never throws into
  `initializeFirebase()`.
- **Race: analytics enabled before `gtag` runtime ready.** `firebase.analytics()` is synchronous on the
  v8 compat SDK once `firebase-analytics.js` has loaded (it's a `<head>` blocking script at
  `index.html:29`), so by `DOMContentLoaded` it's available. **Mitigation:** guard
  `enableAnalytics()` on `typeof firebase !== 'undefined' && firebase.analytics` and no-op otherwise
  (same defensive shape as `initializeFirebase()`'s `typeof firebase === 'undefined'` retry at
  `config.js:33-37`).
- **DNT is non-standard / removed in some browsers.** Chrome removed the toggle; Safari/Firefox/GPC
  vary. **Mitigation:** read all of `navigator.doNotTrack` / `window.doNotTrack` /
  `navigator.msDoNotTrack` / `navigator.globalPrivacyControl`; absence simply means "no signal → show
  banner". Don't depend on DNT being present.
- **Banner annoyance / re-show loop.** **Mitigation:** persist the decision and show **once**;
  never show on the phone controller; non-modal so it never blocks play.
- **Stale SW serving pre-consent code after deploy.** Network-first SW still needs one reload to update
  an installed client. **Mitigation:** bump `CACHE` to `v12` (in the criteria) so the shell list +
  new `consent.js` refresh cleanly.
- **Over-blocking functional data.** Risk of mistakenly gating Firestore/RTDB. **Mitigation:** scope is
  **analytics-only** — explicit non-goal; the DB transports are untouched.

## 10. Verification / test plan

Given **no local Node** (CI-bound) and a **network-first SW**:

1. **Lint + `node --check` + vitest (CI, blocking).** The globals-list update is verified by lint's
   `no-undef`; `node --check` proves `consent.js` / edited `config.js` parse; vitest incl.
   `tests/protocol.test.js` (jsdom) proves no boot-path regression. Optionally add a tiny **pure unit
   test** for the DNT-normalisation + decision helper (extract it to be `module.exports`-testable like
   `utils.js:73-78` / `logic.js`) so the decision table is covered without a browser.
2. **`python -m http.server` + Claude_Preview (manual, the real proof).** Serve `public/`, **unregister
   the SW and clear caches first** (network-first SW serves stale assets locally), then:
   - First load (desktop, DNT off): assert **no `_ga` cookie** and analytics-boot **not** called
     (DevTools Application → Cookies; a `debugLog` breadcrumb in `enableAnalytics()`).
   - Click **Accept** → assert `_ga` cookies appear, banner hides, `snake_consent === 'granted'`, and a
     `/g/collect` beacon with `en=consent_update` (per the verify recipe in `analytics.md:80-85`).
   - Reload → banner does **not** reappear; analytics boots.
   - Clear `snake_consent`, set `navigator.doNotTrack='1'` (or a DNT-on profile) → reload → no banner,
     no cookies.
   - Click **Decline** (fresh state) → no cookies; reload → no banner.
   - Open `?session=123456` in a second tab → **no banner**, game joins normally.
   - Open the privacy modal from the banner link **and** the header link; close via ×, backdrop, Esc.
3. **No scratch Firebase project needed** — this change touches **no** Firestore/RTDB rules or schema,
   so the rule-emulator path (`firestore.rules` / `database.rules.json`) is **N/A**.

## 11. Analytics & observability

- **`consent_update`** — the only new event. Fired through the existing `trackEvent()`
  (`utils.js:46-55`) **immediately after** `enableAnalytics()` on an explicit **Accept** (so it lands in
  GA4; a "decline" produces no event because analytics never boots — that's correct and expected).
  Params: `{ outcome: 'granted' }` (bounded enum, low-cardinality — guardrail-compliant; **never** the
  session code or PII). Mirrors the GA4-recommended consent-signalling pattern and is segmentable by the
  auto-tagged `device_role`.
- **Optional (M2-adjacent, not required here):** none — keep this change to a single event.
- **Observability:** confirm in **GA4 DebugView / Realtime** (`analytics.md:52-58`) that
  `consent_update` appears only after Accept, and that **no** events arrive from a declined/DNT session
  (the absence of beacons is the test).
- **Doc update:** revise `.agent/system/analytics.md:5-6` (the "no consent banner" note) and add
  `consent_update` to the events table (`:33-47`).
