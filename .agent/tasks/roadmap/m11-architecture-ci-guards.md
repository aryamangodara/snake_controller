# M11 · Architecture guards: eslintrc-globals CI check, hook registry, JSDoc typedefs

> **Tier** medium · **Focus** Launch-readiness / Quality · **Impact** High · **Effort** M · **Priority** 60/100
> **Status** `Not started` · **Depends on** globals check should land first (protects B1) · **Part of** [Roadmap](./README.md)

## 1. Problem — what we're solving

The no-bundler / no-ES-modules design (`public/index.html` loads ~18 plain `<script>`s into one
global scope) buys simplicity but levies a recurring, invisible maintenance tax in three places.

**(a) The hand-maintained globals list has nothing verifying it.** `.eslintrc.json` declares **216
`globals` keys** (`.eslintrc.json:6-240`) so ESLint's `no-undef` (error) doesn't flag the cross-file
reads that the single-scope design depends on. Those keys must track every top-level declaration in
`public/js/*.js` — **201 unique identifiers** across **208 declaration lines** (155 plain `function`,
**12 `async function`**, plus 41 `let`/`const`, three of which are comma-lists:
`let app, database, firestore, analytics;` at `config.js:23`, `let canvas, ctx, gameLoop;` at
`state.js:92`, and `soundMuted` at `sound.js:10`). The CLAUDE.md gotcha literally says *"that failure
is the feature"* — but the feature only fires if a human remembers to update the list. **Nothing in
CI cross-checks the two sets.** A declared-but-unlisted symbol fails `no-undef` only once some *other*
file references it (so a same-file helper can drift silently); a listed-but-removed symbol lingers
forever as dead noise. Today the only true externals that should appear in `globals` without a
matching declaration are `firebase` and `QRious` (`.eslintrc.json:7-8`).

**(b) Late-binding hooks are invisible to ESLint *and* to grep.** Later modules are invoked from
earlier ones through scattered, stringly-typed lookups with no single contract:

- `mp-engine.js:244-262` — `mpUiHook(name, …)` / `mpNetHook(name, …)` resolve `window[name]` and
  call it if it's a function. The hook *names* (`'renderMpRoundStart'`, `'updateMpScoreboard'`,
  `'renderMpEndScreen'`, `'mpSyncScoreOnEat'`, `'mpSyncElimination'`, `'publishMpResults'`) are bare
  **string literals** — a renamed target compiles, lints, and then silently no-ops at runtime.
- `game.js:76-77,520-521` — `window.mpDesktopWantsRound`, `window.mpHandleDesktopStartKey`,
  `window.getLobbyOverlayLines` via `window.`-dotted lookups. This is exactly what commit **8349613**
  ("reference the later-module hooks via window lookups in game.js") had to introduce to dodge
  `no-undef`, trading a lint error for a silent-failure risk.
- A further ~12 `typeof X === 'function'` guards spread across `mp-client.js:104,118,124,144,151`,
  `mp-ui.js:91,297,327,330`, `network.js:142,161`, `share.js:125,127`, `controller.js:70,321`,
  `game.js:605,607` — each a hand-rolled, ungreppable cross-module call.

Because half use `window.<dot>` and half use `window[<string>]` and half use a bare `typeof`,
**no single grep finds the cross-module contract**, and a rename on the producer side fails silently
on the consumer side.

**(c) The large mutable state shapes have no type contract.** `gameState` (`state.js:29-52`, 18
fields), the per-player object (`players.js:36-58`, 13 fields), `mpSession` (`state.js:73-79`),
`mpClient` (`state.js:83-89`), and `gameState.mpResults` (`mp-engine.js:196-204`) are plain object
literals. A typo'd field — `player.curentSpeed`, `gameState.mpResult` — is a silent `undefined` with
no editor squiggle and no CI signal, in a codebase whose *only* real test coverage is the pure logic
in `logic.js` (`tests/logic.test.js`) plus the one protocol smoke test (`tests/protocol.test.js`).

## 2. Why it matters

