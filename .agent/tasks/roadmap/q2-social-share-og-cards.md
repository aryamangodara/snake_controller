# Q2 · Social share preview (OG/Twitter cards) + share UTM loop

> **Tier** quick-win · **Focus** Growth · **Impact** High · **Effort** S (hours) · **Priority** 88/100
> **Status** `Not started` · **Depends on** none · **Part of** [Roadmap](./README.md)

## 1. Problem — what we're solving

The phone game-over card's share buttons (WhatsApp / X / Facebook / Instagram) are the product's
core viral loop, but the link that goes out is bare and untagged, so it under-performs on two axes:

1. **No link preview.** `public/index.html` `<head>` (lines 3–72) declares a `<title>`, favicons,
   `theme-color`, and the PWA manifest — but **zero Open Graph or Twitter Card metadata and no
   `<meta name="description">`** (verified: `grep -niE 'og:|twitter:|name="description"'
   public/index.html` → *NONE FOUND*). When a shared URL is unfurled by WhatsApp / X / Facebook /
   iMessage / Slack, those scrapers find no `og:title` / `og:description` / `og:image`, so the link
   renders as a blank-preview URL with no thumbnail. This is especially damaging on **Facebook**,
   whose sharer (`share.js:104-107`) only shares the link and *ignores prefilled text entirely* —
   the OG card is the **only** thing a Facebook recipient sees.

2. **No attribution.** `shareUrl()` in `public/js/share.js:12-14` returns the bare origin:
   ```js
   function shareUrl() {
       return `${location.origin}${location.pathname}`;
   }
   ```
   Every share — WhatsApp (`share.js:99`), X (`:102`), Facebook (`:106`), Instagram (`:109`) —
   carries this untagged URL, so inbound clicks land with **no `utm_source`** and are invisible in
   GA4 Acquisition. We already fire a `share` event (`share.js:88-91`) on the *outbound* click, but
   the *return* trip (someone clicking the shared link) is unattributable, so we can't compute a
   viral coefficient (shares → inbound sessions → new shares).

Both gaps are pure metadata/URL plumbing — no gameplay, sync, or rules logic is touched.

## 2. Why it matters

This is a **Growth** initiative aimed squarely at *pushing for real users*. The share buttons are
the only organic acquisition channel in the app, and right now each share is degraded:

- A link with a rich preview card (title + tagline + snake artwork) gets **materially higher
  click-through** than a blank URL — this is the single highest-leverage change to the existing
  viral loop, at hours of effort.
- Without `utm_source=share`, we are flying blind: we cannot tell how many sessions originate from
  shares, which network converts, or whether the loop is self-sustaining (K-factor > 1). Adding the
  tag closes the funnel so GA4 Acquisition attributes inbound sessions and downstream
  `game_over` / `share` engagement back to the share channel.

Low risk, high return: static `<head>` tags + a one-line URL change, both already exercised by the
existing CI gates and the jsdom protocol smoke test.

## 3. Goals

- Add Open Graph (`og:title`, `og:description`, `og:image`, `og:url`, `og:type`), Twitter Card
  (`twitter:card=summary_large_image`, `twitter:title`, `twitter:description`, `twitter:image`),
  and a `<meta name="description">` to `public/index.html` `<head>`.
- Serve an **absolute, publicly-reachable** `og:image` URL (scrapers do not run JS and reject
  relative paths) pointing at production hosting (`https://go-console-84748.web.app/...`).
- Append `utm_source=share` (and `utm_medium=social`) to the shared URL in `shareUrl()`
  (`share.js:12-14`) **without** breaking the `?session=` deep-link parse used by the controller.
- Make the share funnel measurable end-to-end so a viral-coefficient view is possible in GA4.

## 4. Non-goals

- **No dynamically-rendered, per-score OG image** (e.g. a serverless card that bakes the player's
  score into the image). The site is static Firebase Hosting with no server runtime; a generated
  card is a separate, larger initiative. We ship one static card for all shares.
- **No change to caption text** (`buildShareText`, `share.js:32-43`) or the `share` outbound event
  schema beyond what attribution requires — captions and outcome logic stay as-is.
- **No new GA4 custom event** is strictly required (GA4 auto-parses `utm_*`); the "viral-coefficient
  view" is a GA4 **Explore/report** configuration, documented in §11, not new client code.
