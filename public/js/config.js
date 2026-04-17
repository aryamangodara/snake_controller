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

// Initialize Firebase with HYBRID approach: Realtime Database + Firestore
let app, database, firestore;
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
        console.log('🚀 Firebase initialized: Realtime DB + Firestore hybrid');
    } catch (error) {
        console.warn('Firebase initialization failed:', error);
        console.log('Running in offline mode with localStorage');
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
    speedIncrease: 0.1,   // Speed increment per food item
    maxSpeed: 5,          // Maximum allowed speed limit
    turnSpeed: 0.08,      // How fast the snake turns (radians)
    segmentSpacing: 15,   // Gap between snake segments
    wallMargin: 20,       // Distance from edge considering as wall
    minSelfCollisionSegments: 8, // Minimum segments before self-collision is possible
    
    // Optimization settings
    joystickThrottleMs: 50, // Limits joystick update frequency
    movementUpdateMs: 25,   // Frames per second interval
    
    // Connection settings
    connectionRetries: 5,
    retryDelayMs: 2000,
};

// Palette used for painting canvas elements
const colors = {
    background: "#0a0a0a",
    snake: "#ff1493",
    snakeHead: "#ff6b35",
    food: "#7209b7",
    border: "#333333",
    text: "#ffffff",
    accent: "#ff1493"
};

// Enum representing possible game states
const GameState = {
    WAITING_FOR_START: 'waiting_for_start',
    PLAYING: 'playing',
    GAME_OVER: 'game_over'
};
