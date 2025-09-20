// Firebase Configuration
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

function initializeFirebase() {
    try {
        if (typeof firebase === 'undefined') {
            console.warn('Firebase not loaded yet, retrying...');
            setTimeout(initializeFirebase, 1000);
            return;
        }
        
        app = firebase.initializeApp(firebaseConfig);
        // Realtime Database for joystick input (FREE - unlimited operations)
        database = firebase.database();
        // Firestore only for session management (minimal operations)
        firestore = firebase.firestore();
        firebaseReady = true;
        console.log('🚀 Firebase initialized: Realtime DB + Firestore hybrid');
    } catch (error) {
        console.warn('Firebase initialization failed:', error);
        console.log('Running in offline mode with localStorage');
    }
}

if (typeof firebase !== 'undefined') {
    initializeFirebase();
} else {
    setTimeout(initializeFirebase, 2000);
}

// Game configuration - Enhanced for constant movement
const gameConfig = {
    boardSize: { width: 600, height: 600 },
    snakeSegmentSize: 12,
    foodSize: 8,
    baseSpeed: 2.0, // CONSTANT minimum speed - snake never stops
    maxSpeedBoost: 1.5, // Additional speed when joystick is pushed fully
    speedIncrease: 0.1, // Speed increase per food
    maxSpeed: 5,
    turnSpeed: 0.08, // Smooth turning
    segmentSpacing: 15,
    wallMargin: 20,
    minSelfCollisionSegments: 8,
    // Optimization settings
    joystickThrottleMs: 50, // 20 updates per second max
    movementUpdateMs: 25, // 40 FPS movement updates
    // Connection settings
    connectionRetries: 5,
    retryDelayMs: 2000,
};

const colors = {
    background: "#0a0a0a",
    snake: "#ff1493",
    snakeHead: "#ff6b35",
    food: "#7209b7",
    border: "#333333",
    text: "#ffffff",
    accent: "#ff1493"
};

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

const GameState = {
    WAITING_FOR_START: 'waiting_for_start',
    PLAYING: 'playing',
    GAME_OVER: 'game_over'
};

// Global game state - Enhanced for constant movement
let gameState = {
    snake: createInitialSnake(),
    direction: 0, // Current movement direction
    targetDirection: 0, // Target direction from joystick
    baseSpeed: gameConfig.baseSpeed, // Always moving at this minimum speed
    currentSpeed: gameConfig.baseSpeed, // Current total speed
    food: { 
        x: gameConfig.boardSize.width * 0.75, 
        y: gameConfig.boardSize.height * 0.25 
    },
    score: 0,
    gameRunning: false,
    lastUpdateTime: 0,
    lastMoveTime: 0, // For consistent movement timing
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
    connectionType: 'hybrid', // hybrid, localStorage
    sessionReady: false, // Track if session is fully ready
    connectionRetries: 0
};

let canvas, ctx, gameLoop;

// Joystick state for mobile with throttling
let joystickState = {
    isDragging: false,
    baseElement: null,
    handleElement: null,
    baseRect: null,
    maxDistance: 0,
    lastInputTime: 0
};

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM loaded, initializing app...');
    detectDevice();
    setTimeout(initializeApp, 1000);
});

function detectDevice() {
    const isMobile = window.innerWidth <= 768;
    sessionManager.isDesktop = !isMobile;
    
    console.log('Device detected:', sessionManager.isDesktop ? 'Desktop' : 'Mobile');
    
    const desktopView = document.getElementById('desktop-view');
    const mobileView = document.getElementById('mobile-view');
    
    if (sessionManager.isDesktop) {
        if (desktopView) desktopView.style.display = 'block';
        if (mobileView) mobileView.style.display = 'none';
    } else {
        if (desktopView) desktopView.style.display = 'none';
        if (mobileView) mobileView.style.display = 'block';
    }
}

function initializeApp() {
    if (sessionManager.isDesktop) {
        initializeDesktopGame();
    } else {
        initializeMobileController();
    }
}

// Desktop Game Functions
function initializeDesktopGame() {
    console.log('Initializing desktop game...');
    
    canvas = document.getElementById('game-canvas');
    if (!canvas) {
        console.error('Game canvas not found!');
        return;
    }
    
    ctx = canvas.getContext('2d');
    canvas.width = gameConfig.boardSize.width;
    canvas.height = gameConfig.boardSize.height;
    
    generateNewSession();
    startGameLoop();
}

function generateNewSession() {
    const sessionCode = Math.floor(100000 + Math.random() * 900000).toString();
    sessionManager.currentSession = sessionCode;
    
    console.log('🎮 Generated session code:', sessionCode);
    
    const sessionCodeElement = document.getElementById('session-code');
    if (sessionCodeElement) {
        sessionCodeElement.textContent = sessionCode;
    }
    
    generateQRCode(sessionCode);
    
    if (firebaseReady) {
        setupRobustHybridSession(sessionCode);
    } else {
        setupLocalStorageSession(sessionCode);
    }
}

