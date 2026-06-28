# M7 · Tighten Firebase rules: bound unvalidated fields, SRI on SDK, cost tripwires

> **Tier** medium · **Focus** Launch-readiness / Security · **Impact** Medium · **Effort** S · **Priority** 70/100
> **Status** `Not started` · **Depends on** land WITH M1 so changes are verified · **Part of** [Roadmap](./README.md)

## 1. Problem — what we're solving

Three cheap-to-close abuse/cost vectors remain open at the security perimeter. All are real and
verified against the current tree:

**(1) `validShape()` allow-lists keys but never content-validates the legacy solo fields.**
`firestore.rules:58-73` gates `create`/`update` on `request.resource.data.keys().hasOnly([...])`
(line 59-63) and then deep-validates only the multiplayer keys — `mode`, `players`, `gameActions`,
`results` (lines 64-69). The legacy solo fields `connected`, `gameState`, `gameAction`, `version`,
`feedback`, `lastActivity` are **named in the allow-list but otherwise unchecked**: any client that
matches the `^[0-9]{6}$` code regex (`firestore.rules:76`) can write a near-1 MiB blob into
`feedback` or `gameState`. Because the desktop host runs a live `onSnapshot` listener on this doc
(`network.js:149`), an inflated doc is **re-read on every snapshot**, multiplying Firestore read
cost per listener — and the no-auth model (`firestore.rules:7-15`) means anyone holding the code
can do it. This is the same griefing class already documented as accepted in
`.agent/system/firebase_schema.md:89-92`, but the *cost* dimension (oversized payloads) is not yet
mitigated.

**(2) The four gstatic Firebase SDK `<script>` tags load with NO SRI / crossorigin.**
`public/index.html:26-29` loads `firebase-app.js`, `firebase-database.js`, `firebase-firestore.js`,
and `firebase-analytics.js` (all `8.10.1`) with a bare `src` and no `integrity`/`crossorigin`. This
is the **highest-privilege code in the app** — it holds the Firestore/RTDB client and the public
config — yet `qrious` (`index.html:33-35`) and Font Awesome (`index.html:38-40`) are already
SRI-pinned with `integrity` + `crossorigin="anonymous"`. The high-trust dependency is the one left
unprotected.

**(3) The documented cost/cleanup safety net is still an un-actioned console TODO.**
`firestore.rules:13` and `.agent/system/firebase_schema.md:79-83, 103-105` both call for a Firestore
TTL policy on `lastActivity` (so abandoned sessions self-expire) and a GCP billing budget alert (the
cost tripwire). Neither exists yet; both are owner/console actions that the repo cannot deploy via
CI, so they need an explicit, tracked checklist instead of a buried code comment.

## 2. Why it matters

This is pure **launch-readiness**: before pushing for real users, the cheap perimeter holes that
turn "annoyance-only griefing" into "a stranger can run up my Firebase bill" should be closed. None
of these change gameplay or UX — they harden the edges so a public URL is safe to share.

- **(1)** caps the blast radius of a malicious/buggy client to a few hundred bytes per field instead
  of ~1 MiB, directly protecting per-listener read/write cost — the metric a billing alert would
  otherwise catch only *after* money is spent.
- **(2)** closes a supply-chain gap on the most privileged script in the page; a compromised or
  swapped gstatic asset could exfiltrate session data or hijack the client. SRI makes that a
  hard-fail, and `config.js` already degrades to offline mode on Firebase init failure, so a hash
  mismatch fails *gracefully* (the app still loads in localStorage-fallback mode).
- **(3)** the TTL + budget alert are the documented "Mitigations (console-side, owner action)"
  (`firebase_schema.md:103-105`); turning them from prose into a verified checklist is what makes the
  accepted-risk posture actually true rather than aspirational.

## 3. Goals

- Add lightweight content validators in `firestore.rules` for the five legacy solo fields, mirroring
  the **actual** write shapes in `network.js` / `controller.js` / `mp-net.js` (no over-tightening).
