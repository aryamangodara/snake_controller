# Vanilla JS Patterns

## Game Loop
The snake game utilizes `requestAnimationFrame` for a smooth game loop, but controls move speed via logic ticks.

## State Management
Prefer separating visual state (DOM rendering) from abstract state (e.g. `snakeCoords`, `foodCoords`, `score`).
1. `controller.js` handles keyboard UI inputs and maps them to abstract direction shifts.
2. `game.js` manages ticks, colliding logic, and scoring.
3. `main.js` bootstraps the system and handles pure DOM rendering of the board based on the game state.

## Modularization
Instead of one massive `app.js`, use ES modules (`import`/`export`) or explicitly load files in order in `index.html`. Do not rely on bundlers like Webpack or Vite unless required, to keep the project strictly vanilla.