This is **launch-readiness / quality** work: it converts three classes of "works until someone
renames something" footguns into mechanical CI signal, with **zero runtime cost and zero build step**
(the guardrails forbid both). For a project pushing toward real users, the failure modes here are the
worst kind — they pass lint and tests, deploy green to production via the auto-deploy on `master`, and
only surface as a dead multiplayer scoreboard or a frozen lobby in a real session. Closing the
globals-vs-decls gap with automation also *protects* future roadmap work: any initiative that adds a
top-level helper (almost all of them) currently risks a silent eslintrc drift; the check makes that
drift a red build instead of a latent landmine. Centralizing the hooks makes the cross-module
contract greppable and reviewable — directly reducing the recurrence of the 8349613-style fix.

## 3. Goals

- A ~40–60 line **Node CI script** (no new npm deps) that diffs top-level declarations in
  `public/js/*.js` against the `.eslintrc.json` `globals` keys and **fails the build** on either
  direction of drift (declared-but-unlisted, or listed-but-undeclared), with a small allowlist for
  true externals (`firebase`, `QRious`).
- The script is wired as a **blocking CI step** in `.github/workflows/deploy.yml`, before deploy.
- A single declared **`hooks` registry object** (in `state.js`) that centralizes late binding, so
  the cross-module producer→consumer contract is one greppable place instead of scattered
  `window[...]` / `window.` / `typeof` call sites.
- **JSDoc `@typedef` blocks** for `GameState` (the object), `Player`, `MpSession`, `MpClient`, and
  `MpResults`, plus a permissive **`jsconfig.json`** (`checkJs: true`, `strict: false`,
  `noEmit: true`) giving editor + optional CI field-name checking with no runtime/build impact.
- `lint`, `node --check`, and `vitest` stay green; the protocol smoke test still passes unmodified.

## 4. Non-goals

- **No bundler, no ES modules, no transpile.** The script-tag / global-scope architecture is
  preserved exactly (hard guardrail).
- **No TypeScript migration.** `jsconfig.json` + JSDoc only; `strict` stays off so existing loose
  patterns don't generate hundreds of errors.
- **Not** making the typedef/`jsconfig` check *blocking* in CI in this initiative (it can run as a
  non-blocking informational step first; promoting it to blocking is a follow-up once the tree is
  clean). The globals check **is** blocking.
- **Not** refactoring the actual sync/gameplay behavior — the `hooks` registry is a mechanical
  re-routing of existing late-bound calls; no new events, no protocol change, no Firestore/RTDB
  schema change.
- Not adding runtime type validation (e.g. asserting shapes at boundaries) — purely static.
- Not touching `tests/` coverage breadth (separate initiative).

## 5. Proposed solution

### 5.1 Globals ↔ declarations CI guard (lands first)

Add `scripts/check-globals.mjs` (new `scripts/` dir; `.mjs` so it can use `import` without touching
`package.json`'s CommonJS default — mirrors how `tests/*.js` opt into modules via the eslint override
at `.eslintrc.json:246-250`). The script:

1. Reads every `public/js/*.js` file and extracts **top-level** declarations — declaration regexes
   anchored to column 0 so nested/inner declarations are ignored:
   - `^function <name>` **and** `^async function <name>` (the 12 async functions at e.g.
     `network.js:9` `generateNewSession`, `mp-client.js:22` `claimSlot`, `leaderboard.js:109`
     `submitGlobalScore` are easy to miss — a naive `^function ` regex drops all 12, so the script
     **must** match `^(async )?function`).
   - `^(let|const|var) <name>` including **comma-lists** — expand `let app, database, firestore,
     analytics;` into four names and `let canvas, ctx, gameLoop;` into three (stop at `=` or `;`).
2. Reads the `globals` block of `.eslintrc.json` (parse the JSON; read `.globals` keys — robust,
   no brittle line-slicing).
3. Computes two diffs against an `EXTERNALS` allowlist (`firebase`, `QRious`):
   - **declared but not in `globals`** → error (these would silently fail `no-undef` the moment a
     second file references them).
   - **in `globals` but neither declared nor an external** → error (dead/stale entry, or a typo).
