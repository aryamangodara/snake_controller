# Commit Guidelines

## Strategy
We employ standard descriptive commits indicating the specific system chunk changing.

## Format
```
<type>(<scope>): <short description>

[optional longer description explaining WHY]
```

**Types**:
- `feat`: A new feature for the game
- `fix`: Solving a bug (e.g. snake passing through walls)
- `refactor`: Structural codebase updates (e.g. splitting `app.js` into modules)
- `style`: Formatting, CSS updates, or minor UI tweaks.

## Pushing Code
Ensure local testing via the `workflows/local_dev.md` flow before pushing, as pushing triggers the GitHub Action automated deployment to Firebase.
