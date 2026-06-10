// ==========================================
// MULTIPLAYER PLAYERS — identity, colors, factories
// ==========================================
// The single source of truth for player slots, palettes, and per-player state.
// Everything is sized by gameConfig.maxPlayers, so changing that one number in
// config.js scales the whole multiplayer feature (palettes are pre-defined up
// to 6 players). Loaded after state.js; consumed by mp-engine.js / mp-ui.js.

// Six palettes, each {body, head, rgb}: a saturated body, a brighter head (the
// same pattern the solo snake uses, so glow rendering reads identically), and
// an "r, g, b" triplet for CSS rgba() vars. p1 IS the solo palette — a one-
// player round is pixel-identical to solo. All hues keep clear separation from
// each other and from the gold food (#ffcf4d) on the #0a0a0a board.
const PLAYER_COLORS = {
    p1: { body: '#19c3b2', head: '#7df9ff', rgb: '25, 195, 178' },   // teal / cyan (solo)
    p2: { body: '#ff7a45', head: '#ffb38a', rgb: '255, 122, 69' },   // coral / peach
    p3: { body: '#e052c8', head: '#f9a8ff', rgb: '224, 82, 200' },   // magenta / orchid
    p4: { body: '#8b5cf6', head: '#c4b5fd', rgb: '139, 92, 246' },   // violet / lavender
    p5: { body: '#84cc16', head: '#d9f99d', rgb: '132, 204, 22' },   // lime / mint
    p6: { body: '#0ea5e9', head: '#7dd3fc', rgb: '14, 165, 233' }    // sky / ice
};

// Active slot ids ('p1'..'pN'), derived from the single maxPlayers knob.
const PLAYER_SLOTS = Array.from(
    { length: gameConfig.maxPlayers },
    (_, i) => 'p' + (i + 1)
);

/**
 * Build one player's full per-round state.
 * @param {string} slot - 'p1'..'pN'.
 * @param {string} name - display name synced from the phone (already sanitized).
 * @param {number} playerCount - players this round (decides the spawn layout).
 * @returns {object}
 */
function createPlayer(slot, name, playerCount) {
    // Index from the slot id itself ('p3' -> 2), not PLAYER_SLOTS.indexOf — so a
    // roster larger than the current maxPlayers (e.g. a 6-player simulation, or a
    // later cap raise mid-session) still spawns correctly.
    const slotIndex = parseInt(slot.slice(1), 10) - 1;
    const pose = spawnPose(slotIndex, playerCount, gameConfig);
    return {
        slot: slot,
        name: name || 'Player ' + slot.slice(1),
        colors: PLAYER_COLORS[slot],
        snake: snakeFromPose(pose, 5, gameConfig.segmentSpacing),
        direction: pose.heading,
        targetDirection: pose.heading,
        baseSpeed: gameConfig.baseSpeed,
        currentSpeed: gameConfig.baseSpeed,
        score: 0,
        combo: 0,
        lastFoodTime: 0,
        joystickInput: { x: 0, y: 0 },
        alive: true,
        death: null // { cause: 'wall'|'self'|'bite', by: slot|null, at: epochMs }
    };
}

/**
 * Build a complete multiplayer gameState: start from the solo factory so every
 * solo field exists (inert), then layer the multiplayer mode on top.
 * @param {Array<{slot:string, name:string}>} roster - in slot order, length 1..maxPlayers.
 * @returns {object} a gameState ready for startMultiplayerGame().
 */
function createMultiplayerState(roster) {
    const base = createInitialGameState();
    base.mode = 'multi';
    base.players = roster.map((r) => createPlayer(r.slot, r.name, roster.length));
    base.mpResults = null; // filled by endMultiplayerGame()
    return base;
}

/** @returns {Array<object>} players still in the round. */
function alivePlayers() {
    return gameState.players.filter((p) => p.alive);
}

/** @returns {Array<Array<{x:number,y:number}>>} alive snakes (for generateFood). */
function aliveSnakes() {
    return alivePlayers().map((p) => p.snake);
}

/**
 * @param {string} slot
 * @returns {object|undefined}
 */
function getPlayerBySlot(slot) {
    return gameState.players.find((p) => p.slot === slot);
}