4. Prints each offending symbol with a hint and `process.exit(1)` on any mismatch; exit `0` clean.
   Reuse the project's existing emoji-prefixed CI log style (`.github/workflows/deploy.yml:38-49`,
   `❌ … && exit 1`).

Add an npm script `"check:globals": "node scripts/check-globals.mjs"` and a new blocking step in
`deploy.yml` after **Lint** / before **Deploy** (alongside the existing "Quality Checks" `node
--check` pass at lines 38-49). Keep `EXTERNALS` documented inline so adding a CDN global later is a
one-line, reviewed change.

### 5.2 Centralized `hooks` registry

Introduce one declared object in `state.js` (loaded early; every later module can populate or read
it):

```js
// state.js — single late-binding contract. Later modules assign their entry on load;
// earlier modules call through hooks.* (a missing hook is a harmless no-op, same as today).
let hooks = { mpUi: null, mpNet: null, lobbyOverlay: null };
```

- `mp-ui.js` sets `hooks.mpUi = { renderMpRoundStart, updateMpScoreboard, renderMpEndScreen, … }`
  and `hooks.lobbyOverlay = getLobbyOverlayLines` on load.
- `mp-net.js` sets `hooks.mpNet = { mpSyncScoreOnEat, mpSyncElimination, publishMpResults,
  mpDesktopWantsRound, mpHandleDesktopStartKey }` on load.
- `mp-engine.js:244-262` `mpUiHook`/`mpNetHook` keep their **same call sites and signatures** but
  resolve `hooks.mpUi?.[name]` / `hooks.mpNet?.[name]` instead of `window[name]` — preserving the
  typeof-guarded no-op safety (so the file still "stands alone" for `tests/` and `node --check`).
- `game.js:76-77,520-521` swap `window.mpDesktopWantsRound` / `window.mpHandleDesktopStartKey` /
  `window.getLobbyOverlayLines` for `hooks.mpNet?.mpDesktopWantsRound` etc., removing the
  `window.`-dotted lookups that 8349613 introduced.

Add **one** new global to `.eslintrc.json` (`"hooks": "writable"`) and **remove** the per-hook
globals that become internal registry fields **only if** they are no longer referenced bare anywhere
(verify each with grep before deletion — several, e.g. `mpUiHook`, are still legitimately top-level
functions and must stay). This is the highest-risk edit; see §9. The check from §5.1 will *prove*
the eslintrc stayed consistent.

This touches the **multiplayer arena path only** (`gameState.mode === 'multi'`, plus the desktop
lobby overlay text). The **solo engine and both transports** (Firestore sessions + RTDB controllers,
and the localStorage fallback exercised by `tests/protocol.test.js`) are unaffected — `protocol.test.js`
loads `mp-*` files *not at all* (its `SCRIPTS` list at `protocol.test.js:24-27` omits them), so the
registry must default-initialize safely when `mp-ui.js`/`mp-net.js` never load.

### 5.3 JSDoc typedefs + `jsconfig.json`

- Add `@typedef` blocks above the construction sites:
  - `GameState` typedef above `createInitialGameState()` (`state.js:29`) documenting all 18 fields
    incl. `mode: 'solo'|'multi'`, `combo`, `mpResults`.
  - `Player` typedef above `createPlayer()` (`players.js:36`) — the 13 fields incl.
    `death: {cause,by,at}|null`.
  - `MpSession` / `MpClient` typedefs above the literals at `state.js:73` / `state.js:83`.
  - `MpResults` typedef above `endMultiplayerGame()` (`mp-engine.js:194`).
  - Annotate the globals with `/** @type {GameState} */` (on `gameState`), `/** @type {MpSession} */`
    etc. so the checker can flag field typos.
