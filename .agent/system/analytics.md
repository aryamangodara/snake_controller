# Analytics (Google Analytics 4)

The game uses **Firebase Analytics (GA4)** to understand the audience and attribute marketing
campaigns. GA4 property/measurement ID: **`G-0DFSB38H21`** (already in `firebaseConfig`,
`public/js/config.js`). No cookie-consent banner is shown (owner choice; GA4 anonymizes IPs by
default).

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

- `public/js/main.js` also sets `device_role` as a GA4 **user property** (segments sessions by role).

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
| `game_start` | — | `game.js` `startGame()` |
| `game_restart` | — | `game.js` `restartGame()` (covers desktop + phone "Play Again") |
| `game_over` | `score` (number), `is_high_score` (bool) | `game.js` `gameOver()` |
| `post_score` | `score` (number) | `game.js` `gameOver()` — GA4 recommended event |
| `share` | `method` (platform), `content_type` (`score`) | `share.js` `openShare()` |
| `mute_toggle` | `muted` (bool) | `sound.js` `toggleMute()` |
| `pwa_install` | `outcome` (`prompted`\|`installed`) | `index.html` install listeners |

Every event also carries `device_role` (`desktop_host` / `phone_controller`).

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
