# M10 · Service-worker update UX + PWA install/manifest polish

> **Tier** medium · **Focus** Growth / Polish · **Impact** Medium · **Effort** M · **Priority** 56/100
> **Status** `Not started` · **Depends on** none (needs maskable + 180×180 + 1200×630 assets) · **Part of** [Roadmap](./README.md)

## 1. Problem — what we're solving

Three related PWA gaps leave the app shipping stale code, under-converting installs, and looking unpolished when installed.

**A. No update signal — already-loaded tabs run stale code after a deploy.**
`public/sw.js` correctly does `self.skipWaiting()` (`public/sw.js:48`) and `self.clients.claim()` (`public/sw.js:56`), and the fetch handler is network-first (`public/sw.js:72-89`) so a *fresh navigation* gets fresh code. But the registration in `public/index.html:352-357` attaches **no** update listeners — it is a bare `navigator.serviceWorker.register('sw.js').catch(...)`. So a tab that is **already open** when a new SW activates keeps running the old in-memory JS until the user manually reloads. In this app that is not cosmetic: it is a **two-device live game**. A desktop host left open on version *N* while the phone controller (opened later, or after a reload) loads version *N+1* can desync the joystick protocol / multiplayer sync with **no signal to either player**. The protocol smoke test (`tests/protocol.test.js`) exercises exactly this desktop↔controller contract, underscoring how version skew across the two roles breaks sync.

**B. The install funnel rarely fires — `beforeinstallprompt` is never captured.**
`public/index.html:360-362` listens for `beforeinstallprompt` and fires `trackEvent('pwa_install', { outcome: 'prompted' })`, but it **never calls `preventDefault()` and never stashes the event**. So the browser shows (or suppresses) its own mini-infobar on its own schedule, there is **no custom "Install app" CTA**, and `appinstalled` (`public/index.html:363-365`) seldom fires because nothing drives the prompt. The analytics doc (`.agent/system/analytics.md:46`) lists only `outcome: prompted | installed` — we never record the user's **accepted vs dismissed** choice, so the funnel is blind at its most important step.

**C. Manifest + iOS metadata are thin — Android clips icons, iOS uses a generic chrome.**
`public/manifest.json:11-16` declares four icons, **all `purpose: "any"`** — there is **no `maskable` icon**, so Android adaptive-icon launchers clip or letterbox the logo. The manifest also lacks `id`, `lang`, `categories`, `screenshots`, and `shortcuts`. On iOS, `public/index.html:19` sets a single `apple-touch-icon` pointing at the 120×120 `snake-logo.png` (no 180×180), and there are **zero** `apple-mobile-web-app-*` metas (verified: `grep -c apple-mobile-web-app public/index.html` → `0`), so an iOS home-screen launch gets a generic title bar and status-bar style instead of a standalone, branded shell.

## 2. Why it matters

This is a **growth + polish** initiative aimed squarely at "pushing for real users":

- **Reliability for the core two-device loop.** An "Update available — Reload" banner turns silent version skew into a one-tap fix, protecting the headline experience (desktop board + phone joystick) from the most confusing failure mode there is: "it just stopped responding" with no error.
- **Install conversion.** A real, styled install CTA wired to the captured `beforeinstallprompt` is the single highest-leverage growth lever in a PWA — it moves users from a throwaway tab to an installed icon (repeat sessions, offline shell, no URL to retype). Recording accepted/dismissed finally makes the install funnel measurable in GA4.
- **First-impression polish.** A maskable icon (clean Android adaptive icon), a 180×180 apple-touch-icon, `apple-mobile-web-app-*` metas, and manifest `shortcuts`/`screenshots` make the installed app look intentional on both platforms and unlock the Android "richer install UI" + app-shortcut long-press menu.

## 3. Goals

- An already-open tab is **notified** when a newer SW has installed, via a non-blocking "Update available — Reload" banner, and reloading once loads the fresh code.
- The reload path is **loop-safe**: a single `controllerchange` triggers exactly one reload, never a refresh loop.
- `beforeinstallprompt` is captured (`preventDefault` + stashed); a styled **"Install app"** button appears only when installable, calls `prompt()`, and logs the **real** `accepted` / `dismissed` outcome.
- The manifest ships a **maskable 512 icon** plus `id`, `lang`, `categories`, `shortcuts`, and `screenshots`; iOS gets a **180×180** `apple-touch-icon` and `apple-mobile-web-app-*` metas.
- New assets are added to `SHELL_ASSETS` and `CACHE` is **bumped** in `public/sw.js` so installed clients pick up the new shell.
- `lint` + `node --check` + `vitest` stay green; the existing `tests/protocol.test.js` still passes unchanged.

