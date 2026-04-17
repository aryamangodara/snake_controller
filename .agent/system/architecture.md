# Architecture

## Overview
This is a web-based Snake game using vanilla JavaScript and CSS, deployed via Firebase Hosting.

## Tech Stack
- Frontend: HTML5, CSS3, ES6+ JavaScript
- Backend/Infra: Firebase Hosting

## Directory Structure
- `public/`: The deployable static assets.
  - `public/css/`: Split CSS files (e.g., `desktop.css`, `mobile.css`, `style.css` which may import or represent older concatenated code).
  - `public/js/`: Modular JS (e.g., `controller.js`, `game.js`, `main.js`). Note that older iterations might strictly use `app.js`.
  - `public/index.html`: The entry point for the browser.
- `.firebase/`, `firebase.json`, `.firebaserc`: Standard Firebase project config.
- `.github/workflows/`: Contains automated deployment logic for Firebase upon pushing to `main`.

## Design Principles
1. **Separation of Concerns**: UI, Game Logic, and Input are meant to be separated into logical files (e.g. `css/*` and `js/*`).
2. **Event Driven**: Using native event listeners for keyboard movement (`controller.js`).
3. **Responsive**: We use media queries or specific stylesheets for desktop vs. mobile layouts.