- Add `jsconfig.json` at repo root: `{ "compilerOptions": { "checkJs": true, "strict": false,
  "noEmit": true, "allowJs": true, "lib": ["dom","es2021"] }, "include": ["public/js/**/*.js"],
  "exclude": ["node_modules"] }`. This drives editor squiggles immediately and can be checked in CI
  later via `npx tsc -p jsconfig.json --noEmit` (TypeScript ships with the toolchain only if added;
  keep this step **non-blocking / informational** initially per §4). Reuse existing JSDoc style
  already present throughout (`logic.js`, `state.js`, `players.js` are already heavily `@param`/
  `@returns` annotated — this extends the same convention).

## 6. Acceptance criteria

- [ ] **Given** the current tree, **when** `node scripts/check-globals.mjs` runs, **then** it exits
      `0` and prints a success line (the repo is consistent today after any eslintrc edits in this PR).
- [ ] **Given** a top-level `function fooBar() {}` added to any `public/js/*.js` with **no** matching
      `globals` entry, **when** the check runs, **then** it exits non-zero and names `fooBar` as
      "declared but not listed".
- [ ] **Given** an `async function` added to a `public/js/*.js` with no `globals` entry, **when** the
      check runs, **then** it is detected (proves the regex matches `async function`, the 12-case gap).
- [ ] **Given** a comma-list decl like `let foo, bar;` where only `foo` is listed, **when** the check
      runs, **then** `bar` is reported (proves comma-list expansion).
- [ ] **Given** a `globals` key removed from `.eslintrc.json` whose symbol is still declared, **when**
      the check runs, **then** it fails naming that symbol as "listed but… " — wait, it's still
      declared, so it must fail as **declared-but-unlisted**; **and** a `globals` key whose symbol is
      **not** declared anywhere (and not in `EXTERNALS`) fails as "listed but not declared".
- [ ] **Given** `firebase` / `QRious` (in `globals`, never declared in `public/js`), **when** the
      check runs, **then** they do **not** trigger a failure (allowlist works).
- [ ] **Given** the `deploy.yml` step, **when** any push/PR to `master` runs CI, **then** the globals
      check runs and a drift fails the job **before** the Deploy step.
- [ ] **Given** the `hooks` registry, **when** a multiplayer round runs (≥2 players), **then** the
      scoreboard updates, food-eat sync fires, eliminations sync, and the end screen renders — i.e.
      every former `window[name]` / `window.<fn>` path now flows through `hooks.*` with identical
      behavior (verify via `python -m http.server` + Claude_Preview two-tab MP round).
- [ ] **Given** the desktop lobby (no game running), **when** ≥1 phone is in the lobby, **then** the
      QR-overlay text still shows the lobby lines (the `getLobbyOverlayLines` → `hooks.lobbyOverlay`
      swap), and falls back to the classic prompt with zero phones.
- [ ] **Given** `tests/protocol.test.js` (which never loads `mp-*.js`), **when** `vitest run` runs,
      **then** it passes unmodified — `hooks` default-initializes and no solo path dereferences a null
      hook.
- [ ] **Given** `jsconfig.json` open in an editor, **when** a field typo like `gameState.mpResult`
      (vs `mpResults`) is written, **then** the editor flags it; `jsconfig.json` does **not** alter
      runtime, lint output, or the deployed bundle.
- [ ] Guardrails: `.eslintrc.json` `globals` updated to match (and verified by the new check itself);
      `npm run lint` exits 0; `git ls-files 'public/js/*.js' | xargs -n1 node --check` passes;
      `npm test` (incl. `protocol.test.js` jsdom smoke) passes; **no PII or 6-digit session code**
      added to any log; `sw.js` `CACHE` bumped **only if** a shipped `public/` shell asset changed
      (typedefs are comments → no bump needed unless a `public/js/*.js` byte changes, which they do →
      bump `CACHE` since these files are cached shell assets).

## 7. Affected files

