# Q1 · Fix the undefined --color-primary-rgb brand token

> **Tier** quick-win · **Focus** Polish · **Impact** High · **Effort** S (hours) · **Priority** 90/100
> **Status** `Not started` · **Depends on** none · **Part of** [Roadmap](./README.md)

## 1. Problem — what we're solving

The stylesheet references the RGB triple `--color-primary-rgb` in **43 places** across 5 CSS files
to build translucent brand-teal glows, shadows, borders, and gradients — but
`--color-primary-rgb` is **never defined**. Every reference is written defensively as
`rgba(var(--color-primary-rgb, var(--color-teal-500-rgb)), …)`, so the missing variable silently
falls through to the hardcoded light-mode `--color-teal-500-rgb` (`33, 128, 141`) **everywhere,
in every theme**.

Verified evidence:

- `--color-primary-rgb` is **defined 0 times** — grep over `public/css/variables.css` returns no
  matches; grep over all of `public/` returns 43 *usages* and no definitions.
- The 43 usages break down as: `public/css/desktop.css` (25), `public/css/mobile.css` (10),
  `public/css/leaderboard.css` (5), `public/css/base.css` (2), `public/css/multiplayer.css` (1).
- The semantic token it *should* track is defined at `public/css/variables.css:56`
  (`--color-primary: var(--color-teal-500)`, light) and re-pointed in three places:
  `variables.css:178` (`--color-primary: var(--color-teal-300)`, `prefers-color-scheme: dark`),
  `variables.css:223` (`[data-color-scheme="dark"]`), and `variables.css:232`
  (`[data-color-scheme="light"]`).
- Primitive RGB triples already exist: `--color-teal-500-rgb: 33, 128, 141` (`variables.css:32`)
  and `--color-teal-300-rgb: 50, 184, 198` (`variables.css:160`, defined **only** inside the
  dark-mode block today).

**Concrete consequence:** in dark mode `--color-primary` becomes teal-300 (`50, 184, 198`), but
because `--color-primary-rgb` is undefined, every glow/shadow/border-tint/gradient that *should*
match the primary color still renders with the light teal-500 triple. Representative breakages:
the board grid lines (`base.css:41-42`), the desktop title glow (`desktop.css:78`), the pulsing
game-board halo (`desktop.css:476-477`), the leaderboard medal glow (`leaderboard.css:112`), the
multiplayer winner banner (`multiplayer.css:108`), and the mobile connection ring
(`mobile.css:146`). The brand teal is subtly *wrong* in dark mode across the whole UI.

## 2. Why it matters

