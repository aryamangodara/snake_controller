// ==========================================
// CONFIGURATION & INITIALIZATION
// ==========================================

// Firebase Configuration Object
// Replace with your own project config if needed
const firebaseConfig = {
    apiKey: "AIzaSyAt8mVTh9N8zziPCSwhxxRbkcqh93CrNhI",
    authDomain: "go-console-84748.firebaseapp.com",
    databaseURL: "https://go-console-84748-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "go-console-84748",
    storageBucket: "go-console-84748.firebasestorage.app",
    messagingSenderId: "301266921160",
    appId: "1:301266921160:web:482979b81d409acd92a7fd",
    measurementId: "G-0DFSB38H21"
};

// Initialize Firebase with HYBRID approach: Realtime Database + Firestore.
// Assigned here, consumed by the other scripts in the shared global scope — ESLint
// lints each file alone, so it can't see those reads (/* exported */ would be the
// idiomatic fix, but it is ignored when env.node is enabled).
// eslint-disable-next-line no-unused-vars
let app, database, firestore, analytics;
// eslint-disable-next-line no-unused-vars
let firebaseReady = false;

/**
 * Initializes the Firebase app and sets up connections
 * to Realtime Database and Firestore.
 */
function initializeFirebase() {
    try {
        if (typeof firebase === 'undefined') {
            console.warn('Firebase not loaded yet, retrying...');
            setTimeout(initializeFirebase, 1000);
            return;
        }
        
        app = firebase.initializeApp(firebaseConfig);
        // Realtime Database for joystick input (Optimized for frequent small updates)
        database = firebase.database();
        // Firestore only for session management (Less frequent updates)
        firestore = firebase.firestore();
        firebaseReady = true;
        // Analytics (GA4). Its own try/catch so an analytics failure (adblock, unsupported
        // env) never falls into the outer catch and drops gameplay into offline mode.
        try {
            analytics = firebase.analytics();
        } catch (e) {
            console.warn('Analytics unavailable:', e);
        }
        debugLog('🚀 Firebase initialized: Realtime DB + Firestore hybrid');
    } catch (error) {
        console.warn('Firebase initialization failed:', error);
        debugLog('Running in offline mode with localStorage');
    }
}

// Try to initialize Firebase immediately, otherwise retry after 2 seconds
if (typeof firebase !== 'undefined') {
    initializeFirebase();
} else {
    setTimeout(initializeFirebase, 2000);
}

// ==========================================
// GAME CONSTANTS
// ==========================================

// Main game configuration parameters
const gameConfig = {
    boardSize: { width: 600, height: 600 },
    snakeSegmentSize: 12,
    foodSize: 8,
    baseSpeed: 2.0,       // Minimum constant speed
    maxSpeedBoost: 1.5,   // Speed added when joystick is fully angled
    speedIncrease: 0.06,  // Speed increment per food item (gentle ramp = a flow curve, not a sprint)
    maxSpeed: 4,          // Maximum allowed speed limit (kept controllable alongside turn coupling)
    turnSpeed: 0.13,      // Base turn step per 60fps frame (radians); crisper than the old 0.08
    maxTurnSpeedFactor: 2.2, // Cap on how much faster turning scales with speed (keeps turn radius ~constant)
    segmentSpacing: 15,   // Gap between snake segments
    wallMargin: 20,       // Distance from edge considering as wall
    minSelfCollisionSegments: 8, // Minimum segments before self-collision is possible

    // Combo / streak scoring
    comboWindowMs: 4500, // Eat again within this window to extend the streak
    maxCombo: 6,         // Cap on the score multiplier

    // Optimization settings
    joystickThrottleMs: 33, // Limits joystick update frequency (~30Hz for snappier phone input)
    movementUpdateMs: 25,   // Frames per second interval
    
    // Connection settings
    connectionRetries: 5,
    retryDelayMs: 2000,
};

// Palette used for painting canvas elements. Aligned with the teal brand tokens in
// css/variables.css so the board and the UI chrome read as one cohesive design, with
// a warm gold food as the high-contrast pop (also matches the "new high score" gold).
const colors = {
    background: "#0a0a0a",
    snake: "#19c3b2",      // teal body — matches the brand teal UI
    snakeHead: "#7df9ff",  // bright cyan head leads the body
    food: "#ffcf4d",       // warm gold pop, high contrast against the teal snake
    border: "#333333",
    text: "#ffffff",
    accent: "#22d3c5"      // teal accent
};

// Enum representing possible game states
const GameState = {
    WAITING_FOR_START: 'waiting_for_start',
    PLAYING: 'playing',
    GAME_OVER: 'game_over'
};