- Add `integrity` + `crossorigin="anonymous"` to all four Firebase `8.10.1` `<script>` tags in
  `public/index.html`, matching the existing SRI pattern used for qrious / Font Awesome.
- Produce a tracked owner checklist (in `firebase_schema.md`) for the console-side TTL policy on
  `sessions.lastActivity` (24h) and a low GCP billing budget alert ($5-10).
- Ship verified: rules changes proven on a scratch Firebase project; SRI proven by a clean load
  (online) and a graceful offline-fallback (hash mismatch) before merge.

## 4. Non-goals

- **No new auth.** The no-auth-by-design model (`firestore.rules:7-15`,
  `firebase_schema.md:85-105`) is unchanged. We are not adding Anonymous Auth, `ownerId`, or App
  Check here (those remain the documented "if real traffic arrives" follow-ups).
- **No deep validation of `results` / per-player `death`.** Those stay shallowly validated — deep
  array validation in rules is brittle and the accepted risk is already documented
  (`firestore.rules:70-72`, `firebase_schema.md:39-40`). This spec does not touch that.
- **No RTDB rules changes.** `database.rules.json` already child-validates the joystick stream
  (`firebase_schema.md:59-62`); this initiative is Firestore-side only.
- **No removal of the open `delete` grant** — it is required for host `beforeunload` cleanup
  (`firestore.rules:8-11`).
- **No SDK version bump.** We pin SRI for the *current* `8.10.1`; upgrading Firebase is out of scope.
- We **cannot** create the TTL policy or budget alert from this repo (console-only); the spec
  delivers the checklist, the owner executes it.

## 5. Proposed solution

### 5a. Firestore validators (mirror the real write shapes)

Add validator functions inside the `match /sessions/{code}` block (alongside the existing
`validPlayer` / `validAction` helpers, `firestore.rules:23-56`) and AND them into `validShape()`
(`firestore.rules:58-73`), each guarded by `!('field' in request.resource.data)` so every field
stays **optional** (preserving the strict-superset / deploy-order-safe property the file already
relies on, `firestore.rules:17-22`). Mirror exactly these verified write shapes:

| Field | Validator (mirrors source) | Source of truth |
|-------|----------------------------|-----------------|
| `connected` | `is bool` | `network.js:83,114` (`false`), `controller.js:351` (`true`) |
| `version` | `is number` | `network.js:95` writes `Date.now()` — a **number, not a timestamp** |
| `gameState` | `is map` && `keys().hasOnly(['active','score','state'])` && `score is number && score >= 0 && score <= 100000` && `state in ['waiting_for_start','playing','game_over']` && (active absent or `is bool`) | `network.js:89-93` (create), `network.js:371-372` / `mp-net.js:61` (dotted partial updates merge into the full `gameState` map) |
| `feedback` | `is map` && `keys().size() <= 6` && per-entry: either the flat solo `{type,at}` OR a per-slot map (see note) | solo `network.js:396` = `{type, at}`; MP `mp-net.js:77,95,124` = `feedback.{slot}` = `{type, at}` |
| `lastActivity` | `is timestamp` (see TTL caveat below) | `serverTimestamp()` at all 9 write sites (`network.js:94,158,373,397`; `controller.js:352,564`; `mp-net.js:63,78,96,…`; `mp-client.js:59`) |