This is a **Polish** win that lifts perceived quality at near-zero cost and risk. The app's marquee
visual identity is the neon-teal glow; in dark mode (the default for most users via
`prefers-color-scheme`) that glow is currently rendered in the wrong shade, so the accent never
truly matches the buttons/text it sits beside. Tightening this makes the live demo
(https://go-console-84748.web.app/) look intentional and cohesive — directly supporting the
"push for real users" goal where first-impression polish converts curious visitors into players.
The fix also **retires 43 fallback expressions' worth of latent debt**: once the variable exists,
the fallbacks become harmless dead weight that can be cleaned up later without urgency.

## 3. Goals

- Define `--color-primary-rgb` so it resolves to the **same** teal as `--color-primary` in every
  theme context (light, `prefers-color-scheme: dark`, `[data-color-scheme="dark"]`,
  `[data-color-scheme="light"]`).
- In dark mode, all 43 glow/shadow/border/gradient usages render with the teal-300 triple
  (`50, 184, 198`), matching the dark `--color-primary`.
- In light mode, rendering is **unchanged** (still teal-500 `33, 128, 141`) — a pure no-op so
  there is zero light-mode regression risk.
- Verify the RGB triples are byte-exact against the existing teal hex/`rgba` primitives so the
  glow color and the solid `--color-primary` color are identical.

## 4. Non-goals

- **Not** removing or rewriting the 43 `var(--color-primary-rgb, var(--color-teal-500-rgb))`
  fallback expressions. They become harmless; a follow-up cleanup is explicitly out of scope here.
- **Not** touching any `.js` file, `index.html`, `firestore.rules`, `database.rules.json`, or
  `sw.js` shell assets.
- **Not** introducing a runtime theme toggle or new theming mechanism.
- **Not** auditing/renaming the other `*-rgb` tokens (e.g. `--color-success-rgb`) — only the
  missing `--color-primary-rgb` is in scope.
- **Not** changing any actual teal color value; this only adds a triple that mirrors an existing one.

## 5. Proposed solution

Add the `--color-primary-rgb` token to **`public/css/variables.css` only**, at each scope where
`--color-primary` is already (re)defined, mirroring the established `*-rgb` token convention
(e.g. `--color-success-rgb` at `variables.css:82` / `variables.css:208`, which already uses
`var(--color-teal-300-rgb)` in dark mode):

1. **`:root` (light, near line 32 / 70):** add `--color-primary-rgb: 33, 128, 141;`
   (= `--color-teal-500-rgb`, matching `--color-primary: var(--color-teal-500)` at line 56).
   Place it beside the existing primitive RGB block (`variables.css:30-39`) or the semantic RGB
   block (`variables.css:81-87`) for discoverability.

2. **`@media (prefers-color-scheme: dark)` `:root` (near line 178 / 208):** add
   `--color-primary-rgb: var(--color-teal-300-rgb);` (resolves to `50, 184, 198`, matching
   `--color-primary: var(--color-teal-300)` at line 178). `--color-teal-300-rgb` is already
   declared in this block at `variables.css:160`, so the `var()` reference is in scope — this
   matches exactly how `--color-success-rgb` is set at `variables.css:208`.

3. **`[data-color-scheme="dark"]` (near line 223):** add `--color-primary-rgb: 50, 184, 198;`.
   Use the **literal triple** here (not `var(--color-teal-300-rgb)`) because `--color-teal-300-rgb`
   is currently scoped inside the `@media` block and is **not** guaranteed defined under the
   data-attribute override — using the literal keeps this self-contained, matching how this block
   already redeclares `--color-surface-rgb: 38, 40, 40;` literally at `variables.css:224`.

4. **`[data-color-scheme="light"]` (near line 232):** add `--color-primary-rgb: 33, 128, 141;`
   (literal), mirroring the literal `--color-surface-rgb: 255, 255, 253;` at `variables.css:233`.

**Triple verification (must match the primitives byte-for-byte):**

- Light: `--color-teal-500 = rgba(33, 128, 141, 1)` (`variables.css:21`) ⇒ triple `33, 128, 141`
  (identical to `--color-teal-500-rgb`, `variables.css:32`). ✔
- Dark: `--color-teal-300 = rgba(50, 184, 198, 1)` (`variables.css:19`) ⇒ triple `50, 184, 198`
  (identical to `--color-teal-300-rgb`, `variables.css:160`). ✔

Because `variables.css` is the **first** stylesheet loaded (`index.html:9`, before
`base.css`/`desktop.css`/`mobile.css`/`leaderboard.css`/`multiplayer.css`), the new token is
defined before any consumer cascades over it. No load-order change is required; the existing
fallbacks guarantee correctness even if a context is somehow missed.

**Both-transports / both-modes note:** this is presentation-only CSS. It touches neither the
Firestore/RTDB nor the localStorage transport, and neither the solo (`game.js`) nor the multi
(`mp-*.js`) engine logic. The multiplayer winner-banner glow (`multiplayer.css:108`) and the solo
desktop board halo (`desktop.css:476-477`) both benefit automatically since they already reference
the token.

## 6. Acceptance criteria

- [ ] **Given** the light theme (`:root` defaults / `[data-color-scheme="light"]`), **When** the
  page renders, **Then** `getComputedStyle(document.documentElement).getPropertyValue('--color-primary-rgb').trim()`
  equals `33, 128, 141` (or `33,128,141`).
- [ ] **Given** dark mode (`prefers-color-scheme: dark` **or** `[data-color-scheme="dark"]`),
  **When** the page renders, **Then** the computed `--color-primary-rgb` resolves to `50, 184, 198`.
- [ ] **Given** any of the 43 existing `rgba(var(--color-primary-rgb, …), α)` usages in dark mode,
  **When** rendered, **Then** the glow/border/gradient color matches the solid `--color-primary`
  (teal-300), not the old teal-500 — verifiable by sampling e.g. the desktop title glow
  (`desktop.css:78`) or board halo (`desktop.css:476`).
- [ ] **Negative (no light-mode regression):** **Given** the light theme, **When** rendered,
  **Then** all 43 usages render **identically** to before this change (still `33, 128, 141`).
- [ ] `--color-primary-rgb` is defined in **all four** scopes: `:root`, the `@media (prefers-color-scheme: dark)` `:root`, `[data-color-scheme="dark"]`, and `[data-color-scheme="light"]`.
- [ ] The dark `@media` definition uses `var(--color-teal-300-rgb)`; the two `[data-color-scheme]`
  definitions use literal triples (since `--color-teal-300-rgb` is not in their scope).
- [ ] No `.js`, `index.html`, rules files, or `sw.js` were modified; **no `sw.js` `CACHE` bump
  needed** (no shell asset filename changed — `variables.css` is edited in place, and the SW is
  network-first so online users get fresh CSS).
- [ ] **No `.eslintrc.json` globals change** — no JS top-level declaration added/renamed/removed.
- [ ] No PII and no 6-digit session code introduced (CSS-only change; trivially satisfied).
- [ ] CI green: `npm run lint`, `npm test` (Vitest), and the `node --check` syntax pass all succeed
  (none exercise CSS directly, so they must remain passing/unaffected).

## 7. Affected files

| File | Change |
| --- | --- |
| `public/css/variables.css` | Add `--color-primary-rgb` in `:root` (`33, 128, 141`), in the `@media (prefers-color-scheme: dark)` `:root` (`var(--color-teal-300-rgb)`), in `[data-color-scheme="dark"]` (literal `50, 184, 198`), and in `[data-color-scheme="light"]` (literal `33, 128, 141`). ~4 lines added. |

- `.eslintrc.json` globals: **no change** (no JS globals touched).
- `sw.js` `CACHE`: **no bump required** (no shell-asset filename change; network-first SW serves
  fresh CSS to online users). If the team's convention is to bump on *any* shell edit, bump
  `const CACHE` in `sw.js` as a belt-and-suspenders step — note this is the only thing that would
  require a `CACHE` bump.
- No new files.

## 8. Dependencies & sequencing

- **Depends on:** none. Self-contained, additive CSS.
- **Unblocks / enables:** a future cleanup that strips the now-redundant
  `var(--color-primary-rgb, var(--color-teal-500-rgb))` fallbacks down to plain
  `var(--color-primary-rgb)` across the 5 files (out of scope here). Also unblocks any future
  dark-mode polish work that relies on the accent glow being theme-correct.

## 9. Risks & mitigations

- **Risk: wrong RGB triple** (glow color drifts from the solid primary). **Mitigation:** triples
  are copied verbatim from the existing verified primitives — `33, 128, 141` from
  `variables.css:21/32`, `50, 184, 198` from `variables.css:19/160`. Acceptance criteria assert
  computed-style equality.
- **Risk: `var(--color-teal-300-rgb)` undefined in `[data-color-scheme]` scope** (it's declared
  only inside the `@media` block). **Mitigation:** the two data-attribute overrides use **literal
  triples**, not the `var()` reference, exactly as those blocks already do for `--color-surface-rgb`.
- **Risk: global-scope / load-order minefield.** **Mitigation:** N/A in the dangerous sense — this
  is CSS custom properties, not JS globals. `variables.css` loads first (`index.html:9`), and the
  43 consumers retain their fallbacks, so even a missed scope degrades gracefully to today's
  behavior rather than breaking.
- **Risk: stale CSS via the service worker on already-installed PWAs.** **Mitigation:** SW is
  network-first, so online users get the new CSS on next load; a single reload refreshes an
  installed SW. Local verification requires unregistering the SW + clearing caches (per project
  gotchas).
- **Risk: scope creep into removing fallbacks.** **Mitigation:** explicitly a non-goal (§4).

## 10. Verification / test plan

Given the no-local-Node, CI-bound constraint, this CSS-only change is verified primarily by the
visual harness plus CI's existing gates:

1. **`node --check` / lint / Vitest (CI):** push the branch; confirm the blocking CI jobs stay
   green. None parse CSS, so they should be unaffected — their job here is to prove nothing else
   regressed. (No rules emulator needed; `firestore.rules`/`database.rules.json` untouched.)
2. **`python -m http.server` + Claude_Preview (visual proof):** serve `public/`, **unregister the
   SW and clear caches first** (network-first SW serves stale assets locally). Then:
   - Force dark mode and read the token:
     `mcp__Claude_Preview__preview_eval` running
     `getComputedStyle(document.documentElement).getPropertyValue('--color-primary-rgb')` after
     setting `document.documentElement.setAttribute('data-color-scheme','dark')` → expect
     `50, 184, 198`.
   - Repeat with `data-color-scheme="light"` → expect `33, 128, 141`.
   - Snapshot the desktop title glow (`desktop.css:78`) / board halo (`desktop.css:476-477`) and
     the mobile connection ring (`mobile.css:146`, append `?session=123456`) in dark vs light to
     confirm the glow now tracks the accent. Screenshots time out — prefer `preview_eval`
     computed-style reads as the authoritative check; use snapshots qualitatively.
3. **Light-mode no-regression:** confirm the light-theme computed value is byte-identical to the
   pre-change fallback (`33, 128, 141`), proving zero light-mode visual change.
4. **No scratch Firebase project required** — no rules/transport change.

## 11. Analytics & observability

N/A. This is a presentation-only token definition with no user-facing event, funnel step, or state
transition to instrument. It does not warrant a new `trackEvent()` call, and adding one would be
noise. (Existing analytics are untouched; `trackEvent` no-op/never-throw behavior is unaffected.)
