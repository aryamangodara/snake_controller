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

// Global game state - Enhanced for constant movement
let gameState = {
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
    frameCount: 0
};

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