| File | Change |
| --- | --- |
| `scripts/check-globals.mjs` | **NEW.** ~40–60 line Node ESM script: extract top-level decls (incl. `async function` + comma-lists), diff vs `.eslintrc.json` globals with `EXTERNALS` allowlist, exit 1 on drift. |
| `jsconfig.json` | **NEW.** Permissive `checkJs:true`, `strict:false`, `noEmit:true`, `include: public/js/**/*.js`. No runtime impact. |
| `.github/workflows/deploy.yml` | Add blocking "Globals check" step (`node scripts/check-globals.mjs`) after Lint, before Deploy. Optional non-blocking `tsc --noEmit` step. |
| `package.json` | Add `"check:globals"` script (and optionally a `typecheck` script). |
| `.eslintrc.json` | **Globals bump.** Add `"hooks": "writable"`; reconcile any per-hook keys that become registry-internal (only if no longer referenced bare). The new check enforces consistency. |
| `public/js/state.js` | Add `let hooks = { mpUi:null, mpNet:null, lobbyOverlay:null }`; add `@typedef GameState`, `@typedef MpSession`, `@typedef MpClient` + `@type` annotations on the globals. |
| `public/js/mp-engine.js` | `mpUiHook`/`mpNetHook` resolve via `hooks.mpUi`/`hooks.mpNet` instead of `window[name]`; add `@typedef MpResults`. Call sites unchanged. |
| `public/js/players.js` | Add `@typedef Player` above `createPlayer()`; annotate factory return. |
| `public/js/game.js` | Swap `window.mpDesktopWantsRound` / `window.mpHandleDesktopStartKey` / `window.getLobbyOverlayLines` (lines 76-77, 520-521) for `hooks.mpNet?.*` / `hooks.lobbyOverlay`. |
| `public/js/mp-ui.js` | On load, register `hooks.mpUi = {…}` and `hooks.lobbyOverlay = getLobbyOverlayLines`. |
| `public/js/mp-net.js` | On load, register `hooks.mpNet = {…}` (incl. `mpDesktopWantsRound`, `mpHandleDesktopStartKey`). |
| `public/sw.js` | **Bump `const CACHE`** — `public/js/*.js` are cached shell assets and their bytes change. |

> Flags: **`.eslintrc.json` globals change — yes** (add `hooks`, reconcile hook keys; the new CI
> check validates the result). **`sw.js` `CACHE` bump — yes** (shipped JS shell assets change).

## 8. Dependencies & sequencing

- **Globals check (§5.1) lands first** (per the brief's `deps`). It is self-contained (new file +
  one CI step + npm script) and protects every subsequent change — including the eslintrc edits the
  `hooks` registry (§5.2) requires (initiative B1 / future roadmap work that adds top-level decls).
- **`hooks` registry (§5.2) second**, validated by the now-live check (any missed eslintrc
  reconciliation turns the build red instead of silent). Highest blast radius — see §9.
- **Typedefs + `jsconfig` (§5.3) last / parallel-safe** — comments + one config file, no behavior
  change, can land independently and is the lowest risk.
- Unblocks: makes *future* roadmap initiatives that add helpers safe-by-default (the check catches
  the eslintrc drift they would otherwise introduce).

## 9. Risks & mitigations

- **Global-scope / load-order minefield (the big one).** Re-routing late binding through `hooks`
  risks an ordering bug: `state.js` declares `hooks` early (good), but `mp-ui.js`/`mp-net.js` must
  have *run* before any `hooks.mpUi`/`hooks.mpNet` is read. Since reads only happen during an active
  multiplayer round (well after all `<script>`s load), this holds — **mitigation:** keep the
  typeof-guarded no-op semantics (`hooks.mpNet?.fn?.()`), so a null registry is harmless exactly as
  the current `typeof X === 'function'` guards are. Verify the lobby-overlay path (read during
  *render*, possibly before a round) explicitly.
- **`protocol.test.js` doesn't load `mp-*.js`.** If any solo/desktop path is changed to read
  `hooks.*`, the smoke test (which omits `mp-*`) could NPE. **Mitigation:** `hooks` default-init in
  `state.js` (always loaded) + null-safe access; the test list at `protocol.test.js:24-27` is the
  contract — don't add `mp-*` reads to solo paths.