- **No cookie-consent / GDPR banner** work (owner choice, per `.agent/system/analytics.md`).
- **No QR / `network.js:262` deep-link change** — that URL already carries `?session=` and is not a
  share link.

## 5. Proposed solution

### 5a. `<head>` metadata (public/index.html)

Add a block after the existing `theme-color` meta (`index.html:20`) and before the manifest link
(`:23`), mirroring the existing tag style. Use the production origin literally because OG scrapers
require absolute URLs:

```html
<!-- SEO + social share preview (Open Graph / Twitter Card) -->
<meta name="description" content="Play Snake on your screen and control it with your phone as a wireless joystick. Pair with a QR code and challenge your friends.">
<meta property="og:type" content="website">
<meta property="og:url" content="https://go-console-84748.web.app/">
<meta property="og:title" content="Snake — your phone is the joystick">
<meta property="og:description" content="Play Snake on the big screen, steer with your phone. Scan a QR code to join. Can you beat the high score?">
<meta property="og:image" content="https://go-console-84748.web.app/snake-logo-512.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Snake — your phone is the joystick">
<meta name="twitter:description" content="Play Snake on the big screen, steer with your phone. Scan a QR code to join.">
<meta name="twitter:image" content="https://go-console-84748.web.app/snake-logo-512.png">
```

**`og:image` choice.** `snake-logo-512.png` already exists (`public/snake-logo-512.png`, verified
512×512, listed in `manifest.json:13` and `sw.js:40`) and is publicly reachable at the production
origin — zero new asset risk. Trade-off: it is **square (512×512)**, not the 1200×630 that
`summary_large_image` ideally wants, so X/Facebook may render it as a smaller square or a centered
crop. Recommended **option B (preferred for impact):** add a dedicated `og-card.png` at **1200×630**
(snake artwork + "Snake — your phone is the joystick" wordmark) under `public/`, reference it as
`https://go-console-84748.web.app/og-card.png`, and register it in `sw.js` `SHELL_ASSETS`. The
description text reuses the tone of the existing `manifest.json:4` description
("Play Snake on your screen and control it with your phone as a wireless joystick.").

> Decision point for the implementer: ship with `snake-logo-512.png` for a zero-asset quick win, OR
> create `og-card.png` (1200×630) for a correct large-summary render. The acceptance criteria cover
> both; pick one and make the four image URLs (`og:image` + `twitter:image`) consistent.

### 5b. UTM on the shared URL (public/js/share.js)

Append UTM params in `shareUrl()` (`share.js:12-14`). The controller reads the session via
`URLSearchParams(...).get('session')` (`controller.js:13`) and `…has('session')` (`main.js:13`), so
extra query params are **ignored by the deep-link parse** — confirmed both call sites key only on
`session`. Keep it a normal query string so each network's `encodeURIComponent` (`share.js:94-99`)
escapes it correctly:

```js
/** Base game URL to share, tagged for attribution (utm_* is ignored by the ?session= parse). */
function shareUrl() {
    const base = `${location.origin}${location.pathname}`;
    const params = new URLSearchParams({ utm_source: 'share', utm_medium: 'social' });
    return `${base}?${params.toString()}`;
}
```

This is a **pure modification of an existing exported function** — `shareUrl` is already declared in
`.eslintrc.json` globals (`:200`) and already exported for Vitest (`share.js:135`). **No new
top-level declaration is introduced**, so the hand-maintained globals list does **not** need a new
entry (guardrail satisfied without edit). The unit test in §10 pins the new behavior.

**Both transports / both modes:** the share card is identical for solo and multiplayer (the buttons
in `index.html:288-291` are mode-agnostic; `openShare`/`shareUrl` don't branch on
`gameState.mode`), and the share URL is network-independent of the Firebase-vs-localStorage
transport split, so this one change covers all four code paths with no fork.

## 6. Acceptance criteria

- [ ] **Given** the production page source, **when** scraped, **then** `<head>` contains
      `og:title`, `og:description`, `og:image`, `og:url`, `og:type=website`,
      `twitter:card=summary_large_image`, `twitter:title`, `twitter:description`, `twitter:image`,
      and `<meta name="description">`.
- [ ] **Given** the `og:image` / `twitter:image` values, **then** each is an **absolute** URL
      (`https://…`), not a relative path, and resolves to a real PNG at the production origin
      (`snake-logo-512.png`, or the new `og-card.png` if option B).