## 4. Non-goals

- **No** auto-reload without user consent (would interrupt a live game / lose desktop state) — the banner requires an explicit tap.
- **No** change to the network-first fetch strategy or the offline-fallback logic in `public/sw.js:60-90`.
- **No** new build step, bundler, or ES modules — the global-scope `<script>` model (`public/index.html:300-317`) is preserved.
- **No** cross-device version-negotiation handshake over Firestore/RTDB (detecting and refusing to pair mismatched versions). That is a larger protocol change; this spec only surfaces the update locally so each device can refresh itself.
- **No** redesign of the install button placement beyond a minimal, on-brand CTA; **no** iOS "add to home screen" custom tutorial (iOS Safari has no `beforeinstallprompt`).
- **Asset *authoring*** (drawing the maskable PNG with safe-zone padding, the 180×180, and the 1200×630 screenshot) is a prerequisite input, not code work — see §8.

## 5. Proposed solution

All JS lives in the **existing inline `<script>` blocks at the bottom of `public/index.html`** (the SW-register block at `:351-366` and, if needed, the reveal block above it) so we do **not** add a new file to the global-scope load order or the `.eslintrc.json` globals list. Helpers stay inside these IIFE-style inline blocks (function-scoped, not new top-level globals), so `no-undef` is unaffected.

### A. Update banner (in the SW-register inline block)

Extend the existing registration (`public/index.html:352-357`) to keep the `registration` and wire update detection:

```text
register('sw.js').then((reg) => {
  reg.addEventListener('updatefound', () => {
    const sw = reg.installing;
    sw.addEventListener('statechange', () => {
      // A waiting/installed worker WITH an active controller == an update (not first install).
      if (sw.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner();
    });
  });
})
```

- `showUpdateBanner()` injects a fixed banner styled with the **existing `.toast` token pattern** (`public/css/mobile.css:436-459`) — reuse `--color-surface`, `--shadow-lg`, `--radius-full`, `--space-*`, `--ease-standard` — but with a **Reload** action button. Prefer a new `.toast--action` modifier (or a sibling `#sw-update-banner`) so we do not regress the auto-hiding share toast. Banner is **role-agnostic** (desktop host and phone controller both get it).
- **Reload-loop guard:** add a module-scoped `let refreshing = false;` and a one-time `navigator.serviceWorker.addEventListener('controllerchange', ...)` that reloads once (`if (!refreshing) { refreshing = true; location.reload(); }`). The Reload button triggers the new SW (either `location.reload()` directly, or `reg.waiting.postMessage(...)` + a `skipWaiting` message handler in `sw.js` — but since `sw.js` **already** calls `skipWaiting()` unconditionally on install (`public/sw.js:48`), the simplest correct path is: button → `location.reload()`; the already-activated SW serves fresh code). Document which path is chosen in the PR.

### B. Install CTA (in the same inline block)

- Replace the fire-and-forget `beforeinstallprompt` handler (`public/index.html:360-362`) with one that calls `e.preventDefault()`, stashes `deferredPrompt = e`, reveals a styled **"Install app"** button (hidden by default in markup), and still fires `trackEvent('pwa_install', { outcome: 'prompted' })`.
- On button click: `deferredPrompt.prompt()`, await `deferredPrompt.userChoice`, then `trackEvent('pwa_install', { outcome: choice.outcome })` where `outcome ∈ { accepted, dismissed }`; null out `deferredPrompt` and hide the button (a prompt can be used only once).
- Keep the existing `appinstalled` listener (`public/index.html:363-365`) firing `outcome: 'installed'`, and hide the button there too.
- Route **all** install/update analytics through `trackEvent()` (`public/js/utils.js:46-55`) — never `analytics.logEvent` directly — so it no-ops offline and never throws into gameplay. Params stay low-cardinality enums; **never** log the 6-digit code or any PII.
- The CTA markup is a single `<button id="install-btn" hidden>` placed in the desktop header `social-section` (`public/index.html:106-119`, alongside `#mute-btn` / `#leaderboard-btn`, reusing `.social-link`) or near the mobile connection card — pick the desktop header to match the install surface that matters most; keep it `hidden` until `beforeinstallprompt` fires.

### C. Manifest + iOS metadata (`public/manifest.json` + `public/index.html` head)

