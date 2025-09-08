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

// Initialize Firebase with Firestore
let app, firestore;
let firebaseReady = false;

// Initialize Firebase when DOM is ready or Firebase is loaded
function initializeFirebase() {
    try {
        if (typeof firebase === 'undefined') {
            console.warn('Firebase not loaded yet, retrying...');
            setTimeout(initializeFirebase, 1000);
            return;
        }
        
        app = firebase.initializeApp(firebaseConfig);
        firestore = firebase.firestore();
        firebaseReady = true;
        console.log('Firebase with Firestore initialized successfully');
    } catch (error) {
        console.warn('Firebase initialization failed:', error);
        console.log('Running in offline mode');
    }
}

// Initialize Firebase
if (typeof firebase !== 'undefined') {
    initializeFirebase();
} else {
    setTimeout(initializeFirebase, 2000);
}

// Game configuration - Improved for better gameplay
const gameConfig = {
    boardSize: { width: 600, height: 600 },
    snakeSegmentSize: 12,
    foodSize: 8,
    initialSpeed: 2.5, // Increased speed as requested
    speedIncrease: 0.15,
    maxSpeed: 6,
    turnSpeed: 0.1, // Slightly faster turning
    segmentSpacing: 15, // Consistent segment spacing
    wallMargin: 20,
    minSelfCollisionSegments: 8 // Skip more segments for collision
};

// Updated colors for the new synthwave aesthetic
const colors = {
    background: "#0a0a0a",
    snake: "#ff1493",        // Hot pink for snake body
    snakeHead: "#ff6b35",    // Orange for snake head  
    food: "#7209b7",         // Purple for food
    border: "#333333",
    text: "#ffffff",
    accent: "#ff1493"
};

// Create initial snake with better spacing
function createInitialSnake() {
    const centerX = gameConfig.boardSize.width / 2;
    const centerY = gameConfig.boardSize.height / 2;
    const spacing = gameConfig.segmentSpacing;
    
    return [
        { x: centerX, y: centerY },                    // Head
        { x: centerX - spacing, y: centerY },          // Segment 1
        { x: centerX - spacing * 2, y: centerY },      // Segment 2
        { x: centerX - spacing * 3, y: centerY },      // Segment 3
        { x: centerX - spacing * 4, y: centerY }       // Tail
    ];
}

// Game states
const GameState = {
    WAITING_FOR_START: 'waiting_for_start',
    PLAYING: 'playing',
    GAME_OVER: 'game_over'
};

// Global game state
let gameState = {
    snake: createInitialSnake(),
    direction: 0, // Radians
    targetDirection: 0,
    speed: gameConfig.initialSpeed,
    food: { 
        x: gameConfig.boardSize.width * 0.75, 
        y: gameConfig.boardSize.height * 0.25 
    },
    score: 0,
    gameRunning: false,
    lastUpdateTime: 0,
    currentState: GameState.WAITING_FOR_START,
    joystickInput: { x: 0, y: 0 },
    isMoving: false,
    frameCount: 0
};

// Session management
let sessionManager = {
    currentSession: null,
    isDesktop: true,
    connectedSession: null,
    firebaseConnected: false,
    unsubscribe: null
};

// Canvas and game elements
let canvas, ctx;
let gameLoop;

// Joystick state for mobile
let joystickState = {
    isDragging: false,
    baseElement: null,
    handleElement: null,
    baseRect: null,
    maxDistance: 0
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
    
    console.log('Device detected:', sessionManager.isDesktop ? 'Desktop' : 'Mobile', 'Width:', window.innerWidth);
    
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
    
    console.log('Canvas initialized:', canvas.width, 'x', canvas.height);
    
    generateNewSession();
    startGameLoop();
}

function generateNewSession() {
    const sessionCode = Math.floor(100000 + Math.random() * 900000).toString();
    sessionManager.currentSession = sessionCode;
    
    console.log('Generated session code:', sessionCode);
    
    const sessionCodeElement = document.getElementById('session-code');
    if (sessionCodeElement) {
        sessionCodeElement.textContent = sessionCode;
    }
    
    generateQRCode(sessionCode);
    
    if (firebaseReady && firestore) {
        setupFirestoreSession(sessionCode);
    } else {
        setupLocalStorageSession(sessionCode);
    }
}

