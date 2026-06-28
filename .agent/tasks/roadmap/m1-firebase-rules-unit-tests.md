# M1 · Test the Firebase security rules (they ship to prod untested)

> **Tier** medium · **Focus** Launch-readiness / Security · **Impact** High · **Effort** M (1-2 days) · **Priority** 78/100
> **Status** `Not started` · **Depends on** none — pairs with M7 · **Part of** [Roadmap](./README.md)

## 1. Problem — what we're solving

The app has **no authentication by design**: its entire access-control model lives in two
version-controlled rule files, and CI deploys both to production on every push to `master`
(`.github/workflows/deploy.yml:56` — `firebase deploy --only hosting,firestore,database`). Yet
**nothing tests those rules**. The repo has `vitest` wired (`package.json:9`) with three test files
(`tests/logic.test.js`, `tests/protocol.test.js`, `tests/utils.test.js`) — none exercise the rules.

The untested surface is the whole security contract:

- **`firestore.rules` (102 lines)** carries:
  - the 6-digit code gate on sessions — `allow read, delete: if code.matches('^[0-9]{6}$')`
    (`firestore.rules:75`) and `allow create, update: if code.matches(...) && validShape()`
    (`firestore.rules:76`).
  - `validShape()` (`firestore.rules:58`) — a strict key allowlist for `sessions/{code}` plus the
    `mode == 'multi'` literal check (`firestore.rules:64`).
  - `validPlayer(p)` (`firestore.rules:23`) — name 1–16 chars, token ≤40 chars, score 0–100000,
    `alive`/`connected` booleans, exact key set.
  - `validPlayers` / `validGameActions` (`firestore.rules:32`, `:47`) — slot keys restricted to
    `p1..p6`, actions restricted to `null | 'start' | 'restart'`.
  - the **leaderboard contract** (`firestore.rules:83`): `validLeaderboard` (`:84`) requires exactly
    `name`/`score`/`updatedAt`, score in `[0, 100000]`, and `updatedAt == request.time`; **create**
    is open-but-validated (`:94`), **update** is allowed only when
    `request.resource.data.score >= resource.data.score` — the **monotonic guard** (`:95-96`) — and
    **delete is denied** (`:97`).
- **`database.rules.json`** carries:
  - the 6-digit code gate on `controllers/{$sessionId}` (`database.rules.json:5-6`).
  - the joystick range clamp `>= -1.01 && <= 1.01` on `x`/`y`, both legacy-flat
    (`database.rules.json:12-13`) and per-slot (`:22-23`).
  - the per-slot wildcard `$slot.matches(/^p[1-6]$/)` (`database.rules.json:17`) and `$other`
    `.validate: false` rejections of unknown keys (`:14`, `:24`, `:26`).

