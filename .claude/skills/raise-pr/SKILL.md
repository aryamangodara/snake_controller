---
name: raise-pr
description: >-
  Open a high-quality pull request with the gh CLI, following this repo's
  conventions. Use this whenever the user wants to raise, open, create, or
  submit a PR / pull request — including phrasings like "push and open a PR",
  "put this up for review", "submit my branch", or "PR this" — even if they
  don't say the word "pull request" explicitly. It covers pre-flight checks,
  pushing the branch, writing a Conventional-Commits title, filling out the
  repo's PULL_REQUEST_TEMPLATE.md, reviewers via CODEOWNERS, and flagging
  deploy / Firebase-rule impact. Prefer this over a bare `gh pr create`.
---

# Raise a Pull Request

The goal is a PR a maintainer can approve with confidence: an accurate title, a
body that genuinely fills the repo's template (not stub placeholders), and
explicit flags for anything risky. The biggest risk in *this* repo is that
**merging to `master` auto-deploys via GitHub Actions** (`.github/workflows/deploy.yml`),
including Firebase Hosting **and** the Firestore/RTDB rules — so a careless merge
ships infrastructure, not just code.

Work top to bottom. Each step exists to prevent a specific way PRs go wrong;
skipping one usually means the reviewer (or production) finds the problem instead.

## 1. Pre-flight — catch problems now, not in review

- **Clean tree:** `git status --short`. Commit or stash stray changes so the PR
  reflects exactly what you intend.
- **There are commits to propose, and they're scoped:** `git log --oneline master..HEAD`.
- **Up to date with base:** `git fetch origin` then
  `git merge-base --is-ancestor origin/master HEAD` — if it reports the branch is
  behind, `git rebase origin/master` (resolve conflicts) so the diff is clean and
  the merge is trivial.
- **Quality gates:** run `npm run lint && npm test` if you can. If the toolchain
  isn't available locally (this machine often has **no Node** — see the
  `dev-environment` project memory), don't imply they passed: state plainly in the
  PR body what you did and didn't run. CI runs lint/tests too (currently
  non-blocking until first green — see `.github/workflows/deploy.yml`).
- **Self-review:** `git diff master...HEAD`. Read it as if you were the reviewer.

## 2. Push the branch

```bash
git push -u origin HEAD
```

`-u` sets upstream so later pushes are just `git push`. Branch names follow
CONTRIBUTING.md: `feature/…`, `bugfix/…`, `docs/…`, `refactor/…`.

## 3. Title — Conventional Commits

`type(scope): summary`, where type ∈ `feat | fix | refactor | style | docs |
test | chore` (`.agent/SOPs/commit_guidelines.md`). Imperative mood, ~70 chars
max, no trailing period. For a branch spanning several types, pick the dominant
type (or a clear umbrella) and enumerate the rest in the body.

**Example 1** — Input: one bugfix commit → Output: `fix(controller): stop joystick drift after touchend`
**Example 2** — Input: a feature branch with tests → Output: `feat(game): keyboard controls for desktop play`

## 4. Body — fill the template, don't stub it

This repo has `.github/PULL_REQUEST_TEMPLATE.md`. A reviewer's trust comes from a
body that is actually filled in. Start from that template, then: replace every
`<!-- comment -->` placeholder with real content, check the boxes that genuinely
apply, and **delete** sections/checklists that don't apply rather than leaving
them blank (an empty checklist reads as "untested"). Nail these in particular:

- **Description:** what changed and *why*, in a few sentences.
- **Type of Change:** check the real ones.
- **Testing:** exactly what you verified and how to reproduce — honest about what
  ran vs. didn't (e.g. "rules validated as JSON; not yet deployed to a scratch
  project").
- **Breaking Changes / Deployment Notes:** ⚠️ critical here. If the PR touches
  `firebase.json`, `database.rules.json`, `firestore.rules`, or `public/`, check
  the matching deployment box and spell out the impact — remember a merge to
  `master` deploys it. Rules ship via CI now (`--only hosting,firestore,database`).
- **Related Issues:** link with `Fixes #N` / `Closes #N` so the merge auto-closes
  them. If there's no issue, delete the `Fixes #(issue number)` line — don't leave
  the placeholder.

## 5. Reviewers

`CODEOWNERS` (`* @aryamangodara`) auto-requests review, so you normally don't pass
`--reviewer`. GitHub won't request review from the PR's own author — if you're
opening your own PR, that's expected, not a bug. Add `--reviewer <user>` only for
someone outside CODEOWNERS.

## 6. Draft vs. ready

- **Ready** (default): work is complete and verified; you want review now.
- **Draft** (`--draft`): functionally done but with a known follow-up a reviewer
  must weigh (e.g. security rules not yet tested against a real project), or you
  want early feedback. For risky infra changes, draft + a clear note is the
  considerate default when unsure.

## 7. Create the PR

Write the body to a file and pass `--body-file`. Do **not** inline a multi-line
`--body` string in PowerShell — embedded quotes get re-parsed and corrupt the
arguments (the same gotcha bites `git commit -m`; use a file there too).

```bash
gh pr create --base master --head <branch> --title "<title>" --body-file pr-body.md
# add --draft for a draft PR; add --reviewer <user> only for non-CODEOWNERS reviewers
```

Then delete the temp `pr-body.md`.

## 8. After opening

Report the PR **URL** and a one-line summary to the user. Mention they can watch
CI with `gh pr checks`. Do **not** merge unless explicitly asked — and remind that
merging to `master` deploys.