async function setupFirestoreSession(sessionCode) {
    try {
        const sessionDoc = firestore.collection('sessions').doc(sessionCode);
        
        await sessionDoc.set({
            created: firebase.firestore.FieldValue.serverTimestamp(),
            connected: false,
            joystickInput: { x: 0, y: 0 },
            gameAction: null,
            gameState: {
                active: true,
                score: 0,
                state: GameState.WAITING_FOR_START
            }
        });
        
        console.log('Session created in Firestore:', sessionCode);
        sessionManager.firebaseConnected = true;
        
        sessionManager.unsubscribe = sessionDoc.onSnapshot((doc) => {
            if (doc.exists) {
                const data = doc.data();
                if (data.connected) {
                    if (data.joystickInput) {
                        handleJoystickInputFromMobile(data.joystickInput);
                    }
                    if (data.gameAction) {
                        console.log('Received game action from Firestore:', data.gameAction);
                        handleGameActionFromMobile(data.gameAction);
                        sessionDoc.update({ gameAction: null });
                    }
                }
            }
        });
        
    } catch (error) {
        console.error('Firestore error:', error);
        setupLocalStorageSession(sessionCode);
    }
}

function setupLocalStorageSession(sessionCode) {
    console.log('Using localStorage for session:', sessionCode);
    localStorage.setItem('currentSession', sessionCode);
    localStorage.setItem(`session_${sessionCode}_state`, JSON.stringify({
        state: GameState.WAITING_FOR_START,
        score: 0
    }));
    
    window.addEventListener('storage', function(e) {
        if (e.key === `session_${sessionCode}`) {
            const data = JSON.parse(e.newValue || '{}');
            if (data.joystickInput) {
                handleJoystickInputFromMobile(data.joystickInput);
            }
            if (data.gameAction) {
                console.log('Received game action from localStorage:', data.gameAction);
                handleGameActionFromMobile(data.gameAction);
            }
        }
    });
}

