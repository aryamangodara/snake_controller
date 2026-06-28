# Analytics (Google Analytics 4)

The game uses **Firebase Analytics (GA4)** to understand the audience and attribute marketing
campaigns. GA4 property/measurement ID: **`G-0DFSB38H21`** (already in `firebaseConfig`,
`public/js/config.js`).

**Analytics is OPT-IN and consent-gated** (`public/js/consent.js`). GA4 (`firebase.analytics()`)
is **never** initialized — no `_ga*` cookies, no `gtag` runtime — until the visitor accepts. The
decision logic (`consentInit()`):

- **Do-Not-Track / GPC honoured:** if `navigator.doNotTrack` / `window.doNotTrack` /
  `navigator.msDoNotTrack` is on, or `navigator.globalPrivacyControl === true`, analytics never
  boots and no banner is shown.
- A returning visitor's choice is persisted in `localStorage['snake_consent']`
  (`'granted'` | `'denied'`) and the banner shows **once**.
- The **desktop host** sees a non-modal consent banner (Accept / Decline + a "Privacy & data"
  link). The **phone controller** never sees it (it arrives mid-join via `?session=`) and stays
  no-op. A persistent shield "Privacy" button in the header opens the same policy modal after the
  banner is dismissed.
- On **Accept** → `enableAnalytics()` (the only `firebase.analytics()` call site) boots GA4 and a
  single `consent_update` event fires. On **Decline / DNT** → analytics never boots and
  `trackEvent()` stays a silent no-op.

## How it's wired

- `public/index.html` `<head>` loads `firebase-analytics.js` (v8 compat, **8.10.1** — must match the
  other Firebase tags).
- `public/js/config.js` creates a **guarded** `analytics` handle in its own `try/catch`, so an
  analytics failure (ad-block, unsupported env) never falls into the DB-init catch and drops the app
  into offline mode.
- `public/js/utils.js` exposes the single entry point:

  ```js
  trackEvent(name, params)   // no-ops if analytics is absent; never throws into gameplay;
                             // auto-tags device_role = 'desktop_host' | 'phone_controller'
  ```

- `public/js/config.js` (`enableAnalytics()`) sets `device_role` as a GA4 **user property**
  post-consent (segments sessions by role); `player_tier` is set alongside it per finished round
  via `recordRoundAndTier()` (`utils.js`). See "User properties & North-Star Metric" below.

**Guardrails:** analytics must never break gameplay (every call is wrapped + no-ops on failure), and
**no PII / no 6-digit session code** is ever logged — params are low-cardinality (numbers / bounded
enums) only.

## Events

GA4 **automatically** collects `page_view`, `session_start`, `first_visit`, device/geo/language, and
acquisition (referrer + `utm_*`). On top of that we fire custom events:

| Event | Params | Fired in |
| --- | --- | --- |
| `session_created` | `connection` (`hybrid`\|`localStorage`) | `network.js` `generateNewSession()` |
| `controller_arrival` | `method` (`qr`\|`manual_code`) | `controller.js` `initializeMobileController()` |
| `controller_connected` | `side` (`desktop`\|`phone`) | `network.js` listener (once-guarded) + `controller.js` |
| `controller_connect_failed` | `reason` (`not_found`\|`firebase_unreachable`\|`ls_not_found`\|`post_lookup` — frozen `CONNECT_FAIL_REASONS` enum) | `controller.js` connect-path failure branches |
| `controller_never_connected` | `arrival` (`qr`\|`manual_code`) | `controller.js` — 60s timer armed when a controller view opens; cleared on ANY successful connect (`markControllerConnected`) so it never fires after a real pairing. Measures the created-but-never-paired drop-off. |
| `offline_fallback` | `side` (`desktop`\|`phone`) | `network.js` hybrid-setup catch (desktop) / `controller.js` Firebase-unreachable fallback (phone). Captures the post-hoc Firebase→localStorage degradation that `session_created` (chosen at create time) can miss. |
| `game_start` | `mode` (`solo`\|`multi`), `players` (int) | `game.js` `startGame()` (solo) + `mp-engine.js` `startMultiplayerGame()` (multi). **Unified** — `mp_game_start` retired. |
| `game_restart` | — | `game.js` `restartGame()` (covers desktop + phone "Play Again") |
| `game_over` | `mode`, `players` (int), `duration_s` (int), `food_eaten` (int), `max_combo` (int peak); solo adds `score`, `is_high_score` (bool); multi adds `winner_score` (int) | `game.js` `gameOver()` (solo) + `mp-engine.js` `endMultiplayerGame()` (multi). **Unified** — `mp_game_over` retired. `max_combo` is a per-round PEAK (survives the `combo = 0` reset); MP `food_eaten` is the round-level total. |
| `round_completed` | `mode`, `players` (int), `duration_s` (int) | `game.js` `gameOver()` + `mp-engine.js` `endMultiplayerGame()`. The **stable NSM signal**, decoupled from any future `game_over` param churn. |
| `rematch_prompt` | `mode` (`solo`\|`multi`) | `controller.js` `updateMobileGameOver()` — fired once per loss on the same `lastSyncedState !== GAME_OVER` edge guard as the loss buzz (no double-fire on snapshot replays). The high-intent post-defeat moment (pairs with `share`). |
| `post_score` | `score` (number) | `game.js` `gameOver()` — GA4 recommended event (solo only) |
| `mp_elimination` | `cause` (`wall`\|`self`\|`bite`), `players_alive` (int) | `mp-engine.js` `eliminatePlayer()` — **kept** (no solo analog) |
| `share` | `method` (platform), `content_type` (`score`\|`mp_win`\|`mp_loss`) | `share.js` `openShare()` |
| `mute_toggle` | `muted` (bool) | `sound.js` `toggleMute()` |
| `leaderboard_view` | — | `leaderboard-ui.js` `openLeaderboard()` |
| `leaderboard_submit` | `score` (number), `rank` (number; 0 = rank unknown) | `game.js` `submitAndShowRank()` |
| `pwa_install` | `outcome` (`prompted`\|`accepted`\|`dismissed`\|`installed`) | `index.html` install listeners — `accepted`/`dismissed` are the real `userChoice.outcome` from the custom `#install-btn` CTA |
| `pwa_update` | `action` (`shown`\|`reloaded`) | `index.html` SW-register block — `shown` when the update banner appears, `reloaded` when the user taps Reload. Measures stale-tab exposure vs. refresh rate. |
| `consent_update` | `outcome` (`granted`) | `consent.js` `setConsent()` — fires once, only on Accept |
| `js_error` | `reason` (`window_error`\|`unhandled_rejection`\|`raf_loop`\|`rtdb_listener`\|`firestore_listener`), `error_name` (string ≤40 = JS constructor name, NOT the message), `source_line` (number; `window_error` only), `mode` (0/1; `raf_loop` only) | `utils.js` `reportError()` via the global trap (`main.js`), the rAF guard (`game.js`), and the desktop listener error callbacks (`network.js`). Never logs `message`/`stack`/URL/session code. (Q7.) |