- **`state` enum** values come from `GameState` in `config.js:119-122`
  (`waiting_for_start` / `playing` / `game_over`). Hard-code the string literals in the rule (rules
  can't import JS).
- **`feedback` is DUAL-SHAPE — the main over-tightening trap.** Solo writes a *flat*
  `{ type, at }` map (`network.js:396`), while multiplayer writes a *slot-keyed* map
  `{ p1: { type, at }, … }` (`mp-net.js:77,95,124`). A validator that assumes one shape will reject
  the other and silently break a live host write. Recommended pragmatic bound: validate that
  `feedback is map` and `feedback.keys().size() <= 6` (caps blob size — the actual cost vector —
  without asserting the inner structure, which differs by mode). Reuse the existing `hasOnly` /
  size-bounding idiom already in `validPlayer` (`firestore.rules:25-27`). Do **not** enumerate inner
  keys for `feedback`; the goal is a size cap, not schema purity.
- **`gameAction`** (legacy solo string, mobile-written, `controller.js:566`, cleared to `null` by
  desktop at `network.js:157`) is already shape-equivalent to the MP `validAction` helper
  (`firestore.rules:43-45`: `null | 'start' | 'restart'`). Reuse `validAction` for it:
  `(!('gameAction' in request.resource.data) || validAction(request.resource.data.gameAction))`.
- **Both-transports note:** these validators only constrain the **Firebase/Firestore** path. The
  **localStorage fallback** (`network.js` `setupLocalStorageSession`, `controller.js:568-572`) never
  touches Firestore, so it is unaffected — single-device testing still works.
- **Both-modes note:** solo (`game.js` via `updateGameStateInFirebase`, `network.js:365`) and multi
  (`mp-net.js`) both write the same `sessions/{code}` doc; the validators must pass for **both**,
  which is exactly why `feedback` and `gameState` are validated loosely enough to accept either
  writer.

### 5b. SRI on the four Firebase scripts

In `public/index.html:26-29`, add `integrity="sha384-…"` + `crossorigin="anonymous"` to each of the
four `8.10.1` script tags, matching the existing pinned pattern at `index.html:33-35` (qrious) and
`38-40` (Font Awesome). Generate each hash from the exact pinned URL, e.g.:

```
curl -sL https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js \
  | openssl dgst -sha384 -binary | openssl base64 -A
```

(repeat for `firebase-database.js`, `firebase-firestore.js`, `firebase-analytics.js`).
Because these gstatic URLs are immutable version-pinned assets, the hashes are stable. `config.js`'s
guarded init already drops to offline/localStorage mode if `firebase` is undefined (the protocol
test relies on exactly this, `tests/protocol.test.js:38-39`), so an SRI block fails **gracefully** —
no crash, just fallback mode.

### 5c. Owner checklist (console-side; tracked in docs)

Append a short, checkbox-style "Owner pre-flight (console)" subsection to
`.agent/system/firebase_schema.md` (next to the existing Mitigations prose at lines 103-105) so the
two un-deployable actions are tracked rather than buried in a code comment:

- [ ] Firestore → TTL: add a TTL policy on `sessions` keyed on `lastActivity`, expiry 24h.
- [ ] GCP Billing → Budgets & alerts: budget $5-10 with a 50%/90%/100% email alert.

## 6. Acceptance criteria

- [ ] `firestore.rules` adds optional validators for `connected`, `gameState`, `version`,
      `feedback`, `gameAction`, and `lastActivity`, each AND-ed into `validShape()` behind a
      `!('field' in request.resource.data) ||` guard so all remain optional.
- [ ] **Given** the desktop create write (`network.js:81-96`), **When** evaluated against the new
      rules on a scratch project, **Then** `create` succeeds (no over-tightening of the canonical
      host write).
- [ ] **Given** the partial `gameState.state` / `gameState.score` update (`network.js:370-374`) and
      the MP `mp-net.js:60-69` round-start write, **When** evaluated, **Then** both `update`s succeed.
- [ ] **Given** a solo `feedback: { type:'food', at:<num> }` write (`network.js:395-398`) AND a
      multiplayer slot-keyed `feedback.p2: {type,at}` write (`mp-net.js:75-80`), **When** evaluated,
      **Then** BOTH succeed (dual-shape not broken).
- [ ] **Given** the mobile `connected:true` (`controller.js:350-353`) and `gameAction:'start'`
      (`controller.js:563-567`) writes, **When** evaluated, **Then** both succeed.
- [ ] **Negative:** **Given** a write with `gameState.state = 'cheating'` (not in the enum) OR
      `gameState.score = 9999999` (> 100000) OR a `feedback` map with > 6 keys (oversized-blob
      proxy) OR `version` as a string, **When** evaluated, **Then** the write is **denied**.
- [ ] **Negative:** **Given** a write adding an unknown top-level key (e.g. `evil: '…'`), **When**
      evaluated, **Then** it is denied (existing `hasOnly` behavior preserved — regression guard).
- [ ] All four Firebase `8.10.1` `<script>` tags in `public/index.html` carry a correct
      `integrity="sha384-…"` and `crossorigin="anonymous"`; hashes match the live gstatic assets.
- [ ] **Given** a normal online load with correct hashes, **When** the desktop page opens, **Then**
      a session is created and the QR renders (Firebase loaded; no SRI block).
- [ ] **Given** a deliberately corrupted integrity hash on one Firebase tag (local test only),
      **When** the page loads, **Then** the app degrades to offline/localStorage mode without a hard
      crash (graceful failure verified, then reverted).
- [ ] `firebase_schema.md` gains an "Owner pre-flight (console)" checklist for the TTL policy
      (`sessions.lastActivity`, 24h) and the $5-10 budget alert; `lastActivity` is confirmed written
      as a real `serverTimestamp()` at every write site (so TTL has a valid field).
- [ ] **Guardrails:** `npm run lint`, `npm test` (Vitest incl. `tests/protocol.test.js`), and the
      `node --check` syntax pass are all green in CI. No PII or the 6-digit code is logged anywhere
      added. `.eslintrc.json` globals and `sw.js` `CACHE` are **untouched** (this change adds no
      top-level JS declaration and no shell asset — confirm both unchanged).

## 7. Affected files

| File | Change |
|------|--------|
| `firestore.rules` | Add `validGameState` / `validFeedback` / scalar guards; AND optional validators into `validShape()` (lines 58-73). Reuse `validAction` for the legacy `gameAction` field. |
| `public/index.html` | Add `integrity` + `crossorigin="anonymous"` to the four Firebase `8.10.1` script tags (lines 26-29). |
| `.agent/system/firebase_schema.md` | Add an "Owner pre-flight (console)" checklist (TTL + budget alert) near the Mitigations section (lines 103-105); optionally note the new field bounds in the Firestore table (lines 10-18). |

- **No `.eslintrc.json` globals change** — no new top-level JS declaration is introduced (rules and
  HTML only).
- **No `sw.js` `CACHE` bump** — `index.html` is shell-cached, but the SW is **network-first**
  (CLAUDE.md gotcha), so online users get the SRI'd HTML on next load without a cache bump. (If the
  reviewer prefers belt-and-suspenders, a `CACHE` bump is harmless but not required.)