// ROBUST HYBRID SESSION with better error handling
async function setupRobustHybridSession(sessionCode) {
    try {
        sessionManager.connectionType = 'hybrid';
        console.log('🔥 Setting up robust hybrid session...');
        
        // Wait for Firestore to be ready
        await waitForFirebaseReady();
        
        // 1. Create session in Firestore with detailed logging
        const sessionDoc = firestore.collection('sessions').doc(sessionCode);
        
        console.log('📝 Creating session document in Firestore...');
        await sessionDoc.set({
            created: firebase.firestore.FieldValue.serverTimestamp(),
            connected: false,
            gameState: {
                active: true,
                score: 0,
                state: GameState.WAITING_FOR_START
            },
            lastActivity: firebase.firestore.FieldValue.serverTimestamp(),
            version: Date.now() // Add version for debugging
        });
        
        console.log('✅ Session document created successfully in Firestore');
        
        // 2. Verify session was created by reading it back
        const verification = await sessionDoc.get();
        if (!verification.exists) {
            throw new Error('Session verification failed - document not found after creation');
        }
        console.log('✅ Session verified in Firestore:', verification.data());
        
        // 3. Set up Realtime Database path
        sessionManager.realtimeRef = database.ref(`controllers/${sessionCode}`);
        console.log('📡 Setting up Realtime Database path...');
        
        // Initialize Realtime Database path
        await sessionManager.realtimeRef.set({
            connected: false,
            joystick: { x: 0, y: 0 },
            timestamp: firebase.database.ServerValue.TIMESTAMP,
            initialized: true
        });
        console.log('✅ Realtime Database path initialized');
        
        // 4. Listen for Realtime Database changes
        sessionManager.realtimeRef.on('value', (snapshot) => {
            const controllerData = snapshot.val();
            if (controllerData && controllerData.connected) {
                handleJoystickInputFromMobile(controllerData.joystick || { x: 0, y: 0 });
                updateConnectionStatus('Mobile controller connected ✅');
            }
        });
        
        // 5. Listen to Firestore for game actions
        sessionManager.firestoreUnsubscribe = sessionDoc.onSnapshot((doc) => {
            if (doc.exists) {
                const data = doc.data();
                if (data.gameAction) {
                    console.log('📱 Game action received:', data.gameAction);
                    handleGameActionFromMobile(data.gameAction);
                    // Clear action immediately
                    sessionDoc.update({ 
                        gameAction: null,
                        lastActivity: firebase.firestore.FieldValue.serverTimestamp()
                    }).catch(err => console.error('Error clearing game action:', err));
                }
            }
        });
        
        sessionManager.firebaseConnected = true;
        sessionManager.sessionReady = true;
        console.log('🚀 Hybrid session fully ready! Mobile can now connect.');
        updateConnectionStatus('Waiting for mobile controller...');
        
    } catch (error) {
        console.error('❌ Hybrid session setup failed:', error);
        console.log('🔄 Falling back to localStorage...');
        setupLocalStorageSession(sessionCode);
    }
}

// Wait for Firebase to be ready
function waitForFirebaseReady() {
    return new Promise((resolve, reject) => {
        if (firebaseReady && firestore) {
            resolve();
            return;
        }
        
        let attempts = 0;
        const checkReady = () => {
            attempts++;
            if (firebaseReady && firestore) {
                resolve();
            } else if (attempts > 10) {
                reject(new Error('Firebase initialization timeout'));
            } else {
                setTimeout(checkReady, 500);
            }
        };
        
        checkReady();
    });
}

function setupLocalStorageSession(sessionCode) {
    console.log('📱 Using localStorage fallback for session:', sessionCode);
    sessionManager.connectionType = 'localStorage';
    
    localStorage.setItem('currentSession', sessionCode);
    localStorage.setItem(`session_${sessionCode}_state`, JSON.stringify({
        state: GameState.WAITING_FOR_START,
        score: 0,
        ready: true
    }));
    
    // Listen for localStorage changes
    window.addEventListener('storage', function(e) {
        if (e.key === `session_${sessionCode}_joystick`) {
            const data = JSON.parse(e.newValue || '{}');
            if (data.joystick) {
                handleJoystickInputFromMobile(data.joystick);
                updateConnectionStatus('Mobile controller connected (localStorage) ✅');
            }
        } else if (e.key === `session_${sessionCode}_action`) {
            const data = JSON.parse(e.newValue || '{}');
            if (data.action) {
                handleGameActionFromMobile(data.action);
                localStorage.removeItem(`session_${sessionCode}_action`);
            }
        }
    });
    
    sessionManager.sessionReady = true;
    updateConnectionStatus('Waiting for mobile controller (localStorage mode)...');
}