- **manifest.json** (`public/manifest.json:11-16`): add a maskable icon entry, e.g. `{ "src": "snake-logo-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }` **only if** the existing 512 was authored with adaptive-icon safe-zone padding; otherwise add a **new** `snake-maskable-512.png` and reference that. Keep the existing `purpose: "any"` entries (a separate `maskable` entry is the spec-correct way; do not just relabel `any` → `maskable` unless the art has the ~20% safe-zone margin). Add top-level `"id": "/"` (or `"./"` to match `start_url`), `"lang": "en"`, `"categories": ["games", "entertainment"]`, a `"shortcuts"` array (e.g. "Play" → `./`), and a `"screenshots"` array (the 1200×630 asset, `form_factor: "wide"`, for the Android richer install UI).
- **index.html head** (`public/index.html:16-20`): add `<link rel="apple-touch-icon" sizes="180x180" href="snake-touch-180.png">` (new 180×180 asset), and the iOS standalone metas: `<meta name="apple-mobile-web-app-capable" content="yes">`, `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">`, `<meta name="apple-mobile-web-app-title" content="Snake">` (plus the modern `<meta name="mobile-web-app-capable" content="yes">`). Keep the existing 120×120 `apple-touch-icon` (`:19`) as a smaller-device fallback or replace per art guidance.

### D. sw.js shell + cache bump (`public/sw.js`)

- Add every **new** asset (maskable PNG, `snake-touch-180.png`, the screenshot PNG) to `SHELL_ASSETS` (`public/sw.js:10-42`).
- **Bump `const CACHE`** from `'snake-shell-v11'` (`public/sw.js:8`) to `'snake-shell-v12'` so the `activate` cleanup (`public/sw.js:52-58`) evicts the old cache and installed clients fetch the new shell. This is mandatory per CLAUDE.md whenever shell assets change.
- `cache.addAll(SHELL_ASSETS)` (`public/sw.js:47`) is **atomic** — a 404 on any one URL rejects the whole install, so the new asset files **must exist** before this lands (see §8 / §9).

**Both-transports / both-modes note:** This change is in the static shell + analytics only. It does **not** touch the Firestore/RTDB sync, the localStorage fallback, the solo engine (`public/js/game.js`), or the multiplayer arena (`public/js/mp-*.js`). The update banner is intentionally **role-agnostic** so the desktop host and the phone controller can each self-refresh, which is the closest local mitigation to cross-device version skew.

## 6. Acceptance criteria

**Update banner**
- [ ] Given a tab already open on the live app, When a new `sw.js` deploys and its worker reaches `state === 'installed'` while `navigator.serviceWorker.controller` is set, Then a non-blocking "Update available — Reload" banner appears.
- [ ] Given the very first visit (no existing controller), When the SW installs, Then **no** banner is shown (the `navigator.serviceWorker.controller` check suppresses the first-install false positive).
- [ ] Given the banner is shown, When the user taps **Reload**, Then the page reloads once and runs the new code, and a `controllerchange`-driven reload does **not** fire a second time (verify the `let refreshing` guard prevents a refresh loop).
- [ ] The banner is reused/styled from the existing `.toast` token set (`--color-surface`, `--shadow-lg`, `--radius-full`) and does **not** regress the auto-hiding share toast (`showToast`, `public/js/share.js:46`).
- [ ] The banner appears for **both** roles (desktop host and phone controller) — no `sessionManager.isDesktop` gating.

**Install CTA**
- [ ] Given a Chromium browser that fires `beforeinstallprompt`, When it fires, Then `preventDefault()` is called, the event is stashed, the `#install-btn` becomes visible, and `trackEvent('pwa_install', { outcome: 'prompted' })` fires.
- [ ] Given the install button is visible, When the user clicks it and accepts, Then `trackEvent('pwa_install', { outcome: 'accepted' })` fires; When the user dismisses, Then `trackEvent('pwa_install', { outcome: 'dismissed' })` fires.
- [ ] After a prompt is consumed (or `appinstalled` fires), the stashed event is nulled and `#install-btn` is hidden (cannot be re-prompted).
- [ ] Given a browser that never fires `beforeinstallprompt` (iOS Safari, already-installed), Then `#install-btn` stays `hidden` and nothing throws.

**Manifest / iOS**
- [ ] `public/manifest.json` contains at least one icon with `"purpose": "maskable"` at 512×512 referencing a safe-zone-padded asset, **and** retains an `"any"` 512 icon.
- [ ] `public/manifest.json` declares `id`, `lang`, `categories`, `shortcuts` (≥1 entry), and `screenshots` (≥1 entry), and remains valid JSON (parses; `node --check`-equivalent sanity).
- [ ] `public/index.html` head includes a 180×180 `apple-touch-icon` and `apple-mobile-web-app-capable` + `apple-mobile-web-app-status-bar-style` + `apple-mobile-web-app-title` metas (`grep -c apple-mobile-web-app public/index.html` ≥ 2).