## 8. Dependencies & sequencing

- **Land WITH M1** so the rules changes are verified together (per the brief). M1's verification
  pass (scratch-project deploy + app smoke) is the natural place to confirm these validators don't
  reject a legitimate host write.
- **Blocks nothing downstream functionally**, but is a launch-readiness gate: it should land before
  any "share the URL widely" milestone.
- The **TTL policy** owner-action depends on `lastActivity` being a real timestamp at every write
  site — verified here (all 9 sites use `serverTimestamp()`), so it is safe to enable.

## 9. Risks & mitigations

- **Over-tightening rejects a legitimate host write (highest risk).** The validators must mirror the
  *actual* shapes, not an idealized schema — especially the dual-shape `feedback` (`network.js:396`
  flat vs `mp-net.js:77,95,124` slot-keyed) and the dotted-path `gameState` partial updates
  (`network.js:371-372`), which Firestore evaluates as the full merged map.
  *Mitigation:* validate `feedback` only by size (`keys().size() <= 6`), not inner structure; test
  every write site from §6 against a scratch project before merge.
- **`lastActivity == request.time` could reject writes.** A strict equality check is tempting but
  `serverTimestamp()` resolves to the commit time, which is **not guaranteed identical** to
  `request.time` in every rules-evaluation edge. *Mitigation:* validate `lastActivity is timestamp`
  (loose) rather than `== request.time`; keep the strict-equality pattern only where it is already
  proven safe (the leaderboard, `firestore.rules:90`). Do not assume the brief's `==request.time`
  wording is safe for the session doc — prefer `is timestamp`.