function generateQRCode(sessionCode) {
    const qrContainer = document.getElementById('qr-code-container');
    const qrCanvas = document.getElementById('qr-canvas');
    const qrLoading = document.getElementById('qr-loading');
    
    if (!qrContainer) return;
    
    if (qrLoading) qrLoading.style.display = 'flex';
    if (qrContainer) qrContainer.style.display = 'none';
    
    const gameUrl = `${window.location.origin}${window.location.pathname}?session=${sessionCode}`;
    
    let qrGenerated = false;
    
    if (typeof QRious !== 'undefined') {
        try {
            const qr = new QRious({
                element: qrCanvas,
                value: gameUrl,
                size: 150,
                foreground: '#000000',
                background: '#ffffff'
            });
            qrGenerated = true;
            
            if (qrLoading) qrLoading.style.display = 'none';
            if (qrContainer) qrContainer.style.display = 'block';
            
        } catch (error) {
            console.error('QRious failed:', error);
        }
    }
    
    if (!qrGenerated) {
        setTimeout(() => {
            drawPlaceholderQR(qrCanvas, sessionCode);
            if (qrLoading) qrLoading.style.display = 'none';
            if (qrContainer) qrContainer.style.display = 'block';
        }, 1000);
    }
}

function drawPlaceholderQR(canvas, sessionCode) {
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 150, 150);
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.strokeRect(5, 5, 140, 140);
    ctx.fillStyle = '#000000';
    
    // QR corners
    [[15, 15], [110, 15], [15, 110]].forEach(([x, y]) => {
        ctx.fillRect(x, y, 25, 25);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x + 5, y + 5, 15, 15);
        ctx.fillStyle = '#000000';
        ctx.fillRect(x + 8, y + 8, 9, 9);
    });
    
    // Random pattern
    for (let i = 0; i < 20; i++) {
        const x = Math.floor(Math.random() * 100) + 25;
        const y = Math.floor(Math.random() * 100) + 25;
        ctx.fillRect(x, y, 3, 3);
    }
    
    ctx.font = 'bold 10px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('SCAN QR', 75, 60);
    ctx.font = '8px Arial';
    ctx.fillText(`Code: ${sessionCode}`, 75, 75);
}

function handleJoystickInputFromMobile(joystickInput) {
    if (gameState.currentState === GameState.PLAYING) {
        gameState.joystickInput = joystickInput;
        
        // Calculate direction and speed from joystick
        const magnitude = Math.sqrt(joystickInput.x * joystickInput.x + joystickInput.y * joystickInput.y);
        
        if (magnitude > 0.1) {
            // Update target direction based on joystick
            gameState.targetDirection = Math.atan2(joystickInput.y, joystickInput.x);
            
            // Speed boost based on joystick magnitude
            const speedBoost = Math.min(magnitude, 1) * gameConfig.maxSpeedBoost;
            gameState.currentSpeed = gameState.baseSpeed + speedBoost;
        } else {
            // No joystick input - snake moves at constant base speed
            gameState.currentSpeed = gameState.baseSpeed;
        }
    }
}

function handleGameActionFromMobile(action) {
    console.log('🎮 Handling game action:', action);
    
    if (action === 'start' && gameState.currentState === GameState.WAITING_FOR_START) {
        startGame();
    } else if (action === 'restart' && gameState.currentState === GameState.GAME_OVER) {
        restartGame();
    }
}

function startGameLoop() {
    console.log('🎮 Starting game loop with constant movement...');
    gameState.gameRunning = true;
    gameState.lastUpdateTime = performance.now();
    gameState.lastMoveTime = performance.now();
    
    generateFood();
    gameLoop = requestAnimationFrame(updateGame);
    renderGame();
}

function startGame() {
    console.log('🚀 Starting game with continuous snake movement!');
    gameState.currentState = GameState.PLAYING;
    gameState.direction = 0; // Start facing right
    gameState.targetDirection = 0;
    gameState.baseSpeed = gameConfig.baseSpeed;
    gameState.currentSpeed = gameConfig.baseSpeed;
    gameState.joystickInput = { x: 0, y: 0 };
    gameState.frameCount = 0;
    gameState.lastMoveTime = performance.now();
    
    const gameOverScreen = document.getElementById('game-over');
    if (gameOverScreen) {
        gameOverScreen.classList.add('hidden');
    }
    
    updateGameStateInFirebase();
}

function updateGame(currentTime) {
    if (!gameState.gameRunning) return;
    
    const deltaTime = currentTime - gameState.lastUpdateTime;
    const moveDeltaTime = currentTime - gameState.lastMoveTime;
    
    if (gameState.currentState === GameState.PLAYING) {
        // Always update direction smoothly
        updateSnakeDirection();
        
        // CONSTANT MOVEMENT: Snake moves every frame regardless of joystick input
        if (moveDeltaTime >= gameConfig.movementUpdateMs) {
            moveSnake();
            gameState.lastMoveTime = currentTime;
        }
        
        gameState.frameCount++;
    }
    
    renderGame();
    gameState.lastUpdateTime = currentTime;
    
    if (gameState.gameRunning) {
        gameLoop = requestAnimationFrame(updateGame);
    }
}

