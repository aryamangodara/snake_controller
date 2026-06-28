// ==========================================
// GAME & SESSION STATE MANAGEMENT
// ==========================================

/**
 * Creates the initial snake body at the center of the board
 * @returns {Array} Array of coordinates representing the snake segments
 */
function createInitialSnake() {
    const centerX = gameConfig.boardSize.width / 2;
    const centerY = gameConfig.boardSize.height / 2;
    const spacing = gameConfig.segmentSpacing;
    
    return [
        { x: centerX, y: centerY },
        { x: centerX - spacing, y: centerY },
        { x: centerX - spacing * 2, y: centerY },
        { x: centerX - spacing * 3, y: centerY },
        { x: centerX - spacing * 4, y: centerY }
    ];
}

/**
 * @typedef {Object} GameStateObj
 * The whole solo/multiplayer game state. Named *Obj to not collide with the
 * `GameState` enum (config.js). Constructed by createInitialGameState() (solo)
 * and createMultiplayerState() (players.js) — keep this typedef in sync with both.
 * @property {Array<{x:number,y:number}>} snake - solo snake body (head first).
 * @property {number} direction - current heading, radians.
 * @property {number} targetDirection - joystick target heading, radians.
 * @property {number} baseSpeed - minimum constant speed.
 * @property {number} currentSpeed - base + input boost.
 * @property {{x:number,y:number}} food - current fruit position.
 * @property {number} score - solo score.
 * @property {boolean} gameRunning - rAF loop active.
 * @property {number} lastUpdateTime - perf timestamp of last frame.
 * @property {number} lastMoveTime - perf timestamp of last move step.
 * @property {string} currentState - one of GameState.* (config.js enum).
 * @property {{x:number,y:number}} joystickInput - last joystick vector.
 * @property {number} frameCount - frames elapsed this run.
 * @property {number} combo - current eat streak (drives the multiplier).
 * @property {number} lastFoodTime - timestamp of last food eaten (combo window).
 * @property {Array<number>} milestonesFired - score thresholds toasted this run.
 * @property {'solo'|'multi'} mode - every engine branch keys off this.
 * @property {Array<Player>} players - per-player state in multiplayer (empty in solo).
 * @property {MpResults|null} [mpResults] - set by endMultiplayerGame() (mp-engine.js).
 */

/**
 * Builds a fresh initial game state. The SINGLE construction site for the state
 * shape — used both for the boot-time global below and by restartGame() (game.js),
 * so a new field can never silently exist in one and not the other.
 * @returns {GameStateObj} A complete, fresh gameState object.
 */
function createInitialGameState() {
    return {
        snake: createInitialSnake(),
        direction: 0, // Current movement direction in radians
        targetDirection: 0, // Target direction from joystick input
        baseSpeed: gameConfig.baseSpeed, // Always moving at this minimum speed
        currentSpeed: gameConfig.baseSpeed, // Current total speed (base + input boost)
        food: {
            x: gameConfig.boardSize.width * 0.75,
            y: gameConfig.boardSize.height * 0.25
        },
        score: 0,
        gameRunning: false,
        lastUpdateTime: 0,
        lastMoveTime: 0, // For consistent smooth movement timing
        currentState: GameState.WAITING_FOR_START,
        joystickInput: { x: 0, y: 0 },
        frameCount: 0,
        combo: 0,          // Current eat streak (drives the score multiplier)
        lastFoodTime: 0,   // Timestamp of the last food eaten (for the combo window)
        milestonesFired: [], // score thresholds already toasted this run (reset each run)
        mode: 'solo',      // 'solo' | 'multi' — every engine branch keys off this
        players: []        // per-player state in multiplayer; inert (empty) in solo
    };
}

// Global game state - Enhanced for constant movement
/** @type {GameStateObj} */
let gameState = createInitialGameState();

// Enhanced session management with better error handling
let sessionManager = {
    currentSession: null,
    isDesktop: true,
    connectedSession: null,
    firebaseConnected: false,
    realtimeRef: null,
    firestoreUnsubscribe: null,
    lastJoystickUpdate: 0,
    connectionType: 'hybrid', // Modes: 'hybrid', 'localStorage'
    sessionReady: false, // Track if session is fully ready
    connectionRetries: 0
};

/**
 * @typedef {Object} MpSession
 * Desktop host side multiplayer session state (mp-net.js owns it).
 * @property {boolean} enabled - true once a multiplayer session is active.
 * @property {Set<string>} live - slots with a live RTDB controller child.
 * @property {Object<string,{x:number,y:number}>} inputs - slot -> last joystick vector.
 * @property {Object<string,number>} stamps - slot -> last-applied client Date.now() stamp.
 * @property {Object<string,Object>} roster - last-seen players map from the session doc.
 * @property {Array<string>} defeated - elimination order for the results write.
 */

// Multiplayer session state — desktop host side. Inert until a multiplayer
// session activates it (mp-net.js); plain literals only, so tests load clean.
/** @type {MpSession} */
let mpSession = {
    enabled: false,
    live: new Set(),   // slots with a live RTDB controller child
    inputs: {},        // slot -> last joystick {x, y}
    stamps: {},        // slot -> last-applied client Date.now() stamp (monotonic ordering + staleness coast)
    roster: {},        // last-seen players map from the session doc
    defeated: []       // elimination order accumulated for the results write
};

/**
 * @typedef {Object} MpClient
 * Phone side multiplayer client state (mp-client.js owns it).
 * @property {string|null} slot - claimed slot ('p1'..'pN') or null.
 * @property {string|null} token - per-session rejoin token (localStorage-backed).
 * @property {boolean} waiting - true while queued behind a round in progress.
 * @property {boolean} joining - re-entrancy guard around the claim transaction.
 * @property {Object|null} sessionDocRef - Firestore session doc ref.
 */

// Multiplayer client state — phone side. Inert until a phone joins a
// multiplayer session (mp-client.js).
/** @type {MpClient} */
let mpClient = {
    slot: null,        // claimed slot ('p1'..'pN') or null
    token: null,       // per-session rejoin token (localStorage-backed)
    waiting: false,    // true while queued behind a round in progress
    joining: false,    // re-entrancy guard around the claim transaction
    sessionDocRef: null
};

// Canvas drawing context variables
let canvas, ctx, gameLoop;

// Joystick state to handle mobile interactions with throttling
let joystickState = {
    isDragging: false,
    baseElement: null,
    handleElement: null,
    baseRect: null,
    maxDistance: 0,
    lastInputTime: 0,
    lastSentX: null,  // last {x,y} actually written downstream — change-gate ref (null = nothing sent yet)
    lastSentY: null
};