Every event also carries `device_role` (`desktop_host` / `phone_controller`).

**Retired:** `mp_game_start` / `mp_game_over` are folded into the unified `game_start` / `game_over`
with `mode:'multi'`, so "rounds played" is one comparable funnel across modes (a GA4 saved
exploration no longer has to union two name sets). `mp_elimination` is **kept** (it has no solo
analog). Existing solo `game_start` / `game_over` names are unchanged (continuity); they just gain params.

## User properties & North-Star Metric

- **`device_role`** (`desktop_host` \| `phone_controller`) — set in `enableAnalytics()` (`config.js`),
  post-consent.
- **`player_tier`** (`new` \| `returning` \| `engaged`) — set by `recordRoundAndTier()` (`utils.js`),
  called from `gameOver()` / `endMultiplayerGame()` on every finished round, **only once analytics
  exists** (post-consent). Derived from a LOCAL round counter + distinct-day set in
  `localStorage['snake_rounds_played']` (`ROUNDS_KEY`) — `derivePlayerTier(count, distinctDays)`:
  `engaged` at ≥5 rounds, `returning` at ≥1 round across ≥2 distinct days, else `new`. **No device id,
  no count, NO PII leaves the device** — only the bounded bucket reaches GA4.
- **North-Star Metric (GA4-side, not code):** *weekly count of `round_completed` events from paired
  desktop hosts* — i.e. `device_role = desktop_host` sessions that also saw
  `controller_connected{side:desktop}`. The code emits the raw signals; the NSM is a saved GA4
  Exploration. **Funnels to watch:** `session_created` → `controller_arrival` →
  `controller_connected`, with `controller_connect_failed` / `controller_never_connected` as the
  leak; and `rematch_prompt` → `share` / next `game_start`.

> **Owner GA4 console task (not automated):** register the new params as **custom dimensions** in GA4
> Admin so they're queryable in Explorations: `mode`, `reason`, `arrival`, `side`, `players`,
> `duration_s`, `food_eaten`, `max_combo`, `winner_score`, and the `player_tier` user property.

## How to view the data

1. **Google Analytics** → <https://analytics.google.com> → property **`G-0DFSB38H21`** (or open the
   **Firebase console → Analytics** for the same data).
2. **Realtime** report and **DebugView** (Admin → DebugView) show hits within seconds — best for
   confirming events fire. Standard reports (Audience / Acquisition / Engagement → Events) populate
   over a few hours; geo/audience builds over a day or two.
3. Useful reports: **Reports → Acquisition** (traffic sources + campaigns), **Reports → Engagement →
   Events** (the custom events above), and **Explore** to segment by the `device_role` dimension.

## Marketing campaigns (UTM)

GA4 auto-parses `utm_source / utm_medium / utm_campaign / utm_term / utm_content` from the landing
URL — **no code needed**. Tag the links you publish, e.g.:

```
https://go-console-84748.web.app/?utm_source=instagram&utm_medium=bio&utm_campaign=launch
```

Acquisition reports then attribute sessions — and the `game_over` / `share` engagement — to each
campaign. UTM params coexist with the controller deep link (`?session=...&utm_source=...`; the app
reads only `session`).

## Keep dev traffic out of the numbers

Don't gate analytics in code (that would also suppress local verification hits). Instead, in **GA4
Admin** add an *internal-traffic* rule (by your IP) or a data filter that excludes the dev hostname,
or use a separate **Dev** data stream.

## Verifying locally

Serve `public/` and watch the network for `https://www.google-analytics.com/g/collect` requests — the
query string shows `en=<event>` and `ep.device_role=...` for single events (rapid events are batched
into the POST body). `gtag/js?id=G-0DFSB38H21` loading + the `analytics` handle being defined confirm
wiring even when an ad-blocker drops the `/collect` beacons. (`204` + `ERR_ABORTED` is normal for the
keep-alive beacons; GA still receives them.)
