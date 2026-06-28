# Cross-device capability support matrix

The **phone controller** — the primary surface for real users, overwhelmingly **iOS Safari** —
leans on a cluster of *optional* browser APIs (Vibration, Web Share, async Clipboard,
`crypto.randomUUID`, Web Audio, touch/pointer events). Each is **feature-detected ad hoc** in the
production sources and degrades to a documented fallback when absent. This doc is the single
written record of *what we depend on, how each capability is detected, how it degrades, and which
browsers we've verified* — so "does this work on iOS Safari?" has a dated answer instead of a shrug.

The automated half of this guarantee is `tests/capabilities.test.js` (runs in the default
`npm test` / `vitest run`). It characterizes every guard below in **both** states — present (happy
path) and absent (safe no-op / fallback, never throws) — so an edit that drops a guard turns red in
CI before it ships. This doc is the manual half: the real-device claims that jsdom can't prove.

> **Phone-only, transport-independent.** Every capability here lives on the **phone controller** and
> is **independent of the sync transport**. `triggerHaptic` is deliberately driven off the synced
> state edge, so the loss buzz fires in **both** Firebase and localStorage modes, and it is
> independent of the audio mute by design (a silenced player still feels the loss). No desktop
> engine path (solo vs. multi) is affected.

## Capability table

| Capability | API | Detection site (`file:line`) | Degradation when absent | Covered by test |
| --- | --- | --- | --- | --- |
| **Vibration / haptics** | `navigator.vibrate` | `controller.js:300-315` `triggerHaptic()` — `typeof navigator.vibrate === 'function'`, wrapped in `try/catch` | iOS path: hidden `<input switch>` trick (Safari 17.4+); if that no-ops too, the on-screen `.loss-flash` cue covers it. Errors swallowed. | ✅ present / iOS-switch / throws |
| **iOS haptic fallback** | `<input switch>` + `.click()` | `controller.js:303-311` (the `else` of the vibrate guard) | Programmatic trigger was patched out in iOS 26.5 → harmless no-op; `.loss-flash` is the real iPhone cue. | ✅ (creates+clicks+removes label) |
| **Web Share** | `navigator.share` | `share.js:71` `if (navigator.share)` | Falls through to the Clipboard branch (see below). | ✅ present / absent |
| **Async Clipboard** | `navigator.clipboard.writeText` | `share.js:76` `navigator.clipboard && navigator.clipboard.writeText` | Toast asks the user to copy manually; still opens instagram.com. Never throws. | ✅ present / absent |
| **Web Audio** | `AudioContext` / `webkitAudioContext` | `sound.js:14` `window.AudioContext \|\| window.webkitAudioContext`, then `:15` `if (AC)` | `getAudioContext()` returns `null`; `playTone()` early-returns (`sound.js:30`) — silent, no throw. | ✅ present (memoized once) / absent (no-op) |
| **Per-device id** | `crypto.randomUUID` | `leaderboard.js:76` `(window.crypto && crypto.randomUUID)` | `'p-' + Date.now().toString(36) + '-' + Math.random()...` fallback id; persisted to `localStorage`. | ✅ present / absent (`p-…`) |
| **Touch / pointer** | touch events + `e.touches[0]` | `controller.js:130-132` (listeners, `touchmove` is `{ passive: false }`); `controller.js:168-178` `getPointerPosition()` | Normalizes mouse `clientX/Y` **or** `touches[0]`; returns `null` for neither (caller bails). Mouse drag works on desktop. | ✅ mouse / touch / null |

Notes:
- **Web Share volume is a proxy for reach.** The `share` event (`share.js:91`, `method` =
  `whatsapp\|x\|facebook\|instagram`) already records the Instagram branch — the one gated by
  `navigator.share`/clipboard — so its GA4 volume is a field signal for Web Share reach on real
  phones. No new analytics events were added for this matrix (see "Future options").
- **Connect-funnel coverage.** `pwa_install`, `controller_connected`, `controller_arrival` already
  instrument the join path (see `.agent/system/analytics.md`).

## Browser / device support matrix

Legend: ✅ native API · ⚠️ documented fallback path · ❌ no-op (cue still covered elsewhere).
**iOS Safari is the primary phone-controller platform** and is listed first.