- **eslintrc reconciliation is fiddly.** Removing a `globals` key that's still referenced bare
  elsewhere reintroduces `no-undef`. **Mitigation:** the §5.1 check is the safety net — run it
  locally-equivalent (CI) before merge; default to *keeping* a key (the check tolerates declared+listed)
  and only delete keys whose symbol is genuinely gone.
- **Check-script false positives on declaration parsing.** Edge forms (multiline declarators,
  `const x = function(){}`, IIFEs) could be mis-parsed. **Mitigation:** the tree currently uses only
  `^(async )?function name`, `^const/let/var name[, name]` and the 3 known comma-lists — write the
  regex to that reality, and the first CI run on the unchanged tree (after eslintrc edits) is the
  acceptance test that it's tuned correctly. Document `EXTERNALS` as the single escape hatch.
- **`jsconfig` surfacing pre-existing type noise.** With `checkJs` on, loose patterns may flag.
  **Mitigation:** `strict:false`, keep the `tsc` step **non-blocking/informational** this round (§4),
  so it never gates deploy until the tree is deliberately cleaned.
- **No local Node.** Can't run the new script locally. **Mitigation:** the script is plain Node with
  no deps; validate via a CI run (push to a branch / PR, which triggers the workflow on `pull_request`
  to `master` per `deploy.yml:6-7` — note PRs run CI but the Deploy step is push-only,
  `deploy.yml:52`, so a PR proves the check without shipping).

## 10. Verification / test plan

Given the no-local-Node, CI-bound constraint:

- **`node --check` / lint / vitest (CI, blocking).** Push a branch and open a PR to `master`: CI runs
  Lint + Unit tests + the syntax pass (`deploy.yml:32-49`) **and** the new globals check, with the
  Deploy step skipped (push-only). This is the primary proof for §5.1 and that §5.2 didn't break lint
  or `protocol.test.js`.
- **Self-test the check both ways (CI).** In the same PR, a throwaway commit that (a) adds an
  unlisted `async function`, and (b) removes a real `globals` key, must turn CI red naming both
  symbols; revert before merge. (Optionally add a tiny `tests/`-adjacent fixture, but a manual
  red-then-green on a scratch branch is sufficient and avoids coupling the check to vitest.)
- **`python -m http.server` + Claude_Preview (visual, two-tab).** For §5.2: serve `public/`,
  **unregister the SW + clear caches first** (network-first SW serves stale assets locally, per
  guardrails), open desktop tab + a `?session=` controller tab, run a **≥2-player** multiplayer round,
  and confirm: lobby chips render, round starts, scoreboard updates on eat, an elimination updates the
  board, and the end screen shows the winner — i.e. every former `window[...]`/`window.` hook still
  fires through `hooks.*`. Also confirm the **solo** path (1-player) and the **desktop lobby overlay
  text** with one phone present.
- **No Firebase rules touched** → no emulator / scratch-project step needed (this initiative changes
  no `firestore.rules` / `database.rules.json` and no Firestore/RTDB schema).
- **Editor check for §5.3.** Open the repo with `jsconfig.json`; introduce a deliberate field typo
  (`gameState.mpResult`) and confirm the squiggle, then confirm `npm run lint` / `node --check` /
  `vitest` are all unaffected by the typedef comments and the config.

## 11. Analytics & observability

Largely N/A — this is build-time/CI tooling with no user-facing surface, so **no new `trackEvent`
calls** are warranted, and adding telemetry to a multiplayer round would be out of scope. Two notes:

- The `hooks` re-routing must preserve the **existing** `trackEvent` calls inside the hooked
  functions (`mp_game_start`, `mp_elimination`, `mp_game_over` in `mp-engine.js:28,176,210`, and the
  sync-side events in `mp-net.js`) — verify in the Claude_Preview run that the funnel still fires
  (no event is dropped because a hook silently no-oped). This is a **regression guard**, not a new
  event.
- The CI globals-check failure is itself the observability signal — a red build with a named symbol
  is the intended "metric". Keep its output greppable (one symbol per line, clear prefix), and
  **never** print session codes or PII (the script only ever handles identifier names from source —
  no runtime data — so this is inherently safe, but state it in the script header).
