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
 * Builds a fresh initial game state. The SINGLE construction site for the state
 * shape — used both for the boot-time global below and by restartGame() (game.js),
 * so a new field can never silently exist in one and not the other.
 * @returns {object} A complete, fresh gameState object.
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
        mode: 'solo',      // 'solo' | 'multi' — every engine branch keys off this
        players: []        // per-player state in multiplayer; inert (empty) in solo
    };
}

// Global game state - Enhanced for constant movement
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

// Multiplayer session state — desktop host side. Inert until a multiplayer
// session activates it (mp-net.js); plain literals only, so tests load clean.
let mpSession = {
    enabled: false,
    live: new Set(),   // slots with a live RTDB controller child
    inputs: {},        // slot -> last joystick {x, y}
    roster: {},        // last-seen players map from the session doc
    defeated: []       // elimination order accumulated for the results write
};

// Multiplayer client state — phone side. Inert until a phone joins a
// multiplayer session (mp-client.js).
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
    lastInputTime: 0
};