- [ ] **Given** `og:url`, **then** it equals the canonical production origin
      `https://go-console-84748.web.app/` (no `?session=`, no UTM).
- [ ] **Given** the live page in Facebook's Sharing Debugger and X/Twitter's card validator (or
      `curl -A 'facebookexternalhit'`), **then** a title + description + image preview renders with
      no "missing og:image" / "missing required property" warnings.
- [ ] **Given** a share click for **any** network, **when** `shareUrl()` runs, **then** the URL
      contains `utm_source=share` (and `utm_medium=social`).
- [ ] **Given** a shared URL with UTM, **when** opened on a phone as `?session=123456&utm_source=share`,
      **then** the controller still parses the session (`controller.js:13` `get('session')` returns
      `123456`) and connects normally — the UTM params do **not** break the deep link.
- [ ] **Negative:** `shareUrl()` must **not** include any `session` value, the 6-digit code, or any
      PII in the query string (it returns the bare origin + UTM only).
- [ ] **Negative:** Facebook receives a working preview **even though** its sharer ignores prefilled
      text (`share.js:104-107`) — i.e. the card carries the message on its own.
- [ ] Vitest unit test added/updated asserting `shareUrl()` returns a URL whose parsed
      `searchParams` has `utm_source === 'share'` and **no** `session` key; **`npm test` green**.
- [ ] **`npm run lint` exits 0** with no new `no-undef` errors (no new global introduced;
      `.eslintrc.json` unchanged for this reason).
- [ ] **`node --check public/js/share.js` passes** (CI syntax gate).
- [ ] **`sw.js` `CACHE` bumped** from `snake-shell-v11` (`sw.js:8`) to `v12` because `index.html`
      (a shell asset, `sw.js:11`) changed — and **if** `og-card.png` was added, it is appended to
      `SHELL_ASSETS` (`sw.js:10-42`).
- [ ] **No new analytics PII:** the existing `share` event params (`method`, `content_type`,
      `share.js:88-91`) are unchanged; the session code is never logged.

## 7. Affected files

| File | Change |
| --- | --- |
| `public/index.html` | Add OG / Twitter Card / `<meta name="description">` block in `<head>` (after `:20`, before `:23`). Static markup only. |
| `public/js/share.js` | Modify `shareUrl()` (`:12-14`) to append `utm_source=share&utm_medium=social`. No new global. |
| `public/sw.js` | **Bump `CACHE`** `snake-shell-v11` → `v12` (`:8`) because `index.html` changed. If option B, **add `./og-card.png`** to `SHELL_ASSETS` (`:38-41`). |
| `public/og-card.png` *(NEW, option B only)* | 1200×630 social card image. Skip if shipping with `snake-logo-512.png`. |
| `tests/protocol.test.js` *or new* `tests/share.test.js` | Add/extend a unit test pinning `shareUrl()` UTM output and absence of `session`. |
| `.agent/system/analytics.md` | Doc note: shares now carry `utm_source=share`; add the viral-coefficient report recipe (§11). |

**Guardrail flags:** `.eslintrc.json` globals list — **no bump needed** (no new top-level decl).
`sw.js` `CACHE` — **bump required**.

## 8. Dependencies & sequencing

- **Depends on:** none.
- **Ordering:** independent quick win; can land before or after any other roadmap item.
- **One coupling:** the `og:image` / `twitter:image` URLs and `og:url` hard-code the production
  origin `https://go-console-84748.web.app/`. If the project is ever rehosted to a custom domain,
  these absolute URLs must be updated in lockstep (note this in the meta block comment).
- If option B, create `og-card.png` **before** referencing it in `sw.js` so the SW `cache.addAll`
  (`sw.js:46-48`) doesn't fail the install on a missing asset.

## 9. Risks & mitigations