function updateSnakeDirection() {
    // Smooth direction interpolation towards target
    let angleDiff = gameState.targetDirection - gameState.direction;
    
    // Normalize angle difference to [-π, π]
    while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
    while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
    
    // Apply smooth turning
    if (Math.abs(angleDiff) > gameConfig.turnSpeed) {
        gameState.direction += Math.sign(angleDiff) * gameConfig.turnSpeed;
    } else {
        gameState.direction = gameState.targetDirection;
    }
    
    // Normalize direction to [0, 2π]
    while (gameState.direction < 0) gameState.direction += 2 * Math.PI;
    while (gameState.direction >= 2 * Math.PI) gameState.direction -= 2 * Math.PI;
}

// ENHANCED MOVEMENT: Snake ALWAYS moves forward
function moveSnake() {
    if (gameState.snake.length === 0) return;
    
    const prevHead = { ...gameState.snake[0] };
    const head = { ...gameState.snake[0] };
    
    // CONSTANT MOVEMENT: Always move at current speed in current direction
    head.x += Math.cos(gameState.direction) * gameState.currentSpeed;
    head.y += Math.sin(gameState.direction) * gameState.currentSpeed;
    
    // Wall collision detection
    if (head.x < gameConfig.wallMargin || 
        head.x > gameConfig.boardSize.width - gameConfig.wallMargin ||
        head.y < gameConfig.wallMargin || 
        head.y > gameConfig.boardSize.height - gameConfig.wallMargin) {
        console.log('💥 Wall collision!');
        gameOver();
        return;
    }
    
    // Self collision detection
    for (let i = gameConfig.minSelfCollisionSegments; i < gameState.snake.length; i++) {
        const segment = gameState.snake[i];
        const distance = Math.sqrt(
            Math.pow(head.x - segment.x, 2) + Math.pow(head.y - segment.y, 2)
        );
        if (distance < gameConfig.snakeSegmentSize * 0.8) {
            console.log('💥 Self collision!');
            gameOver();
            return;
        }
    }
    
    // Update head position
    gameState.snake[0] = head;
    updateSnakeSegments(prevHead);
    
    // Food collision detection
    const foodDistance = Math.sqrt(
        Math.pow(head.x - gameState.food.x, 2) + Math.pow(head.y - gameState.food.y, 2)
    );
    
    if (foodDistance < (gameConfig.snakeSegmentSize + gameConfig.foodSize)) {
        console.log('🍎 Food collected! Score:', gameState.score + 10);
        gameState.score += 10;
        updateScore();
        generateFood();
        addSnakeSegment();
        
        // Increase base speed gradually
        if (gameState.baseSpeed < gameConfig.maxSpeed) {
            gameState.baseSpeed = Math.min(gameConfig.maxSpeed, gameState.baseSpeed + gameConfig.speedIncrease);
            gameState.currentSpeed = gameState.baseSpeed; // Update current speed too
            console.log('⚡ Speed increased to:', gameState.baseSpeed.toFixed(2));
        }
    }
}

function updateSnakeSegments(prevHeadPos) {
    for (let i = 1; i < gameState.snake.length; i++) {
        const currentSegment = gameState.snake[i];
        const targetSegment = i === 1 ? prevHeadPos : gameState.snake[i - 1];
        
        const dx = targetSegment.x - currentSegment.x;
        const dy = targetSegment.y - currentSegment.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance > gameConfig.segmentSpacing) {
            const ratio = (distance - gameConfig.segmentSpacing) / distance;
            currentSegment.x += dx * ratio * 0.8; // Smooth following
            currentSegment.y += dy * ratio * 0.8;
        }
    }
}

function addSnakeSegment() {
    if (gameState.snake.length > 0) {
        const tail = gameState.snake[gameState.snake.length - 1];
        let newSegment;
        
        if (gameState.snake.length > 1) {
            const secondToLast = gameState.snake[gameState.snake.length - 2];
            const dx = tail.x - secondToLast.x;
            const dy = tail.y - secondToLast.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance > 0) {
                const ratio = gameConfig.segmentSpacing / distance;
                newSegment = {
                    x: tail.x + dx * ratio,
                    y: tail.y + dy * ratio
                };
            } else {
                newSegment = {
                    x: tail.x - gameConfig.segmentSpacing,
                    y: tail.y
                };
            }
        } else {
            newSegment = {
                x: tail.x - gameConfig.segmentSpacing,
                y: tail.y
            };
        }
        
        gameState.snake.push(newSegment);
        console.log('🐍 Snake grew! Length:', gameState.snake.length);
    }
}

function generateFood() {
    let attempts = 0;
    const maxAttempts = 30;
    const margin = gameConfig.wallMargin + gameConfig.foodSize;
    
    do {
        gameState.food = {
            x: Math.random() * (gameConfig.boardSize.width - margin * 2) + margin,
            y: Math.random() * (gameConfig.boardSize.height - margin * 2) + margin
        };
        attempts++;
        
        let tooClose = false;
        for (let segment of gameState.snake) {
            const distance = Math.sqrt(
                Math.pow(gameState.food.x - segment.x, 2) + Math.pow(gameState.food.y - segment.y, 2)
            );
            if (distance < gameConfig.segmentSpacing * 2) {
                tooClose = true;
                break;
            }
        }
        
        if (!tooClose) break;
        
    } while (attempts < maxAttempts);
}