| Device / OS (role) | Vibration | iOS `<input switch>` | Web Share | Clipboard | Web Audio | `randomUUID` | Touch/pointer | Last verified (date / version) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **iOS Safari (phone controller)** | ❌ never existed | ⚠️ Safari 17.4+ (patched in iOS 26.5 → ❌; `.loss-flash` covers) | ✅ | ✅ | ✅ (`webkitAudioContext` legacy) | ✅ (Safari 15.4+) | ✅ | _unverified — pending device pass_ |
| **iPadOS Safari (controller)** | ❌ | ⚠️ same as iOS | ✅ | ✅ | ✅ | ✅ | ✅ | _unverified_ |
| **Android Chrome (controller)** | ✅ | n/a | ✅ | ✅ | ✅ | ✅ | ✅ | _unverified_ |
| **Android Firefox (controller)** | ✅ | n/a | ⚠️ limited → Clipboard fallback | ✅ | ✅ | ✅ | ✅ | _unverified_ |
| **Desktop Chrome / Edge (host)** | ✅ (ignored on host) | n/a | ⚠️ desktop-dependent | ✅ | ✅ | ✅ | ✅ (mouse) | _unverified_ |
| **Desktop Firefox (host)** | ⚠️ behind pref | n/a | ❌ → Clipboard fallback | ✅ | ✅ | ✅ | ✅ (mouse) | _unverified_ |
| **Desktop Safari (host)** | ❌ | n/a | ✅ | ✅ | ✅ | ✅ | ✅ (mouse) | _unverified_ |

> The **host** (desktop) never needs Vibration or Web Share for gameplay — those columns describe
> what the browser *exposes*, not a host dependency. The host's hard requirements are Web Audio
> (SFX), `crypto.randomUUID` (leaderboard id), and pointer input. All are universally available on
> modern desktop browsers.
>
> `Last verified` is intentionally `_unverified_` until a physical-device pass is run (jsdom under
> vitest proves the **guard logic**, not platform behavior). Fill each cell with a result + date
> using the checklist below; that is the contract that keeps this matrix honest.

## How to re-verify (manual phone checklist)

The capability guards are real-device-shaped; the smoke test can't prove iOS behavior. To refresh a
row:

1. **Serve `public/` locally:** `python -m http.server` from `public/` (Node not required for this).
2. **Clear the stale service worker first.** The SW is **network-first**, but a local preview can
   still serve a cached shell — unregister the SW and clear caches before testing (see `CLAUDE.md`
   gotchas), or the device may run old code.
3. **Open the controller view** on the phone: scan the QR, or append `?session=123456` to force the
   mobile/controller view (use the `123456` placeholder convention — **never** a real session code,
   never log PII).
4. **Exercise each capability and record the result + today's date:**
   - **Touch/pointer:** drag the joystick — the snake steers; magnitude scales speed.
   - **Web Audio:** unmute, eat food — ascending blip; lose — crash sound.
   - **Vibration / iOS switch:** eat food → feel a short buzz (Android) or confirm the no-op is
     graceful (iOS); lose → loss buzz **and** the red `.loss-flash` shake (the iOS-safe cue).
   - **Web Share / Clipboard:** on the game-over card, tap each share button — WhatsApp / X /
     Facebook open intents; **Instagram** uses the native share sheet if present, else copies the
     caption (toast) and opens instagram.com.
   - **`crypto.randomUUID`:** confirm the global leaderboard accepts a score (the per-device id was
     generated) — fallback `p-…` ids work identically.
5. **Update the cell** (✅ / ⚠️ / ❌) and the `Last verified` date for that device row.

## Future options (out of scope here)

- A single `trackEvent('haptic_fallback', { path: 'switch' })` at the iOS branch
  (`controller.js:303`) would give GA4 field signal on how often the `<input switch>` fallback
  actually fires. Deferred deliberately to keep this change test-and-docs only. Any such event must
  route through the hardened `trackEvent()` (`utils.js`) — no-op offline, **never** the session code
  or PII.

## See also

- `tests/capabilities.test.js` — the automated guard-characterization smoke test.
- `.agent/system/analytics.md` — `trackEvent` coverage referenced above.
- `.agent/system/architecture.md` — file roles and load order.
- `CLAUDE.md` — project gotchas (network-first SW, public Firebase key, global scope).
