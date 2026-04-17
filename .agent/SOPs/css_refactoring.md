# CSS Refactoring SOP

## Goal
To incrementally modularize monolithic `style.css` files into component or layout specific files, improving maintainability.

## Steps
1. **Identify Groups**: Review the old `app.js` or `style.css`. Identify discrete UI components (e.g., `#snakeCanvas`, `.leaderboard`, `.modal`).
2. **Extract Files**: Create separate files like `desktop.css` and `mobile.css` for media queries, or `.modal.css` for isolated UI chunks within `public/css`.
3. **Update Index**: When CSS files are separated, dynamically link them in `public/index.html` using `<link rel="stylesheet">`. Include order matters!
4. **Remove Dead Code**: Sweep for unused or overlapping selectors after extraction.