function renderGame() {
    if (!ctx) return;
    
    // Clear canvas
    ctx.fillStyle = colors.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw boundary guidelines
    if (gameState.currentState === GameState.PLAYING) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 1;
        ctx.strokeRect(gameConfig.wallMargin, gameConfig.wallMargin, 
                      gameConfig.boardSize.width - gameConfig.wallMargin * 2, 
                      gameConfig.boardSize.height - gameConfig.wallMargin * 2);
    }
    
    // Draw snake body segments
    ctx.shadowColor = colors.snake;
    ctx.shadowBlur = 8;
    ctx.fillStyle = colors.snake;
    
    for (let i = 1; i < gameState.snake.length; i++) {
        const segment = gameState.snake[i];
        ctx.beginPath();
        ctx.arc(segment.x, segment.y, gameConfig.snakeSegmentSize / 2, 0, 2 * Math.PI);
        ctx.fill();
    }
    
    ctx.shadowBlur = 0;
    
    // Draw snake head with direction indicator
    if (gameState.snake.length > 0) {
        const head = gameState.snake[0];
        
        // Head circle with pulsing effect based on speed
        ctx.shadowColor = colors.snakeHead;
        ctx.shadowBlur = 12 + (gameState.currentSpeed - gameState.baseSpeed) * 3;
        ctx.fillStyle = colors.snakeHead;
        ctx.beginPath();
        ctx.arc(head.x, head.y, gameConfig.snakeSegmentSize / 2, 0, 2 * Math.PI);
        ctx.fill();
        
        // Always show direction arrow since snake is always moving
        if (gameState.currentState === GameState.PLAYING) {
            ctx.shadowBlur = 0;
            ctx.fillStyle = '#ffffff';
            ctx.save();
            ctx.translate(head.x, head.y);
            ctx.rotate(gameState.direction);
            
            // Arrow size based on speed
            const arrowSize = (gameConfig.snakeSegmentSize / 3) * (1 + (gameState.currentSpeed - gameState.baseSpeed) / gameConfig.maxSpeedBoost * 0.3);
            ctx.beginPath();
            ctx.moveTo(arrowSize, 0);
            ctx.lineTo(-arrowSize / 2, -arrowSize / 2);
            ctx.lineTo(-arrowSize / 2, arrowSize / 2);
            ctx.closePath();
            ctx.fill();
            
            ctx.restore();
        }
        
        ctx.shadowBlur = 0;
    }
    
    // Draw food with pulsing effect
    ctx.shadowColor = colors.food;
    ctx.shadowBlur = 15;
    ctx.fillStyle = colors.food;
    ctx.beginPath();
    const pulseFactor = 1 + Math.sin(Date.now() * 0.005) * 0.1;
    ctx.arc(gameState.food.x, gameState.food.y, gameConfig.foodSize * pulseFactor, 0, 2 * Math.PI);
    ctx.fill();
    ctx.shadowBlur = 0;
    
    // Show waiting message
    if (gameState.currentState === GameState.WAITING_FOR_START) {
        ctx.fillStyle = 'rgba(15, 15, 35, 0.9)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        const gradient = ctx.createLinearGradient(0, canvas.height / 2 - 40, 0, canvas.height / 2 + 80);
        gradient.addColorStop(0, '#ff1493');
        gradient.addColorStop(0.5, '#ff6b35');
        gradient.addColorStop(1, '#f72585');
        
        ctx.fillStyle = gradient;
        ctx.font = 'bold 24px Orbitron, monospace';
        ctx.textAlign = 'center';
        ctx.shadowColor = '#ff1493';
        ctx.shadowBlur = 10;
        
        ctx.fillText('Waiting for Mobile Controller', canvas.width / 2, canvas.height / 2 - 20);
        ctx.fillText('Snake Moves Continuously - Be Ready!', canvas.width / 2, canvas.height / 2 + 20);
        
        ctx.shadowBlur = 0;
    }
}

function updateScore() {
    const scoreElement = document.getElementById('score');
    if (scoreElement) {
        scoreElement.textContent = gameState.score.toString();
    }
}

function updateConnectionStatus(status) {
    console.log('🔗 Connection status:', status);
}

function gameOver() {
    console.log('💀 Game over! Final score:', gameState.score, 'Snake length:', gameState.snake.length);
    gameState.currentState = GameState.GAME_OVER;
    
    const finalScoreElement = document.getElementById('final-score');
    if (finalScoreElement) {
        finalScoreElement.textContent = gameState.score.toString();
    }
    
    const gameOverScreen = document.getElementById('game-over');
    if (gameOverScreen) {
        gameOverScreen.classList.remove('hidden');
    }
    
    updateGameStateInFirebase();
}