**Guardrails**
- [ ] Every new analytics call goes through `trackEvent()` (`public/js/utils.js:46`); **no** raw `analytics.logEvent`; **no** 6-digit code or PII in any param; params are bounded enums/numbers.
- [ ] No new top-level global is introduced in `public/js/*` (logic lives in the inline IIFE blocks), so **`.eslintrc.json` globals needs no change**; if any helper is hoisted to a file-level global, the globals list **is** updated in the same commit.
- [ ] `public/sw.js` `CACHE` is bumped to a new value (e.g. `snake-shell-v12`) **and** every new asset path is added to `SHELL_ASSETS`.
- [ ] All referenced new asset files exist in `public/` before merge (so `cache.addAll` does not reject install).
- [ ] CI is green: `npm run lint` (no new errors), `node --check` on `public/js/*.js` + `public/*.js` (includes `sw.js`), and `npm test` (Vitest, incl. `tests/protocol.test.js` unchanged).

## 7. Affected files

| File | Change |
| --- | --- |
| `public/index.html` | Extend SW-register inline block (`:352-357`) with `updatefound`/`statechange` listener + reload-loop guard; rewrite `beforeinstallprompt` handler (`:360-362`) to `preventDefault`+stash+reveal CTA + log accepted/dismissed; add `#install-btn` markup (header `social-section`, `:106-119`); add 180×180 `apple-touch-icon` + `apple-mobile-web-app-*` metas (head, `:16-20`). |
| `public/manifest.json` | Add maskable 512 icon; add `id`, `lang`, `categories`, `shortcuts`, `screenshots` (`:11-16`). |
| `public/sw.js` | Add new assets to `SHELL_ASSETS` (`:10-42`); **bump `CACHE` → `snake-shell-v12`** (`:8`). |
| `public/css/mobile.css` (or `base.css`) | Add `.toast--action`/update-banner + `#install-btn` styling, reusing existing toast tokens (`:436-459`). |
| `public/snake-maskable-512.png` | **NEW** — 512×512 maskable icon with adaptive-icon safe-zone padding (asset input). |
| `public/snake-touch-180.png` | **NEW** — 180×180 iOS apple-touch-icon (asset input). |
| `public/snake-screenshot-1200x630.png` | **NEW** — wide screenshot for manifest `screenshots` / Android richer install UI (asset input). |
| `.agent/system/analytics.md` | Update the `pwa_install` row (`:46`) to document the `accepted | dismissed` outcomes. |

> **Flags:** `sw.js` `CACHE` **MUST** be bumped. `.eslintrc.json` globals: **no change** if helpers stay inline-scoped (verify — only bump if a top-level decl is added). New binary assets must be committed before merge.

## 8. Dependencies & sequencing

- **Hard prerequisite (asset authoring):** the three new PNGs (maskable-512 with ~20% safe-zone padding, apple-touch-180, screenshot-1200×630) must be created and committed **before or with** the code, because `cache.addAll(SHELL_ASSETS)` (`public/sw.js:47`) is atomic and the manifest/`<link>`/`<meta>` references must resolve. If the existing `snake-logo-512.png` already has adaptive safe-zone margins, the maskable asset can reuse it (relabel via a second icon entry) and that prerequisite drops.
- **No code dependency** on other roadmap items; this is self-contained shell + analytics work.
- **Unblocks:** measurable install funnel (accepted/dismissed) for growth experiments, and the cleanest local mitigation for the cross-device version-skew problem ahead of any future Firestore-level version handshake.

## 9. Risks & mitigations