- **`version` mistaken for a timestamp.** It is `Date.now()` → a **number** (`network.js:95`).
  Validating it as `is timestamp` would deny every host write. *Mitigation:* validate `is number`.
- **Global-scope / load-order minefield.** Not applicable to the rules change (separate file), and
  the HTML SRI change adds no JS globals — so the usual cross-file breakage risk is **avoided by
  construction**. Confirm `.eslintrc.json` and `sw.js` need no edits (§7).
- **Wrong / stale SRI hash bricks the app.** A typo'd hash would block Firebase on every load.
  *Mitigation:* `config.js` degrades to offline mode on init failure (graceful), and the hash is
  generated directly from the immutable pinned gstatic URL; verify the online-load criterion in §6
  before merge.
- **TTL/budget are console-only — can't be enforced by CI.** *Mitigation:* track them as an explicit
  owner checklist in `firebase_schema.md` (not a code comment) so they are visible and checkable.

## 10. Verification / test plan

Given the **no-local-Node, CI-bound** constraint, prove each piece with the cheapest tool that
actually exercises it:

1. **Rules (the core change) — scratch Firebase project + emulator.** Per `.agent/workflows/deploy.md`
   (`firebase use <scratch>; firebase deploy --only firestore`), deploy the new `firestore.rules` to
   a throwaway project. Run the §6 positive cases (create, gameState partial, solo + MP feedback,
   mobile connected/gameAction) and the negative cases (bad enum, oversized score, > 6-key feedback,
   string `version`, unknown key) against it — ideally via `firebase emulators:exec` with the
   `@firebase/rules-unit-testing` harness if added, otherwise via the live app driving real writes.
   **Never deploy these rules to production by hand** — CI ships them on the `master` push.
2. **`node --check` + lint.** `firestore.rules` isn't JS, but `npm run lint` and the `node --check`
   pass must still be green (they cover the unchanged JS). Confirm CI stays green.
3. **Vitest protocol smoke test.** `tests/protocol.test.js` runs the real scripts in offline
   (localStorage) mode (`protocol.test.js:38-39`) — it does NOT hit Firestore, so it confirms the
   rules change doesn't regress the fallback path. Must stay green.
4. **SRI — python http.server + Claude_Preview.** Serve `public/` locally
   (`python -m http.server`), **unregister the SW + clear caches** (network-first SW serves stale
   assets — CLAUDE.md gotcha), and load the desktop view: confirm Firebase loads with the new
   `integrity` attributes (no console SRI error, QR renders, session created). Then temporarily
   corrupt one hash and reload to confirm graceful offline fallback (no hard crash), and revert.
5. **Owner checklist.** Non-code: confirm the TTL policy and budget alert are created in the Firebase
   / GCP console (owner action), and tick the boxes in `firebase_schema.md`.

## 11. Analytics & observability

No new gameplay events are required. Optional, low-risk observability — route everything through the
hardened `trackEvent()` (`utils.js`) so it no-ops offline and never throws:

- **(SRI fallback signal)** Consider emitting a one-shot `trackEvent('offline_mode', { reason:
  'init_failed' })` from `config.js`'s existing init-failure path so an SRI/CDN block on Firebase is
  *observable* in GA4 (distinguishing "user is offline" from "the SDK failed to load"). Keep it a
  single fire, never log the 6-digit code or any PII.
- **(Cost tripwire)** The primary observability for the cost vector is the GCP **billing budget
  alert** (§5c) — that is the deliberate tripwire; GA4 is not the right place for spend.
- Watch Firestore usage in the console after deploy: per-listener read volume should stay flat (the
  field-size cap removes the oversized-doc amplification path).