function restartGame() {
    console.log('🔄 Restarting game with continuous movement!');
    
    gameState = {
        snake: createInitialSnake(),
        direction: 0,
        targetDirection: 0,
        baseSpeed: gameConfig.baseSpeed,
        currentSpeed: gameConfig.baseSpeed,
        food: { 
            x: gameConfig.boardSize.width * 0.75, 
            y: gameConfig.boardSize.height * 0.25 
        },
        score: 0,
        gameRunning: true,
        lastUpdateTime: 0,
        lastMoveTime: 0,
        currentState: GameState.PLAYING,
        joystickInput: { x: 0, y: 0 },
        frameCount: 0
    };
    
    updateScore();
    
    const gameOverScreen = document.getElementById('game-over');
    if (gameOverScreen) {
        gameOverScreen.classList.add('hidden');
    }
    
    generateFood();
    updateGameStateInFirebase();
}

// Optimized Firebase state updates - MINIMAL operations
async function updateGameStateInFirebase() {
    if (sessionManager.connectionType === 'hybrid' && firestore && sessionManager.currentSession) {
        try {
            // Only update on major state changes - NOT continuous updates
            const sessionDoc = firestore.collection('sessions').doc(sessionManager.currentSession);
            await sessionDoc.update({
                'gameState.state': gameState.currentState,
                'gameState.score': gameState.score,
                lastActivity: firebase.firestore.FieldValue.serverTimestamp()
            });
            console.log('📊 Game state updated in Firestore');
        } catch (error) {
            console.error('Error updating game state:', error);
        }
    } else if (sessionManager.connectionType === 'localStorage' && sessionManager.currentSession) {
        localStorage.setItem(`session_${sessionManager.currentSession}_state`, JSON.stringify({
            state: gameState.currentState,
            score: gameState.score
        }));
    }
}

// Mobile Controller Functions
function initializeMobileController() {
    console.log('📱 Initializing mobile controller...');
    
    const urlParams = new URLSearchParams(window.location.search);
    const sessionFromUrl = urlParams.get('session');
    
    if (sessionFromUrl) {
        const sessionInput = document.getElementById('session-input');
        if (sessionInput) {
            sessionInput.value = sessionFromUrl;
            setTimeout(() => connectToSession(sessionFromUrl), 1000);
        }
    }
    
    setupMobileEventListeners();
}

function setupMobileEventListeners() {
    const connectBtn = document.getElementById('connect-btn');
    if (connectBtn) {
        connectBtn.addEventListener('click', function() {
            const sessionInput = document.getElementById('session-input');
            if (sessionInput) {
                const sessionCode = sessionInput.value.trim();
                if (sessionCode.length === 6 && /^\d+$/.test(sessionCode)) {
                    connectToSession(sessionCode);
                } else {
                    showConnectionError('Please enter a valid 6-digit code');
                }
            }
        });
    }
    
    setupJoystickControls();
    
    const centerBtn = document.getElementById('btn-center');
    if (centerBtn) {
        centerBtn.addEventListener('click', handleCenterButtonPress);
        
        centerBtn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            handleCenterButtonPress();
            centerBtn.classList.add('active');
        });
        
        centerBtn.addEventListener('touchend', (e) => {
            e.preventDefault();
            centerBtn.classList.remove('active');
        });
    }
}

function setupJoystickControls() {
    const joystickBase = document.getElementById('joystick-base');
    const joystickHandle = document.getElementById('joystick-handle');
    
    if (!joystickBase || !joystickHandle) return;
    
    joystickState.baseElement = joystickBase;
    joystickState.handleElement = joystickHandle;
    
    // Mouse events
    joystickHandle.addEventListener('mousedown', startJoystickDrag);
    document.addEventListener('mousemove', handleJoystickDrag);
    document.addEventListener('mouseup', endJoystickDrag);
    
    // Touch events
    joystickHandle.addEventListener('touchstart', startJoystickDrag);
    document.addEventListener('touchmove', handleJoystickDrag, { passive: false });
    document.addEventListener('touchend', endJoystickDrag);
    
    joystickBase.addEventListener('mousedown', moveJoystickToPosition);
    joystickBase.addEventListener('touchstart', moveJoystickToPosition);
}

function startJoystickDrag(e) {
    e.preventDefault();
    joystickState.isDragging = true;
    joystickState.handleElement.classList.add('dragging');
    
    const rect = joystickState.baseElement.getBoundingClientRect();
    joystickState.baseRect = rect;
    joystickState.maxDistance = rect.width / 2 * 0.8;
}

function handleJoystickDrag(e) {
    if (!joystickState.isDragging) return;
    
    e.preventDefault();
    
    const clientX = e.clientX || (e.touches && e.touches[0].clientX);
    const clientY = e.clientY || (e.touches && e.touches[0].clientY);
    
    if (!clientX || !clientY) return;
    
    const rect = joystickState.baseRect;
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    
    let deltaX = clientX - centerX;
    let deltaY = clientY - centerY;
    
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    
    if (distance > joystickState.maxDistance) {
        const ratio = joystickState.maxDistance / distance;
        deltaX *= ratio;
        deltaY *= ratio;
    }
    
    joystickState.handleElement.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
    
    const normalizedX = deltaX / joystickState.maxDistance;
    const normalizedY = deltaY / joystickState.maxDistance;
    
    // THROTTLED joystick input to reduce operations
    const now = Date.now();
    if (now - joystickState.lastInputTime > gameConfig.joystickThrottleMs) {
        sendJoystickInput(normalizedX, normalizedY);
        joystickState.lastInputTime = now;
    }
}