A one-character typo — dropping a digit from the `100000` ceiling, flipping `>=` to `>` in the
monotonic guard, widening `p[1-6]` to `p[1-9]`, or removing a `.validate` — would **silently ship to
production**. There is no `@firebase/rules-unit-testing` dependency, no emulator block in
`firebase.json`, and no CI step that runs the emulators. The accepted-risk model
(`.agent/system/firebase_schema.md:85`) explicitly leans on these rules being correct ("security must
come from Firestore/RTDB rules"), which makes the absence of any test the single biggest
launch-readiness gap.

## 2. Why it matters

This is **launch-readiness and security**, the stated focus. Because the security model is no-auth,
the rules *are* the security. A regression here isn't a degraded feature — it's the leaderboard
becoming rewritable-downward (high scores erasable), session docs accepting arbitrary unbounded
payloads (cost/abuse), or the joystick stream accepting unclamped values. None of that is caught by
the current CI (`lint` + `vitest` + `node --check`), all of which pass on a broken rule file.

For **pushing toward real users**: the moment the live demo (https://go-console-84748.web.app/) gets
real traffic, the leaderboard and sessions become an attack surface. A blocking emulator test turns
the rule files into something you can refactor with confidence (e.g. when M-series work raises
`gameConfig.maxPlayers` or adds fields) instead of hand-auditing a 102-line `.rules` file on every
change. It also documents the intended contract executably — the test file becomes the spec for what
"valid" means, complementing the prose in `.agent/system/firebase_schema.md`.

## 3. Goals

- Add `@firebase/rules-unit-testing` and the Firestore + RTDB emulators, configured in
  `firebase.json`, runnable head-lessly in CI.
- Author `tests/rules.test.js` asserting the **positive and negative** contract for both rule sets
  (Firestore sessions, Firestore leaderboard, RTDB controllers).
- Wire `firebase emulators:exec "vitest run tests/rules.test.js"` as a **blocking** CI step before
  the deploy step in `.github/workflows/deploy.yml`.
- Keep the rest of the suite untouched: `vitest run` (the existing `npm test`) must still run the
  pure-logic/protocol tests **without** needing emulators, so local-Node-less contributors and the
  fast unit job aren't blocked on Java.
- Cover every guard the brief names: `validShape`/`validPlayer`, the monotonic leaderboard guard, the
  6-digit code regex, the joystick `[-1.01, 1.01]` clamp, and the `p[1-6]` slot regex.

## 4. Non-goals

- **No rule changes.** This task tests the rules as they stand; it does not tighten, loosen, or
  refactor `firestore.rules` / `database.rules.json`. If a test surfaces a genuine rule bug, that is
  a *separate* follow-up (note it, don't fix it here).
- **No production deploys.** Tests run only against the local emulators; nothing in this task touches
  the live `go-console-84748` project. (Scratch-project verification per `.agent/workflows/deploy.md`
  remains the manual path for actual rule edits.)
- **No client-code changes.** `public/js/*` is untouched; therefore no `.eslintrc.json` globals churn
  and no `sw.js` `CACHE` bump (no shell asset changes).
- **No deep `results`/`death` validation.** The rules only shallow-validate those
  (`firestore.rules:67-72`); tests assert the shallow contract (map-or-null), not array internals.
- Not adding App Check, Anonymous Auth, or an `ownerId` model — those are deferred mitigations in the
  schema doc, out of scope here.

## 5. Proposed solution

### 5.1 Dependencies

Add to `devDependencies` in `package.json` (already holds `firebase-tools@^13`, which provides the
`firebase emulators:exec` CLI and bundles the emulator jars):

- `@firebase/rules-unit-testing` (the testing helper: `initializeTestEnvironment`,
  `assertSucceeds`, `assertFails`, contexts with `.firestore()` / `.database()`).

No new top-level prod dependency; this is test-only tooling. `firebase-tools` already downloads the
emulator binaries on first `emulators:exec` (Java runtime required — see Risks).

### 5.2 Emulator config (`firebase.json`)

Add an `emulators` block pinning fixed ports so `emulators:exec` and the test client agree, and so CI
is deterministic. `firebase.json` already declares `database.rules` → `database.rules.json` and
`firestore.rules` → `firestore.rules` (`firebase.json:26-32`), so the emulators pick up the **real**
rule files automatically — that is exactly what we want to test.

```jsonc
"emulators": {
  "firestore": { "port": 8080 },
  "database":  { "port": 9000 },
  "ui":        { "enabled": false },
  "singleProjectMode": true
}
```

### 5.3 `tests/rules.test.js`

A **new** test file, ES-module like the others (the `tests/**/*.js` override already sets
`sourceType: module` — `.eslintrc.json:246-250`), so no eslint config change. Pattern after the
existing files for style (`describe`/`it`, named imports from `vitest`). Use
`@firebase/rules-unit-testing`:

- `initializeTestEnvironment({ projectId, firestore: { rules: readFileSync('firestore.rules') },
  database: { rules: readFileSync('database.rules.json') } })` in `beforeAll`.
- `testEnv.clearFirestore()` / `clearDatabase()` between cases via `beforeEach`.
- `assertSucceeds(...)` / `assertFails(...)` for each leg.
- Because the rules use **no `request.auth`**, use a single **unauthenticated** context
  (`testEnv.unauthenticatedContext()`) — this matches the no-auth model. For the leaderboard's
  `updatedAt == request.time` guard (`firestore.rules:90`), write `serverTimestamp()` (the client
  sends it as `firebase.firestore.FieldValue.serverTimestamp()` in
  `public/js/leaderboard.js:122-126`); the emulator resolves it to `request.time`. To assert a
  failing `updatedAt`, write a hard-coded `Timestamp` that won't equal `request.time`.
- Seed pre-existing docs (for the monotonic-update and delete cases) with
  `testEnv.withSecurityRulesDisabled(ctx => …)` so setup isn't blocked by the rules under test.

**Test matrix (each row = one `it`):**

*Firestore — `sessions/{code}` (mirror the shape in `.agent/system/firebase_schema.md:7-41`):*

- ✅ create a valid **solo** doc (`{ created, connected, gameState, gameAction, lastActivity,
  version, feedback }`) under a 6-digit code → allowed.
- ✅ create a valid **multi** doc (`mode:'multi'`, `players.p1` with all required fields in range,
  `gameActions.p1:'start'`) → allowed.
- ✅ read/delete under a 6-digit code → allowed (no `validShape` on read/delete —
  `firestore.rules:75`).
- ❌ create under a **5-digit / 7-digit / non-numeric** code → denied (code regex).
- ❌ create a doc with an **unknown top-level key** (e.g. `evil: true`) → denied (`validShape` key
  allowlist, `firestore.rules:59-63`).
- ❌ create with `mode: 'solo'` (any non-`'multi'`) → denied (`firestore.rules:64`).
- ❌ create with `players.p7` (slot outside `p1..p6`) → denied (`validPlayers` key set,
  `firestore.rules:34`).
- ❌ create with a player whose `name` is 17 chars, or `score` = 100001, or `score` negative, or
  `alive` not a bool, or an extra player key → denied (`validPlayer`, `firestore.rules:24-29`).
- ❌ create with `gameActions.p1: 'pause'` (action outside `null|'start'|'restart'`) → denied
  (`validAction`, `firestore.rules:44`).

*Firestore — `leaderboard/{playerId}`:*

- ✅ read (any context) → allowed (`allow read: if true`, `firestore.rules:93`).
- ✅ create with `{ name (1–16), score in [0,100000], updatedAt: serverTimestamp() }` → allowed
  (`firestore.rules:94`).
- ❌ create with `score` = 100001, or `score` < 0, or an extra/missing key, or `name` empty/17-char →
  denied (`validLeaderboard`, `firestore.rules:85-90`).
- ❌ create with `updatedAt` ≠ `request.time` (a fixed past `Timestamp`) → denied
  (`firestore.rules:90`).
- ✅ **update** raising the score (seed score 50 → write 80) → allowed (monotonic `>=`,
  `firestore.rules:96`).
- ✅ update with an **equal** score (50 → 50) → allowed (`>=` is inclusive — guards against an
  off-by-one regression to `>`).
- ❌ **update lowering** the score (seed 80 → write 30) → **denied** (the monotonic guard — the
  headline negative case).
- ❌ **delete** any leaderboard doc → denied (`allow delete: if false`, `firestore.rules:97`).

*RTDB — `controllers/{$sessionId}` (mirror `.agent/system/firebase_schema.md:42-62`):*

- ✅ write legacy-flat `{ connected:true, joystick:{x:0.5,y:-0.5}, timestamp:123, initialized:true }`
  under a 6-digit code → allowed.
- ✅ write per-slot child `controllers/{code}/p3` = `{ connected:true, joystick:{x:1.0,y:-1.0},
  timestamp:123 }` → allowed.
- ❌ write under a 5-digit code → denied (`$sessionId.matches` — `database.rules.json:5-6`).
- ❌ write joystick `x: 1.5` (outside `[-1.01, 1.01]`) at either level → denied
  (`database.rules.json:12`, `:22`).
- ❌ write joystick `y: -2` → denied (lower clamp).
- ❌ write to a slot child `controllers/{code}/p7` (outside `p[1-6]`) → denied
  (`database.rules.json:17`).
- ❌ write an unknown key inside `joystick` (e.g. `joystick.z`) → denied (`$other: .validate false`,
  `database.rules.json:14`/`:24`).
- ✅ read under a 6-digit code → allowed (`.read` mirrors `.write`, `database.rules.json:5`).

### 5.4 `package.json` scripts

- Keep `"test": "vitest run"` **as-is** (fast, no emulators; runs in the existing CI `Unit tests`
  step — `.github/workflows/deploy.yml:35-36`). `tests/rules.test.js` must therefore be **excluded**
  from the default `vitest run` (otherwise the no-emulator unit job would try to connect and hang).
  Two viable approaches — pick one and document it in the test file header:
  1. A dedicated `vitest.config.js` `exclude` for `tests/rules.test.js` in the default run, and run
     it explicitly by path under emulators (matches the brief's
     `emulators:exec "vitest run tests/rules.test.js"`). **Preferred** — least magic, explicit path.
  2. Or a separate project/config. Heavier; avoid unless (1) proves awkward.
- Add `"test:rules": "firebase emulators:exec --only firestore,database \"vitest run
  tests/rules.test.js\""` so the emulator run is one command locally and in CI.

### 5.5 CI wiring (`.github/workflows/deploy.yml`)

Insert a **blocking** step **after** `🧪 Unit tests` (`:35`) and **before** `🚀 Deploy to Firebase`
(`:51`), so a rules regression fails the job before any deploy:

```yaml
- name: ☕ Set up Java (Firebase emulators)
  uses: actions/setup-java@v4
  with: { distribution: 'temurin', java-version: '17' }

- name: 🔥 Rules tests (emulated)
  run: npm run test:rules
```

`npm install` (`:29`) already installs `firebase-tools`; `setup-java` provides the JRE the Firestore
emulator needs. `emulators:exec` boots the emulators, runs the command, and **exits non-zero if the
command fails** — so it is correctly blocking. This runs on both `pull_request` and `push` (the
workflow triggers on both — `.github/workflows/deploy.yml:3-7`), so PRs catch regressions before
merge, exactly like the existing lint/test gates.

### 5.6 Both-transports / both-modes note

This change is **test-only** and touches no client transport or engine. But the *coverage* spans both
transports (Firestore sessions+leaderboard **and** RTDB joystick) and both modes (the solo-doc shape
**and** the multi-doc `players`/`gameActions` shape), so the single new test file is the cross-cutting
guard the dual-path architecture has been missing.

## 6. Acceptance criteria

- [ ] **Given** a 6-digit code, **when** an unauthenticated client creates a valid solo session doc
      (exact key set from `firestore.rules:59-63`), **then** the write **succeeds**.
- [ ] **Given** a 6-digit code, **when** a client creates a valid `mode:'multi'` doc with `players.p1`
      in range and `gameActions.p1:'start'`, **then** the write **succeeds**.
- [ ] **Given** a 5-digit, 7-digit, or non-numeric code, **when** any create is attempted, **then** it
      is **denied**.
- [ ] **Given** a session doc carrying an unknown top-level key, or `mode != 'multi'`, or `players.p7`,
      or a player with name > 16 chars / score > 100000 / non-bool `alive`, or `gameActions.p1:'pause'`,
      **then** each is **denied** (one assertion per case).
- [ ] Leaderboard **read** succeeds for any client; **create** with `{name, score∈[0,100000],
      updatedAt:serverTimestamp()}` **succeeds**.
- [ ] Leaderboard create with score > 100000, score < 0, missing/extra key, empty name, name > 16, or
      `updatedAt != request.time` is **denied** (one assertion per case).
- [ ] Leaderboard **update raising** the score **succeeds**; **update with equal** score **succeeds**;
      **update lowering** the score is **DENIED**; **delete** is **DENIED**.
- [ ] RTDB write of valid legacy-flat input and valid per-slot `p3` input under a 6-digit code
      **succeeds**; read under a 6-digit code **succeeds**.
- [ ] RTDB write under a non-6-digit code, with joystick `x`/`y` outside `[-1.01, 1.01]`, to slot
      `p7`, or with an unknown `joystick` child key is **denied** (one assertion per case).
- [ ] `npm test` (default `vitest run`) **excludes** `tests/rules.test.js` and stays green **without**
      any emulator/Java present (verified by the existing CI `Unit tests` step still passing).
- [ ] `npm run test:rules` boots the Firestore + RTDB emulators against the **real** `firestore.rules`
      and `database.rules.json` and the whole `tests/rules.test.js` suite passes; it exits non-zero if
      any assertion fails (verified by a deliberate temporary rule break locally/scratch).
- [ ] `.github/workflows/deploy.yml` gains a **blocking** rules-test step (with Java setup) **between**
      Unit tests and Deploy; the deploy step still only runs on `push` to `master`
      (`.github/workflows/deploy.yml:52` unchanged).
- [ ] `npm run lint` passes on `tests/rules.test.js` (the `tests/**` module override applies; no new
      cross-file globals are introduced in `public/js/*`, so **`.eslintrc.json` globals are NOT
      touched**).
- [ ] `node --check` syntax pass over `public/*` is unaffected (no `public/` files changed).
- [ ] **No `sw.js` `CACHE` bump** (no shell asset changed) and **no PII / no 6-digit session code**
      logged anywhere in the new test (codes used are test fixtures, never emitted to analytics).

## 7. Affected files

| File | Change |
|------|--------|
| `tests/rules.test.js` | **NEW.** Emulator-backed rules contract suite (Firestore sessions + leaderboard, RTDB controllers); positive + negative cases per §5.3. Excluded from the default `vitest run`. |
| `package.json` | Add `@firebase/rules-unit-testing` to `devDependencies`; add `"test:rules"` script (`firebase emulators:exec --only firestore,database "vitest run tests/rules.test.js"`). Keep `"test"` as-is. |
| `firebase.json` | Add an `emulators` block (firestore:8080, database:9000, UI disabled, `singleProjectMode`). Existing `database.rules`/`firestore.rules` mappings already point the emulators at the real files. |
| `.github/workflows/deploy.yml` | Add `actions/setup-java` step + a **blocking** `npm run test:rules` step between `🧪 Unit tests` and `🚀 Deploy to Firebase`. |
| `vitest.config.js` (or `vitest.config.mjs`) | **NEW (if approach 1).** `test.exclude` for `tests/rules.test.js` so the default unit run skips the emulator suite. |
| `.eslintrc.json` | **No change** — no new top-level `public/js/*` declarations. (Flagged per template: globals list is NOT bumped.) |
| `public/sw.js` | **No change** — no shell asset touched, so **`CACHE` is NOT bumped**. (Flagged per template.) |

## 8. Dependencies & sequencing

- **Hard deps:** none. The rule files and CI already exist; this adds tests around them.
- **Pairs with M7** (per the brief) — if M7 also touches CI or rules, land M1 first so M7's rule edits
  are exercised by the new gate rather than shipping untested.
- **Ordering within the task:** (1) add dep + `firebase.json` emulators + `test:rules` script;
  (2) author `tests/rules.test.js` and the default-run exclusion; (3) wire the CI step **last**, once
  the suite is green, so the first CI run that includes the gate already passes.
- **Future-proofing:** the test asserts `p1..p6` even though `gameConfig.maxPlayers` is currently 3 —
  matching the rules' intent (`firestore.rules:21`) — so a later `maxPlayers` raise needs no test
  change. Same for the `100000` score ceiling (mirrors `LB_SCORE_CEILING` in
  `public/js/leaderboard.js:70`); if that tunable ever moves, update both in lockstep.

## 9. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| **Java dependency on the runner.** The Firestore emulator needs a JRE; `ubuntu-latest` has one but pinning is safer. | Add `actions/setup-java@v4` (temurin 17) explicitly so the emulator boot is deterministic, not reliant on the image's default JDK. |
| **CI time + flakiness from emulator boot.** Emulators add startup latency and a first-run jar download. | Use `emulators:exec --only firestore,database` (skip hosting/UI/functions); run the suite as one process; pin ports in `firebase.json`. Boot cost is ~10–20s, acceptable for a blocking gate. The download can be cached later (npm/firebase cache) if it becomes a bottleneck — not required for v1. |
| **Default unit job accidentally tries to hit emulators.** If `tests/rules.test.js` is picked up by the plain `vitest run`, that job hangs with no emulator. | Explicit `test.exclude` (approach 1) so the file runs **only** under `test:rules`; assert in AC that `npm test` is green without Java. |
| **`serverTimestamp()` vs `request.time` mismatch.** The leaderboard rule requires `updatedAt == request.time` (`firestore.rules:90`); a naive client write of `new Date()` would falsely fail the positive case. | Use `serverTimestamp()` in the success cases (matching `public/js/leaderboard.js:125`); use a fixed `Timestamp` only for the intended negative case. |
| **No local Node on the author's machine** (CI-bound, per project memory). | Author against CI / a scratch Firebase project. The first PR run executes the gate on the `pull_request` trigger before merge — no local emulator run required. Optionally prove the gate *fails* on a broken rule via a throwaway commit, then revert. |
| **Emulator `firebase deploy` confusion.** `emulators:exec` must never touch prod. | `emulators:exec` is local-only by construction; the CI deploy step is unchanged and still gated on `push` to `master` (`.github/workflows/deploy.yml:52`). Do not add any `firebase use`/deploy to the test step. |

## 10. Verification / test plan

Given no local Node and CI-bound iteration:

1. **Lint:** the new test file must pass `npm run lint` (eslint over `public tests` —
   `package.json:7`); the `tests/**` override gives it module scope. Verified in the CI `🔎 Lint`
   step (`.github/workflows/deploy.yml:32-33`).
2. **Default unit suite unaffected:** the existing `🧪 Unit tests` step (`vitest run`) must stay
   green and must **not** require Java — proves the rules suite is correctly excluded from the default
   run.
3. **Rules suite (the core proof):** the new `🔥 Rules tests (emulated)` CI step runs
   `firebase emulators:exec --only firestore,database "vitest run tests/rules.test.js"` against the
   **real** rule files. All positive/negative assertions in §5.3 pass. This runs on the
   `pull_request` trigger, so the PR itself is the verification vehicle — no local emulator needed.
4. **Negative-control (prove the gate bites):** on a throwaway branch, temporarily flip one rule
   (e.g. monotonic `>=` → `>` at `firestore.rules:96`, or widen `p[1-6]` → `p[1-9]` at
   `database.rules.json:17`) and confirm the CI rules step **fails**; revert before merge. This proves
   the test would have caught the exact class of typo the brief warns about.
5. **`node --check`:** unaffected (no `public/` JS changed); the syntax step
   (`.github/workflows/deploy.yml:42`) stays green.
6. **No prod impact:** confirm the deploy step diff is additive-above-only and still
   `if: github.ref == 'refs/heads/master' && github.event_name == 'push'` (unchanged). No
   `firebase deploy` is added anywhere outside CI; scratch-project testing per
   `.agent/workflows/deploy.md:21-28` remains the path for any *actual* rule edit (not part of this
   task).
7. **No Claude_Preview / http.server step needed** — this change has no UI surface.

## 11. Analytics & observability

- **N/A for runtime analytics** — this is build/CI tooling with no user-facing surface, so no
  `trackEvent()` calls are added or changed, and **no 6-digit session code or PII** is ever logged
  (test fixtures use literal codes locally and never reach `trackEvent`/GA4).
- **CI observability:** the rules step surfaces as a named, blocking GitHub Actions check
  (`🔥 Rules tests (emulated)`), giving the same red/green signal as `lint`/`test` today. The
  existing `📢 Status Notification` step (`.github/workflows/deploy.yml:60-66`) already reports
  overall job success/failure, so a rules-test failure is visible there too.
- **Future signal (optional, out of scope):** if rule-related production errors ever need watching,
  the client already logs a hint on leaderboard write failure
  (`"submitGlobalScore failed (are the leaderboard rules deployed?)"`,
  `public/js/leaderboard.js:133`) — a natural breadcrumb, but no change is proposed here.