| Risk | Mitigation |
| --- | --- |
| `og:image` relative or pointing at a non-existent file → blank preview persists. | Use the **absolute** production URL of an asset that already ships (`snake-logo-512.png`, verified in `sw.js:40` / `manifest.json:13`); validate with Facebook Debugger + X validator post-deploy. |
| `summary_large_image` with a 512×512 square renders cropped/small on X & FB. | Prefer option B (1200×630 `og-card.png`); the 512 path is the acceptable zero-asset fallback. |
| UTM params break the `?session=` deep link. | Verified both parse sites (`controller.js:13`, `main.js:13`) key only on `session`; UTM is additive. Covered by a Vitest assertion and a manual `?session=…&utm_source=share` connect test. |
| Stale OG card cached by a network's scraper after a change. | Re-scrape via Facebook Sharing Debugger ("Scrape Again"); for the in-app SW, the `CACHE` bump forces a fresh `index.html`. |
| Service worker serves a stale `index.html` so new meta doesn't appear locally. | SW is network-first (`sw.js:60-89`); after a deploy one reload refreshes. For local verify, **unregister the SW + clear caches** (per project memory). |
| og:image asset not yet propagated to hosting at first scrape. | Deploy ships static assets via CI (`firebase deploy --only hosting`); validate **after** the deploy completes, not against a local preview origin. |

## 10. Verification / test plan

No local Node — iteration is CI-bound. Prove correctness via the existing gates plus targeted checks:

1. **Vitest (logic, runs in CI):** add/extend a test importing `shareUrl` from `share.js` (already
   exported at `share.js:135`). Assert, using a jsdom/`location` stub matching the protocol test's
   url setup (`tests/protocol.test.js:33`):
   - `new URL(shareUrl()).searchParams.get('utm_source') === 'share'`
   - `new URL(shareUrl()).searchParams.get('utm_medium') === 'social'`
   - `new URL(shareUrl()).searchParams.has('session') === false`
   - the path/origin equals `location.origin + location.pathname`.
   Run via `npm test` in CI.
2. **Lint:** `npm run lint` must exit 0; confirm no `no-undef` (no new global) and `shareUrl` is
   still the only declaration (no rename).
3. **Syntax gate:** `node --check public/js/share.js` (CI runs this on all `public/js/*`).
4. **Local visual / markup check (python http.server + Claude_Preview):** serve `public/`
   (`python -m http.server`), **unregister the SW and clear caches first**, then `eval`
   `document.querySelector('meta[property="og:image"]').content` and
   `document.querySelector('meta[name="twitter:card"]').content` to confirm the tags are present and
   absolute. Screenshots time out — use DOM `eval`, not screenshots.
5. **Deep-link regression:** load `?session=123456&utm_source=share` locally and confirm the
   controller view initializes with the code prefilled (`controller.js:18-23`) — UTM didn't break it.
6. **Post-deploy social validation (the real proof, needs the live origin):**
   - **Facebook Sharing Debugger** (`developers.facebook.com/tools/debug/`) → enter the prod URL →
     "Scrape Again" → confirm title/description/image, zero errors.
   - **X Card validator** / post-preview → confirm `summary_large_image` renders.
   - `curl -A 'facebookexternalhit/1.1' https://go-console-84748.web.app/ | grep -i 'og:image'`.
   - Paste the prod URL into WhatsApp/iMessage to confirm the unfurl card.
   No Firebase rules change → **no emulator / scratch project needed** for this item.

## 11. Analytics & observability

- **No new client event required.** GA4 auto-parses `utm_source` / `utm_medium` from the landing URL
  (per `.agent/system/analytics.md:60-72`), so inbound share clicks now attribute to
  `source = share`, `medium = social` with zero code. The existing **outbound** `share` event
  (`share.js:88-91`, `method` + `content_type`) is unchanged and routed through the hardened
  `trackEvent()` (`utils.js`), which no-ops offline and never logs the session code.
- **Viral-coefficient view (GA4 Explore / report config, no code):**
  1. **Outbound shares** = count of the `share` event (already firing).
  2. **Inbound share sessions** = sessions where `session_source = share` (or
     `first_user_source = share`) — a Free-form Explore segmented by the UTM source dimension.
  3. **K ≈ (inbound share sessions × share rate of those users) / shares**, i.e. inbound sessions
     per outbound share, optionally multiplied by the downstream `share` rate. Track the ratio over
     time to see if the loop is self-sustaining.
  4. Segment by `method` (whatsapp / x / facebook / instagram) on the outbound `share` event to find
     the highest-converting network.
- **Add to `.agent/system/analytics.md`:** a one-line note that shared links carry
  `utm_source=share&utm_medium=social`, plus the K-factor recipe above, so the report is
  reproducible.
- **Guardrail:** UTM values are static low-cardinality strings (`share` / `social`); they carry **no
  PII and never the 6-digit code** (the code lives only in `?session=`, which `shareUrl()` omits).