function generateQRCode(sessionCode) {
    console.log('Generating QR code for session:', sessionCode);
    
    const qrContainer = document.getElementById('qr-code-container');
    const qrCanvas = document.getElementById('qr-canvas');
    const qrLoading = document.getElementById('qr-loading');
    
    if (!qrContainer) {
        console.error('QR container not found!');
        return;
    }
    
    if (qrLoading) qrLoading.style.display = 'flex';
    if (qrContainer) qrContainer.style.display = 'none';
    
    const gameUrl = `${window.location.origin}${window.location.pathname}?session=${sessionCode}`;
    console.log('QR URL:', gameUrl);
    
    let qrGenerated = false;
    
    if (typeof QRious !== 'undefined' && !qrGenerated) {
        try {
            console.log('Trying QRious library...');
            const qr = new QRious({
                element: qrCanvas,
                value: gameUrl,
                size: 150,
                foreground: '#000000',
                background: '#ffffff'
            });
            
            qrGenerated = true;
            console.log('QR code generated successfully with QRious');
            
            if (qrLoading) qrLoading.style.display = 'none';
            if (qrContainer) qrContainer.style.display = 'block';
            
        } catch (error) {
            console.error('QRious failed:', error);
        }
    }
    
    if (!qrGenerated) {
        console.log('QR libraries failed, using placeholder');
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
    
    // QR corner patterns
    [
        [15, 15], [110, 15], [15, 110]
    ].forEach(([x, y]) => {
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
    
    // Center text
    ctx.font = 'bold 10px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('SCAN QR', 75, 60);
    ctx.font = '8px Arial';
    ctx.fillText(`Code: ${sessionCode}`, 75, 75);
    ctx.fillText('or enter code', 75, 87);
}

function handleJoystickInputFromMobile(joystickInput) {
    if (gameState.currentState === GameState.PLAYING) {
        gameState.joystickInput = joystickInput;
        
        const magnitude = Math.sqrt(joystickInput.x * joystickInput.x + joystickInput.y * joystickInput.y);
        if (magnitude > 0.15) {
            gameState.isMoving = true;
            gameState.targetDirection = Math.atan2(joystickInput.y, joystickInput.x);
        } else {
            gameState.isMoving = false;
        }
    }
}

function handleGameActionFromMobile(action) {
    console.log('Handling game action from mobile:', action);
    
    if (action === 'start' && gameState.currentState === GameState.WAITING_FOR_START) {
        startGame();
    } else if (action === 'restart' && gameState.currentState === GameState.GAME_OVER) {
        restartGame();
    }
}

function startGameLoop() {
    console.log('Starting game loop...');
    gameState.gameRunning = true;
    gameState.lastUpdateTime = performance.now();
    
    generateFood();
    gameLoop = requestAnimationFrame(updateGame);
    renderGame();
}

function startGame() {
    console.log('Starting game from mobile controller!');
    gameState.currentState = GameState.PLAYING;
    gameState.direction = 0;
    gameState.targetDirection = 0;
    gameState.joystickInput = { x: 0, y: 0 };
    gameState.isMoving = false;
    gameState.frameCount = 0;
    
    const gameOverScreen = document.getElementById('game-over');
    if (gameOverScreen) {
        gameOverScreen.classList.add('hidden');
    }
    
    updateGameStateInFirestore();
}

function updateGame(currentTime) {
    if (!gameState.gameRunning) return;
    
    const deltaTime = currentTime - gameState.lastUpdateTime;
    
    if (gameState.currentState === GameState.PLAYING && deltaTime >= 16) { // 60 FPS
        gameState.frameCount++;
        
        if (gameState.isMoving) {
            updateSnakeDirection();
            moveSnake();
        }
        
        gameState.lastUpdateTime = currentTime;
    }
    
    renderGame();
    
    if (gameState.gameRunning) {
        gameLoop = requestAnimationFrame(updateGame);
    }
}

function updateSnakeDirection() {
    if (!gameState.isMoving) return;
    
    let angleDiff = gameState.targetDirection - gameState.direction;
    
    // Normalize angle difference
    while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
    while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
    
    // Smooth turning
    if (Math.abs(angleDiff) > gameConfig.turnSpeed) {
        gameState.direction += Math.sign(angleDiff) * gameConfig.turnSpeed;
    } else {
        gameState.direction = gameState.targetDirection;
    }
    
    // Normalize direction
    while (gameState.direction < 0) gameState.direction += 2 * Math.PI;
    while (gameState.direction >= 2 * Math.PI) gameState.direction -= 2 * Math.PI;
}

function moveSnake() {
    if (gameState.snake.length === 0) return;
    
    // Store previous head position for proper segment following
    const prevHead = { ...gameState.snake[0] };
    
    // Calculate new head position
    const head = { ...gameState.snake[0] };
    const magnitude = Math.sqrt(gameState.joystickInput.x * gameState.joystickInput.x + gameState.joystickInput.y * gameState.joystickInput.y);
    const moveSpeed = Math.min(magnitude, 1) * gameState.speed;
    
    head.x += Math.cos(gameState.direction) * moveSpeed;
    head.y += Math.sin(gameState.direction) * moveSpeed;
    
    // Check wall collision
    if (head.x < gameConfig.wallMargin || 
        head.x > gameConfig.boardSize.width - gameConfig.wallMargin ||
        head.y < gameConfig.wallMargin || 
        head.y > gameConfig.boardSize.height - gameConfig.wallMargin) {
        console.log('Wall collision! Head at:', head.x.toFixed(2), head.y.toFixed(2));
        gameOver();
        return;
    }
    
    // Check self collision - only check segments far enough away
    for (let i = gameConfig.minSelfCollisionSegments; i < gameState.snake.length; i++) {
        const segment = gameState.snake[i];
        const distance = Math.sqrt(
            Math.pow(head.x - segment.x, 2) + Math.pow(head.y - segment.y, 2)
        );
        if (distance < gameConfig.snakeSegmentSize * 0.8) {
            console.log('Self collision with segment', i, 'distance:', distance.toFixed(2), 'snake length:', gameState.snake.length);
            gameOver();
            return;
        }
    }
    
    // Update head position
    gameState.snake[0] = head;
    
    // Move body segments to follow the head properly
    updateSnakeSegments(prevHead);
    
    // Check food collision
    const foodDistance = Math.sqrt(
        Math.pow(head.x - gameState.food.x, 2) + Math.pow(head.y - gameState.food.y, 2)
    );
    
    if (foodDistance < (gameConfig.snakeSegmentSize + gameConfig.foodSize)) {
        console.log('Food collected! Score:', gameState.score + 10, 'Snake will grow from', gameState.snake.length, 'to', gameState.snake.length + 1);
        gameState.score += 10;
        updateScore();
        generateFood();
        
        // Add new segment at the tail
        addSnakeSegment();
        
        // Increase speed gradually
        if (gameState.speed < gameConfig.maxSpeed) {
            gameState.speed = Math.min(gameConfig.maxSpeed, gameState.speed + gameConfig.speedIncrease);
            console.log('Speed increased to:', gameState.speed);
        }
    }
}

function updateSnakeSegments(prevHeadPos) {
    // Move each segment to follow the one in front of it
    for (let i = 1; i < gameState.snake.length; i++) {
        const currentSegment = gameState.snake[i];
        const targetSegment = i === 1 ? prevHeadPos : gameState.snake[i - 1];
        
        // Calculate direction from current segment to target
        const dx = targetSegment.x - currentSegment.x;
        const dy = targetSegment.y - currentSegment.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        // Only move if the distance is greater than desired spacing
        if (distance > gameConfig.segmentSpacing) {
            const ratio = (distance - gameConfig.segmentSpacing) / distance;
            currentSegment.x += dx * ratio * 0.8; // Smooth following with 80% catch-up
            currentSegment.y += dy * ratio * 0.8;
        }
    }
}

function addSnakeSegment() {
    // Add a new segment at the end of the snake
    if (gameState.snake.length > 0) {
        const tail = gameState.snake[gameState.snake.length - 1];
        let newSegment;
        
        if (gameState.snake.length > 1) {
            // Calculate position based on the direction from second-to-last to last segment
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
                // Fallback if segments are at the same position
                newSegment = {
                    x: tail.x - gameConfig.segmentSpacing,
                    y: tail.y
                };
            }
        } else {
            // Only head exists, add segment behind it
            newSegment = {
                x: tail.x - gameConfig.segmentSpacing,
                y: tail.y
            };
        }
        
        gameState.snake.push(newSegment);
        console.log('New segment added. Snake length now:', gameState.snake.length);
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
        
        // Check if food is away from snake
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
    
    console.log('Food generated at:', gameState.food.x.toFixed(2), gameState.food.y.toFixed(2));
}

function renderGame() {
    if (!ctx) return;
    
    // Clear canvas
    ctx.fillStyle = colors.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw debug boundaries
    if (gameState.currentState === GameState.PLAYING) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 1;
        ctx.strokeRect(gameConfig.wallMargin, gameConfig.wallMargin, 
                      gameConfig.boardSize.width - gameConfig.wallMargin * 2, 
                      gameConfig.boardSize.height - gameConfig.wallMargin * 2);
    }
    
    // Draw snake body segments (skip head)
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
    
    // Draw snake head
    if (gameState.snake.length > 0) {
        const head = gameState.snake[0];
        
        // Head circle
        ctx.shadowColor = colors.snakeHead;
        ctx.shadowBlur = 12;
        ctx.fillStyle = colors.snakeHead;
        ctx.beginPath();
        ctx.arc(head.x, head.y, gameConfig.snakeSegmentSize / 2, 0, 2 * Math.PI);
        ctx.fill();
        
        // Direction arrow - only when moving
        if (gameState.isMoving && gameState.currentState === GameState.PLAYING) {
            ctx.shadowBlur = 0;
            ctx.fillStyle = '#ffffff';
            ctx.save();
            ctx.translate(head.x, head.y);
            ctx.rotate(gameState.direction);
            
            // Draw arrow
            const arrowSize = gameConfig.snakeSegmentSize / 3;
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
    
    // Draw food
    ctx.shadowColor = colors.food;
    ctx.shadowBlur = 15;
    ctx.fillStyle = colors.food;
    ctx.beginPath();
    ctx.arc(gameState.food.x, gameState.food.y, gameConfig.foodSize, 0, 2 * Math.PI);
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
        ctx.fillText('Press PLAY to Begin!', canvas.width / 2, canvas.height / 2 + 20);
        
        ctx.shadowBlur = 0;
    }
}

function updateScore() {
    const scoreElement = document.getElementById('score');
    if (scoreElement) {
        scoreElement.textContent = gameState.score.toString();
    }
}

function gameOver() {
    console.log('Game over! Final score:', gameState.score, 'Snake length:', gameState.snake.length);
    gameState.currentState = GameState.GAME_OVER;
    gameState.isMoving = false;
    
    const finalScoreElement = document.getElementById('final-score');
    if (finalScoreElement) {
        finalScoreElement.textContent = gameState.score.toString();
    }
    
    const gameOverScreen = document.getElementById('game-over');
    if (gameOverScreen) {
        gameOverScreen.classList.remove('hidden');
    }
    
    updateGameStateInFirestore();
}

function restartGame() {
    console.log('Restarting game from mobile controller!');
    
    gameState = {
        snake: createInitialSnake(),
        direction: 0,
        targetDirection: 0,
        speed: gameConfig.initialSpeed,
        food: { 
            x: gameConfig.boardSize.width * 0.75, 
            y: gameConfig.boardSize.height * 0.25 
        },
        score: 0,
        gameRunning: true,
        lastUpdateTime: 0,
        currentState: GameState.PLAYING,
        joystickInput: { x: 0, y: 0 },
        isMoving: false,
        frameCount: 0
    };
    
    updateScore();
    
    const gameOverScreen = document.getElementById('game-over');
    if (gameOverScreen) {
        gameOverScreen.classList.add('hidden');
    }
    
    generateFood();
    updateGameStateInFirestore();
}

async function updateGameStateInFirestore() {
    if (firebaseReady && firestore && sessionManager.currentSession) {
        try {
            const sessionDoc = firestore.collection('sessions').doc(sessionManager.currentSession);
            await sessionDoc.update({
                'gameState.state': gameState.currentState,
                'gameState.score': gameState.score,
                lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
            });
        } catch (error) {
            console.error('Error updating game state in Firestore:', error);
        }
    } else if (sessionManager.currentSession) {
        localStorage.setItem(`session_${sessionManager.currentSession}_state`, JSON.stringify({
            state: gameState.currentState,
            score: gameState.score
        }));
    }
}

// Mobile Controller Functions
function initializeMobileController() {
    console.log('Initializing mobile controller...');
    
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
        centerBtn.addEventListener('click', function() {
            if (!centerBtn.disabled) {
                handleCenterButtonPress(centerBtn);
            }
        });
        
        centerBtn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            if (!centerBtn.disabled) {
                handleCenterButtonPress(centerBtn);
                centerBtn.classList.add('active');
            }
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
    
    sendJoystickInput(normalizedX, normalizedY);
}

function endJoystickDrag(e) {
    if (!joystickState.isDragging) return;
    
    e.preventDefault();
    joystickState.isDragging = false;
    joystickState.handleElement.classList.remove('dragging');
    
    joystickState.handleElement.style.transform = 'translate(0px, 0px)';
    sendJoystickInput(0, 0);
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

function handleCenterButtonPress(centerBtn) {
    const currentIcon = centerBtn.querySelector('.center-icon').textContent;
    if (currentIcon === '▶') {
        sendGameAction('start');
    } else if (currentIcon === '↻') {
        sendGameAction('restart');
    }
}

function connectToSession(sessionCode) {
    console.log('Attempting to connect to session:', sessionCode);
    
    if (firebaseReady && firestore) {
        connectViaFirestore(sessionCode);
    } else {
        connectViaLocalStorage(sessionCode);
    }
}

async function connectViaFirestore(sessionCode) {
    try {
        const sessionDoc = firestore.collection('sessions').doc(sessionCode);
        
        const docSnapshot = await sessionDoc.get();
        if (docSnapshot.exists) {
            sessionManager.connectedSession = sessionCode;
            showControllerInterface();
            showConnectionSuccess();
            console.log('Connected to Firestore session:', sessionCode);
            
            sessionManager.unsubscribe = sessionDoc.onSnapshot((doc) => {
                if (doc.exists) {
                    const data = doc.data();
                    if (data.gameState) {
                        updateCenterButtonIcon(data.gameState.state);
                    }
                }
            });
            
            const data = docSnapshot.data();
            if (data.gameState) {
                updateCenterButtonIcon(data.gameState.state);
            } else {
                updateCenterButtonIcon(GameState.WAITING_FOR_START);
            }
            
        } else {
            showConnectionError('Session not found. Make sure the game is running on desktop.');
        }
        
    } catch (error) {
        console.error('Firestore connection error:', error);
        connectViaLocalStorage(sessionCode);
    }
}

function connectViaLocalStorage(sessionCode) {
    const currentSession = localStorage.getItem('currentSession');
    
    if (currentSession === sessionCode) {
        sessionManager.connectedSession = sessionCode;
        showControllerInterface();
        showConnectionSuccess();
        console.log('Connected to localStorage session:', sessionCode);
        
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
        showConnectionError('Session not found. Make sure the game is running on desktop.');
    }
}

function showControllerInterface() {
    console.log('Showing controller interface');
    
    const connectionForm = document.getElementById('connection-form');
    const controllerInterface = document.getElementById('controller-interface');
    
    if (connectionForm) connectionForm.style.display = 'none';
    if (controllerInterface) controllerInterface.style.display = 'block';
}

function showConnectionSuccess() {
    const statusElement = document.getElementById('mobile-connection-status');
    if (statusElement) {
        statusElement.textContent = 'Connected successfully!';
        statusElement.style.color = '#ff6b35';
    }
}

function showConnectionError(message) {
    const statusElement = document.getElementById('mobile-connection-status');
    if (statusElement) {
        statusElement.textContent = message;
        statusElement.style.color = '#ff1493';
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
    
    console.log('Center button updated for state:', currentState);
}

function sendJoystickInput(x, y) {
    if (!sessionManager.connectedSession) return;
    
    const joystickInput = { x, y };
    
    if (firebaseReady && firestore) {
        sendJoystickInputFirestore(joystickInput);
    } else {
        sendJoystickInputLocalStorage(joystickInput);
    }
}

function sendGameAction(action) {
    if (!sessionManager.connectedSession) {
        console.error('No connected session');
        return;
    }
    
    console.log('Sending game action:', action);
    
    if (firebaseReady && firestore) {
        sendGameActionFirestore(action);
    } else {
        sendGameActionLocalStorage(action);
    }
}

async function sendJoystickInputFirestore(joystickInput) {
    try {
        const sessionDoc = firestore.collection('sessions').doc(sessionManager.connectedSession);
        await sessionDoc.update({
            connected: true,
            joystickInput: joystickInput,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
    } catch (error) {
        console.error('Error sending joystick input to Firestore:', error);
        sendJoystickInputLocalStorage(joystickInput);
    }
}

async function sendGameActionFirestore(action) {
    try {
        const sessionDoc = firestore.collection('sessions').doc(sessionManager.connectedSession);
        await sessionDoc.update({
            connected: true,
            gameAction: action,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
        console.log('Game action sent via Firestore:', action);
    } catch (error) {
        console.error('Error sending game action to Firestore:', error);
        sendGameActionLocalStorage(action);
    }
}

function sendJoystickInputLocalStorage(joystickInput) {
    const sessionData = {
        joystickInput: joystickInput,
        timestamp: Date.now()
    };
    
    localStorage.setItem(`session_${sessionManager.connectedSession}`, JSON.stringify(sessionData));
}

function sendGameActionLocalStorage(action) {
    const sessionData = {
        gameAction: action,
        timestamp: Date.now()
    };
    
    localStorage.setItem(`session_${sessionManager.connectedSession}`, JSON.stringify(sessionData));
    console.log('Game action sent via localStorage:', action);
}

// Cleanup function for when page is closed
window.addEventListener('beforeunload', function() {
    if (sessionManager.unsubscribe) {
        sessionManager.unsubscribe();
    }
});