- **Reload loop (the classic SW footgun).** A naive "reload on `controllerchange`" loops forever. **Mitigation:** module-scoped `let refreshing = false;` gating a single `location.reload()`; reload is user-initiated via the banner, not automatic. Covered by an acceptance criterion.
- **First-install false positive.** Without the `navigator.serviceWorker.controller` truthiness check, the banner shows on the very first visit. **Mitigation:** only show when `state === 'installed' && controller` is set; explicit negative acceptance criterion.
- **Atomic `addAll` install failure.** A missing/misnamed new asset rejects the whole SW install, breaking offline for everyone on the new shell. **Mitigation:** commit assets first; double-check exact filenames match `SHELL_ASSETS`, manifest, and `<link>`; verify under `python -m http.server`.
- **Global-scope / load-order minefield.** Adding a stray top-level `const`/function in an inline block that collides with a global, or hoisting a helper to file scope without updating `.eslintrc.json`, breaks `no-undef`/`no-redeclare` and fails CI. **Mitigation:** keep all new logic **inside** the existing inline `<script>` IIFE scope; reuse `trackEvent` rather than redeclaring; run lint in CI (it's blocking).
- **Maskable mislabeling.** Relabeling a non-padded `any` icon as `maskable` makes Android crop the logo's edges. **Mitigation:** author a dedicated padded maskable PNG (or confirm the existing 512 has safe-zone margins) and preview in Chrome DevTools → Application → Manifest.
- **Stale SW during local verification.** The network-first SW can still serve a stale shell locally. **Mitigation:** unregister the SW + clear caches (DevTools → Application) before each verification pass, per CLAUDE.md.
- **Banner regressing the share toast.** Reusing `.toast` could collide with `showToast`'s auto-hide (`public/js/share.js:46-57`). **Mitigation:** use a distinct id/`.toast--action` modifier with no auto-hide timer for the update banner.

## 10. Verification / test plan

Given **no local Node** and a **CI-bound** loop, prove correctness as follows:

- **`node --check` (CI, blocking):** runs over `public/js/*.js` and `public/*.js` per `.github/workflows/deploy.yml:42`, so the **`sw.js` edit is syntax-checked**. ⚠️ Note: the **inline `<script>` in `index.html` is NOT** covered by `node --check` (only standalone `.js` files are) — so the install/update JS must be eyeballed carefully and exercised in a real browser. The workflow's `grep -q "<!DOCTYPE"` HTML sanity (`:46`) still runs.
- **`npm run lint` (CI, blocking):** confirms no new `no-undef`/`no-redeclare`. Critical because all new code rides the global scope; verifies we did **not** need to touch `.eslintrc.json` (or that we did, consistently).
- **`npm test` / Vitest (CI, blocking):** the existing suites (`tests/logic.test.js`, `tests/utils.test.js`, `tests/protocol.test.js`) must stay green **unmodified** — proof we didn't disturb the desktop↔controller protocol. `manifest.json` is plain JSON; a tiny optional Vitest could `JSON.parse(readFileSync('public/manifest.json'))` and assert a `maskable` icon + `id`/`categories`/`shortcuts`/`screenshots` exist (mirrors the `protocol.test.js` file-read pattern) — low-cost regression insurance for the manifest shape.
- **`python -m http.server` + Claude_Preview (manual, screenshots time out → use `preview_eval`/`preview_snapshot`):**
  - Unregister the SW + clear caches first.
  - `eval`: `navigator.serviceWorker.getRegistration()` resolves; manifest parses (`fetch('manifest.json').then(r=>r.json())`) and shows the new fields.
  - Simulate update: edit a shell file, bump `CACHE`, reload twice; assert the banner DOM (`#sw-update-banner`) appears on the second load and a single tap reloads without looping (watch `performance.navigation`/a console marker).
  - Install CTA: in Chromium, confirm `#install-btn` un-hides after `beforeinstallprompt` (can be simulated by dispatching the event in `eval` to exercise the handler), and that clicking calls `prompt()` (stub) and logs the outcome via a `trackEvent` spy.
  - DevTools → Application → Manifest: maskable icon renders inside the safe-zone circle; shortcuts/screenshots listed.
- **Analytics spot-check:** with analytics available, watch `google-analytics.com/g/collect` for `en=pwa_install` carrying `ep.outcome=accepted|dismissed|prompted|installed` and `ep.device_role` (`.agent/system/analytics.md:80-86`). Confirm `trackEvent` no-ops cleanly with an ad-blocker on (no thrown errors in console).
- **Scratch Firebase project:** **not required** — this change touches no Firestore/RTDB rules. Production deploy ships only static shell + manifest changes via the normal master push.

## 11. Analytics & observability

All via `trackEvent()` (`public/js/utils.js:46`), low-cardinality params, auto-tagged `device_role`:

- **`pwa_install`** — extend the existing event's `outcome` enum from `{ prompted, installed }` to `{ prompted, accepted, dismissed, installed }` (record the real `userChoice.outcome`). Update the table in `.agent/system/analytics.md:46`.
- **`pwa_update`** *(new, optional but recommended)* — `action` ∈ `{ shown, reloaded }` to measure how often the update banner appears vs. how often users actually reload (the version-skew exposure metric). If added, declare it in `.agent/system/analytics.md` and keep params bounded enums only.
- **Funnel to watch in GA4:** `pwa_install:prompted` → `accepted` → `appinstalled` conversion rate, segmented by `device_role` (desktop hosts vs phone controllers convert very differently); `pwa_update:shown` vs `reloaded` to quantify stale-tab exposure.
- **Guardrail:** no session code, no PII, never call `analytics.logEvent` directly; analytics failure must never throw into gameplay (the `trackEvent` try/catch already guarantees this).
