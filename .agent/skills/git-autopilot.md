# Skill: Git Autopilot
**Description:** Analyzes uncommitted workspace changes, generates a semantic commit message, commits locally, and pushes to the current remote branch on GitHub.

## Goal
Automate the end-to-end version control flow from change detection to remote push.

## Instructions
1. **Analyze:** Run `git status` and `git diff` to see what has changed.
2. **Summarize:** Based on the code diff, generate a concise commit message following Conventional Commits (e.g., `feat:`, `fix:`, `docs:`).
3. **Stage:** Run `git add .` to stage all changes.
4. **Commit:** Execute `git commit -m "[Generated Message]"`.
5. **Push:** Identify the current branch using `git branch --show-current` and run `git push origin [branch-name]`.
6. **Verify:** Confirm the push was successful or report any merge conflicts.

## Constraints
- Do not push if there are merge conflicts.
- Do not use `git push --force`.
- If the workspace is clean, notify the user and stop.

## Example Trigger
"Push my changes" or "Sync workspace to GitHub"