function endJoystickDrag(e) {
    if (!joystickState.isDragging) return;
    
    e.preventDefault();
    joystickState.isDragging = false;
    joystickState.handleElement.classList.remove('dragging');
    
    joystickState.handleElement.style.transform = 'translate(0px, 0px)';
    sendJoystickInput(0, 0); // Snake keeps moving at base speed
}

function moveJoystickToPosition(e) {
    if (joystickState.isDragging) return;
    
    e.preventDefault();
    
    const rect = joystickState.baseElement.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    
    const clientX = e.clientX || (e.touches && e.touches[0].clientX);
    const clientY = e.clientY || (e.touches && e.touches[0].clientY);
    
    let deltaX = clientX - centerX;
    let deltaY = clientY - centerY;
    
    const maxDistance = rect.width / 2 * 0.8;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    
    if (distance > maxDistance) {
        const ratio = maxDistance / distance;
        deltaX *= ratio;
        deltaY *= ratio;
    }
    
    joystickState.isDragging = true;
    joystickState.baseRect = rect;
    joystickState.maxDistance = maxDistance;
    
    handleJoystickDrag({ clientX, clientY, preventDefault: () => {} });
}

function handleCenterButtonPress() {
    const centerBtn = document.getElementById('btn-center');
    if (!centerBtn || centerBtn.disabled) return;
    
    const currentIcon = centerBtn.querySelector('.center-icon').textContent;
    if (currentIcon === '▶') {
        sendGameAction('start');
    } else if (currentIcon === '↻') {
        sendGameAction('restart');
    }
}

function connectToSession(sessionCode) {
    console.log('🔗 Attempting to connect to session:', sessionCode);
    showConnectionStatus('Connecting...');
    
    sessionManager.connectionRetries = 0;
    attemptConnection(sessionCode);
}

// Robust connection with retry logic
function attemptConnection(sessionCode) {
    if (firebaseReady) {
        connectViaRobustHybrid(sessionCode);
    } else {
        connectViaLocalStorage(sessionCode);
    }
}

// Robust hybrid connection with detailed error handling and retries
async function connectViaRobustHybrid(sessionCode) {
    try {
        console.log(`🔥 Attempting hybrid connection (attempt ${sessionManager.connectionRetries + 1}/${gameConfig.connectionRetries})...`);
        showConnectionStatus(`Connecting to game... (${sessionManager.connectionRetries + 1}/${gameConfig.connectionRetries})`);
        
        // Wait for Firebase to be ready
        await waitForFirebaseReady();
        
        // Check if session exists in Firestore with detailed logging
        const sessionDoc = firestore.collection('sessions').doc(sessionCode);
        console.log('📋 Checking if session exists in Firestore...');
        
        const docSnapshot = await sessionDoc.get();
        
        if (docSnapshot.exists) {
            const sessionData = docSnapshot.data();
            console.log('✅ Session found in Firestore:', sessionData);
            
            sessionManager.connectedSession = sessionCode;
            sessionManager.connectionType = 'hybrid';
            showControllerInterface();
            showConnectionSuccess();
            console.log('✅ Successfully connected to hybrid session:', sessionCode);
            
            // Listen to Firestore for game state updates
            sessionManager.firestoreUnsubscribe = sessionDoc.onSnapshot((doc) => {
                if (doc.exists) {
                    const data = doc.data();
                    if (data.gameState) {
                        updateCenterButtonIcon(data.gameState.state);
                    }
                }
            }, (error) => {
                console.error('❌ Firestore listener error:', error);
                showConnectionError('Connection lost. Please refresh and try again.');
            });
            
            // Update connection status in Firestore
            await sessionDoc.update({ 
                connected: true,
                lastActivity: firebase.firestore.FieldValue.serverTimestamp()
            });
            console.log('✅ Updated connection status in Firestore');
            
            // Set up Realtime Database for joystick
            sessionManager.realtimeRef = database.ref(`controllers/${sessionCode}`);
            await sessionManager.realtimeRef.set({
                connected: true,
                joystick: { x: 0, y: 0 },
                timestamp: firebase.database.ServerValue.TIMESTAMP
            });
            console.log('✅ Realtime Database connected for joystick input');
            
            // Set initial button state
            if (sessionData.gameState) {
                updateCenterButtonIcon(sessionData.gameState.state);
            }
            
        } else {
            console.log('❌ Session not found in Firestore');
            throw new Error(`Session ${sessionCode} not found in Firestore. Make sure the game is running on desktop.`);
        }
        
    } catch (error) {
        console.error('❌ Hybrid connection failed:', error);
        
        sessionManager.connectionRetries++;
        
        if (sessionManager.connectionRetries < gameConfig.connectionRetries) {
            console.log(`🔄 Retrying connection in ${gameConfig.retryDelayMs/1000} seconds...`);
            showConnectionError(`Connection failed. Retrying... (${sessionManager.connectionRetries}/${gameConfig.connectionRetries})`);
            
            setTimeout(() => {
                attemptConnection(sessionCode);
            }, gameConfig.retryDelayMs);
        } else {
            console.log('🔄 Max retries reached, falling back to localStorage...');
            showConnectionError('Could not connect via Firebase. Trying local mode...');
            connectViaLocalStorage(sessionCode);
        }
    }
}

function connectViaLocalStorage(sessionCode) {
    const currentSession = localStorage.getItem('currentSession');
    
    if (currentSession === sessionCode) {
        sessionManager.connectedSession = sessionCode;
        sessionManager.connectionType = 'localStorage';
        showControllerInterface();
        showConnectionSuccess('Connected via localStorage!');
        console.log('✅ Connected via localStorage:', sessionCode);
        
        const gameStateStr = localStorage.getItem(`session_${sessionCode}_state`);
        const gameStateData = gameStateStr ? JSON.parse(gameStateStr) : { state: GameState.WAITING_FOR_START };
        updateCenterButtonIcon(gameStateData.state);
        
        window.addEventListener('storage', function(e) {
            if (e.key === `session_${sessionCode}_state`) {
                const data = JSON.parse(e.newValue || '{}');
                if (data.state) {
                    updateCenterButtonIcon(data.state);
                }
            }
        });
        
    } else {
        showConnectionError('Session not found. Make sure the game is running on desktop and try again.');
    }
}

function showControllerInterface() {
    const connectionForm = document.getElementById('connection-form');
    const controllerInterface = document.getElementById('controller-interface');
    
    if (connectionForm) connectionForm.style.display = 'none';
    if (controllerInterface) controllerInterface.style.display = 'block';
}

function showConnectionSuccess(message = 'Connected! Snake moves continuously!') {
    const statusElement = document.getElementById('mobile-connection-status');
    if (statusElement) {
        statusElement.textContent = message;
        statusElement.style.color = '#00ff00';
    }
}

function showConnectionError(message) {
    const statusElement = document.getElementById('mobile-connection-status');
    if (statusElement) {
        statusElement.textContent = message;
        statusElement.style.color = '#ff1493';
    }
}

function showConnectionStatus(message) {
    const statusElement = document.getElementById('mobile-connection-status');
    if (statusElement) {
        statusElement.textContent = message;
        statusElement.style.color = '#ff6b35';
    }
}

function updateCenterButtonIcon(currentState) {
    const centerBtn = document.getElementById('btn-center');
    if (!centerBtn) return;
    
    const btnIcon = centerBtn.querySelector('.center-icon');
    
    centerBtn.classList.remove('ready', 'playing', 'restart');
    
    if (currentState === GameState.WAITING_FOR_START) {
        centerBtn.disabled = false;
        centerBtn.classList.add('ready');
        if (btnIcon) btnIcon.textContent = '▶';
    } else if (currentState === GameState.GAME_OVER) {
        centerBtn.disabled = false;
        centerBtn.classList.add('restart');
        if (btnIcon) btnIcon.textContent = '↻';
    } else if (currentState === GameState.PLAYING) {
        centerBtn.disabled = true;
        centerBtn.classList.add('playing');
        if (btnIcon) btnIcon.textContent = '🐍';
    }
}

// Optimized input functions - Minimal Firebase operations
function sendJoystickInput(x, y) {
    if (!sessionManager.connectedSession) return;
    
    const joystickInput = { x, y };
    
    if (sessionManager.connectionType === 'hybrid' && sessionManager.realtimeRef) {
        // Use Realtime Database - FREE unlimited operations
        sessionManager.realtimeRef.update({
            joystick: joystickInput,
            timestamp: firebase.database.ServerValue.TIMESTAMP
        }).catch(error => {
            console.error('Error sending joystick input:', error);
        });
    } else if (sessionManager.connectionType === 'localStorage') {
        localStorage.setItem(`session_${sessionManager.connectedSession}_joystick`, JSON.stringify({
            joystick: joystickInput,
            timestamp: Date.now()
        }));
    }
}

function sendGameAction(action) {
    if (!sessionManager.connectedSession) return;
    
    console.log('📤 Sending game action:', action);
    
    if (sessionManager.connectionType === 'hybrid' && firestore) {
        // Use Firestore for game actions - minimal writes
        const sessionDoc = firestore.collection('sessions').doc(sessionManager.connectedSession);
        sessionDoc.update({
            gameAction: action,
            lastActivity: firebase.firestore.FieldValue.serverTimestamp()
        }).catch(error => {
            console.error('Error sending game action:', error);
        });
    } else if (sessionManager.connectionType === 'localStorage') {
        localStorage.setItem(`session_${sessionManager.connectedSession}_action`, JSON.stringify({
            action: action,
            timestamp: Date.now()
        }));
    }
}

// Cleanup resources on page unload
window.addEventListener('beforeunload', function() {
    if (sessionManager.firestoreUnsubscribe) {
        sessionManager.firestoreUnsubscribe();
    }
    if (sessionManager.realtimeRef) {
        sessionManager.realtimeRef.off();
    }
});