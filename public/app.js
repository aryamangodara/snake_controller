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

// Initialize Firebase
let app, database;
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
        database = firebase.database();
        firebaseReady = true;
        console.log('Firebase initialized successfully');
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

// Game configuration
const gameConfig = {
    boardSize: { width: 600, height: 600 },
    gridSize: 20,
    initialSpeed: 200,
    speedIncrease: 10,
    minSpeed: 80
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

// Calculate grid dimensions
const GRID_WIDTH = Math.floor(gameConfig.boardSize.width / gameConfig.gridSize);
const GRID_HEIGHT = Math.floor(gameConfig.boardSize.height / gameConfig.gridSize);

// Create initial snake with length of 5, positioned vertically
function createInitialSnake() {
    const centerX = Math.floor(GRID_WIDTH / 2);
    const centerY = Math.floor(GRID_HEIGHT / 2);
    
    return [
        { x: centerX, y: centerY },     // Head
        { x: centerX, y: centerY + 1 }, // Body segment 1
        { x: centerX, y: centerY + 2 }, // Body segment 2
        { x: centerX, y: centerY + 3 }, // Body segment 3
        { x: centerX, y: centerY + 4 }  // Tail
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
    direction: { x: 0, y: 0 }, // Start stationary
    nextDirection: { x: 0, y: 0 },
    food: { x: Math.floor(GRID_WIDTH / 4), y: Math.floor(GRID_HEIGHT / 4) },
    score: 0,
    gameRunning: false,
    speed: gameConfig.initialSpeed,
    lastUpdateTime: 0,
    currentState: GameState.WAITING_FOR_START
};

// Session management
let sessionManager = {
    currentSession: null,
    isDesktop: true,
    connectedSession: null,
    firebaseConnected: false
};

// Canvas and game elements
let canvas, ctx;
let gameLoop;

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
    
    // Generate session code and setup Firebase
    generateNewSession();
    
    // Start game loop (but game won't move until started from mobile)
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
    updateConnectionStatus('Waiting for mobile connection...');
    
    if (firebaseReady && database) {
        setupFirebaseSession(sessionCode);
    } else {
        setupLocalStorageSession(sessionCode);
    }
}

async function setupFirebaseSession(sessionCode) {
    try {
        const sessionRef = database.ref(`sessions/${sessionCode}`);
        
        await sessionRef.set({
            created: Date.now(),
            connected: false,
            lastDirection: null,
            gameAction: null,
            gameState: {
                active: true,
                score: 0,
                state: GameState.WAITING_FOR_START
            }
        });
        
        console.log('Session created in Firebase:', sessionCode);
        sessionManager.firebaseConnected = true;
        updateConnectionStatus('Firebase connected - Waiting for mobile...');
        
        // Listen for mobile controller input
        sessionRef.on('value', (snapshot) => {
            const data = snapshot.val();
            if (data && data.connected) {
                if (data.lastDirection) {
                    console.log('Received direction from Firebase:', data.lastDirection);
                    handleDirectionFromMobile(data.lastDirection);
                }
                if (data.gameAction) {
                    console.log('Received game action from Firebase:', data.gameAction);
                    handleGameActionFromMobile(data.gameAction);
                }
                updateConnectionStatus('Mobile connected via Firebase');
            }
        });
        
    } catch (error) {
        console.error('Firebase error:', error);
        updateConnectionStatus('Firebase failed, using local mode');
        setupLocalStorageSession(sessionCode);
    }
}

function setupLocalStorageSession(sessionCode) {
    console.log('Using localStorage for session:', sessionCode);
    localStorage.setItem('currentSession', sessionCode);
    updateConnectionStatus('Local mode - Waiting for mobile...');
    
    // Listen for localStorage changes (cross-tab communication)
    window.addEventListener('storage', function(e) {
        if (e.key === `session_${sessionCode}`) {
            const data = JSON.parse(e.newValue || '{}');
            if (data.direction) {
                console.log('Received direction from localStorage:', data.direction);
                handleDirectionFromMobile(data.direction);
            }
            if (data.gameAction) {
                console.log('Received game action from localStorage:', data.gameAction);
                handleGameActionFromMobile(data.gameAction);
            }
            updateConnectionStatus('Mobile connected via localStorage');
        }
    });
}

function generateQRCode(sessionCode) {
    console.log('Generating QR code for session:', sessionCode);
    
    const qrContainer = document.getElementById('qr-code-container');
    const qrCanvas = document.getElementById('qr-canvas');
    const qrDiv = document.getElementById('qr-code-div');
    const qrLoading = document.getElementById('qr-loading');
    
    if (!qrContainer) {
        console.error('QR container not found!');
        return;
    }
    
    // Show loading state
    if (qrLoading) qrLoading.style.display = 'flex';
    if (qrContainer) qrContainer.style.display = 'none';
    
    const gameUrl = `${window.location.origin}${window.location.pathname}?session=${sessionCode}`;
    console.log('QR URL:', gameUrl);
    
    let qrGenerated = false;
    
    // Try QRious library first
    if (typeof QRious !== 'undefined' && !qrGenerated) {
        try {
            console.log('Trying QRious library...');
            const qr = new QRious({
                element: qrCanvas,
                value: gameUrl,
                size: 150,
                foreground: '#000000',  // Black QR code
                background: '#ffffff'   // White background
            });
            
            qrGenerated = true;
            console.log('QR code generated successfully with QRious');
            
            if (qrLoading) qrLoading.style.display = 'none';
            if (qrContainer) qrContainer.style.display = 'block';
            
        } catch (error) {
            console.error('QRious failed:', error);
        }
    }
    
    // Try QRCode.js library
    if (typeof QRCode !== 'undefined' && !qrGenerated) {
        try {
            console.log('Trying QRCode.js library...');
            
            qrDiv.innerHTML = '';
            
            const qr = new QRCode(qrDiv, {
                text: gameUrl,
                width: 150,
                height: 150,
                colorDark: '#000000',   // Black QR code
                colorLight: '#ffffff'  // White background
            });
            
            qrGenerated = true;
            console.log('QR code generated successfully with QRCode.js');
            
            if (qrLoading) qrLoading.style.display = 'none';
            if (qrContainer) qrContainer.style.display = 'block';
            
            if (qrCanvas) qrCanvas.style.display = 'none';
            
        } catch (error) {
            console.error('QRCode.js failed:', error);
        }
    }
    
    // Fallback to placeholder
    if (!qrGenerated) {
        console.log('All QR libraries failed, using placeholder');
        setTimeout(() => {
            drawPlaceholderQR(qrCanvas, sessionCode);
            if (qrLoading) qrLoading.style.display = 'none';
            if (qrContainer) qrContainer.style.display = 'block';
            if (qrDiv) qrDiv.style.display = 'none';
        }, 1000);
    }
}

function drawPlaceholderQR(canvas, sessionCode) {
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    
    // Clear canvas - white background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 150, 150);
    
    // Draw border - black
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.strokeRect(5, 5, 140, 140);
    
    // QR pattern simulation (corners) - black
    ctx.fillStyle = '#000000';
    
    // Top-left corner
    ctx.fillRect(15, 15, 25, 25);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(20, 20, 15, 15);
    ctx.fillStyle = '#000000';
    ctx.fillRect(23, 23, 9, 9);
    
    // Top-right corner
    ctx.fillRect(110, 15, 25, 25);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(115, 20, 15, 15);
    ctx.fillStyle = '#000000';
    ctx.fillRect(118, 23, 9, 9);
    
    // Bottom-left corner
    ctx.fillRect(15, 110, 25, 25);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(20, 115, 15, 15);
    ctx.fillStyle = '#000000';
    ctx.fillRect(23, 118, 9, 9);
    
    // Random pattern in middle - black
    ctx.fillStyle = '#000000';
    for (let i = 0; i < 20; i++) {
        const x = Math.floor(Math.random() * 100) + 25;
        const y = Math.floor(Math.random() * 100) + 25;
        ctx.fillRect(x, y, 3, 3);
    }
    
    // Center text - black
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 10px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('SCAN QR', 75, 60);
    ctx.font = '8px Arial';
    ctx.fillText(`Code: ${sessionCode}`, 75, 75);
    ctx.fillText('or enter code', 75, 87);
}

function handleDirectionFromMobile(direction) {
    console.log('Handling direction from mobile:', direction);
    
    const directionMap = {
        'up': { x: 0, y: -1 },
        'down': { x: 0, y: 1 },
        'left': { x: -1, y: 0 },
        'right': { x: 1, y: 0 }
    };
    
    const newDirection = directionMap[direction];
    if (newDirection && gameState.currentState === GameState.PLAYING) {
        // Prevent reverse direction
        if (gameState.direction.x !== -newDirection.x || gameState.direction.y !== -newDirection.y) {
            gameState.nextDirection = newDirection;
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
    gameState.direction = { x: 0, y: 0 };
    gameState.nextDirection = { x: 0, y: 0 };
    
    const gameOverScreen = document.getElementById('game-over');
    if (gameOverScreen) {
        gameOverScreen.classList.add('hidden');
    }
}

function updateGame(currentTime) {
    if (!gameState.gameRunning) return;
    
    const deltaTime = currentTime - gameState.lastUpdateTime;
    
    if (deltaTime >= gameState.speed && gameState.currentState === GameState.PLAYING) {
        if (gameState.nextDirection.x !== 0 || gameState.nextDirection.y !== 0) {
            gameState.direction = { ...gameState.nextDirection };
        }
        
        if (gameState.direction.x !== 0 || gameState.direction.y !== 0) {
            moveSnake();
        }
        
        gameState.lastUpdateTime = currentTime;
    }
    
    renderGame();
    
    if (gameState.gameRunning) {
        gameLoop = requestAnimationFrame(updateGame);
    }
}

function moveSnake() {
    const head = { ...gameState.snake[0] };
    head.x += gameState.direction.x;
    head.y += gameState.direction.y;
    
    // Check wall collision
    if (head.x < 0 || head.x >= GRID_WIDTH || head.y < 0 || head.y >= GRID_HEIGHT) {
        gameOver();
        return;
    }
    
    // Check self collision
    for (let segment of gameState.snake) {
        if (head.x === segment.x && head.y === segment.y) {
            gameOver();
            return;
        }
    }
    
    gameState.snake.unshift(head);
    
    // Check food collision
    if (head.x === gameState.food.x && head.y === gameState.food.y) {
        gameState.score += 10;
        updateScore();
        generateFood();
        
        if (gameState.speed > gameConfig.minSpeed) {
            gameState.speed = Math.max(gameConfig.minSpeed, gameState.speed - gameConfig.speedIncrease);
        }
    } else {
        gameState.snake.pop();
    }
}

function generateFood() {
    let foodPosition;
    do {
        foodPosition = {
            x: Math.floor(Math.random() * GRID_WIDTH),
            y: Math.floor(Math.random() * GRID_HEIGHT)
        };
    } while (gameState.snake.some(segment => segment.x === foodPosition.x && segment.y === foodPosition.y));
    
    gameState.food = foodPosition;
}

function drawArrowHead(ctx, x, y, direction, size) {
    const centerX = x + size / 2;
    const centerY = y + size / 2;
    
    ctx.shadowColor = colors.snakeHead;
    ctx.shadowBlur = 10;
    
    ctx.fillStyle = colors.snakeHead;
    ctx.beginPath();
    
    // Create arrow shape based on direction
    if (direction.x === 0 && direction.y === -1) { // Up
        ctx.moveTo(centerX, y + 2);
        ctx.lineTo(x + 2, y + size - 2);
        ctx.lineTo(x + size - 2, y + size - 2);
    } else if (direction.x === 0 && direction.y === 1) { // Down
        ctx.moveTo(centerX, y + size - 2);
        ctx.lineTo(x + 2, y + 2);
        ctx.lineTo(x + size - 2, y + 2);
    } else if (direction.x === -1 && direction.y === 0) { // Left
        ctx.moveTo(x + 2, centerY);
        ctx.lineTo(x + size - 2, y + 2);
        ctx.lineTo(x + size - 2, y + size - 2);
    } else if (direction.x === 1 && direction.y === 0) { // Right
        ctx.moveTo(x + size - 2, centerY);
        ctx.lineTo(x + 2, y + 2);
        ctx.lineTo(x + 2, y + size - 2);
    } else {
        // Default case - draw regular square if no direction (stationary)
        ctx.rect(x + 1, y + 1, size - 2, size - 2);
    }
    
    ctx.closePath();
    ctx.fill();
    
    ctx.shadowBlur = 0;
    
    // Add a border
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.stroke();
}

function renderGame() {
    if (!ctx) return;
    
    // Clear canvas
    ctx.fillStyle = colors.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw snake body segments (skip head) with glow effect
    ctx.shadowColor = colors.snake;
    ctx.shadowBlur = 5;
    ctx.fillStyle = colors.snake;
    for (let i = 1; i < gameState.snake.length; i++) {
        const segment = gameState.snake[i];
        ctx.fillRect(
            segment.x * gameConfig.gridSize + 1,
            segment.y * gameConfig.gridSize + 1,
            gameConfig.gridSize - 2,
            gameConfig.gridSize - 2
        );
    }
    
    ctx.shadowBlur = 0;
    
    // Draw snake head as arrow (or square if stationary)
    if (gameState.snake.length > 0) {
        const head = gameState.snake[0];
        drawArrowHead(
            ctx, 
            head.x * gameConfig.gridSize, 
            head.y * gameConfig.gridSize, 
            gameState.direction, 
            gameConfig.gridSize
        );
    }
    
    // Draw food with glow effect
    ctx.shadowColor = colors.food;
    ctx.shadowBlur = 8;
    ctx.fillStyle = colors.food;
    ctx.fillRect(
        gameState.food.x * gameConfig.gridSize + 1,
        gameState.food.y * gameConfig.gridSize + 1,
        gameConfig.gridSize - 2,
        gameConfig.gridSize - 2
    );
    
    ctx.shadowBlur = 0;
    
    // Show "Waiting for mobile controller" message
    if (gameState.currentState === GameState.WAITING_FOR_START) {
        ctx.fillStyle = 'rgba(15, 15, 35, 0.9)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Create gradient text
        const gradient = ctx.createLinearGradient(0, canvas.height / 2 - 40, 0, canvas.height / 2 + 80);
        gradient.addColorStop(0, '#ff1493');
        gradient.addColorStop(0.5, '#ff6b35');
        gradient.addColorStop(1, '#f72585');
        
        ctx.fillStyle = gradient;
        ctx.font = 'bold 28px Orbitron, monospace';
        ctx.textAlign = 'center';
        ctx.shadowColor = '#ff1493';
        ctx.shadowBlur = 10;
        
        ctx.fillText('Waiting for Mobile Controller', canvas.width / 2, canvas.height / 2 - 20);
        ctx.fillText('Press START to Begin!', canvas.width / 2, canvas.height / 2 + 20);
        
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
    const statusElement = document.getElementById('connection-status');
    if (statusElement) {
        statusElement.textContent = status;
    }
}

function gameOver() {
    console.log('Game over! Final score:', gameState.score);
    gameState.currentState = GameState.GAME_OVER;
    
    const finalScoreElement = document.getElementById('final-score');
    if (finalScoreElement) {
        finalScoreElement.textContent = gameState.score.toString();
    }
    
    const gameOverScreen = document.getElementById('game-over');
    if (gameOverScreen) {
        gameOverScreen.classList.remove('hidden');
    }
    
    // Update Firebase with game over state
    updateGameStateInFirebase();
}

function restartGame() {
    console.log('Restarting game from mobile controller!');
    
    gameState = {
        snake: createInitialSnake(),
        direction: { x: 0, y: 0 },
        nextDirection: { x: 0, y: 0 },
        food: { x: Math.floor(GRID_WIDTH / 4), y: Math.floor(GRID_HEIGHT / 4) },
        score: 0,
        gameRunning: true,
        speed: gameConfig.initialSpeed,
        lastUpdateTime: 0,
        currentState: GameState.PLAYING
    };
    
    updateScore();
    
    const gameOverScreen = document.getElementById('game-over');
    if (gameOverScreen) {
        gameOverScreen.classList.add('hidden');
    }
    
    generateFood();
    
    // Update Firebase with restart
    updateGameStateInFirebase();
}

function updateGameStateInFirebase() {
    if (firebaseReady && database && sessionManager.currentSession) {
        const sessionRef = database.ref(`sessions/${sessionManager.currentSession}/gameState`);
        sessionRef.update({
            state: gameState.currentState,
            score: gameState.score
        }).catch(error => {
            console.error('Error updating game state in Firebase:', error);
        });
    }
}

// Mobile Controller Functions
function initializeMobileController() {
    console.log('Initializing mobile controller...');
    
    // Check for session code in URL
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
    
    // Direction buttons
    const directions = ['up', 'down', 'left', 'right'];
    directions.forEach(direction => {
        const btn = document.getElementById(`btn-${direction}`);
        if (btn) {
            btn.addEventListener('click', () => sendDirection(direction));
            btn.addEventListener('touchstart', (e) => {
                e.preventDefault();
                sendDirection(direction);
                btn.classList.add('active');
            });
            btn.addEventListener('touchend', (e) => {
                e.preventDefault();
                btn.classList.remove('active');
            });
        }
    });
    
    // Center button for start/restart
    const centerBtn = document.getElementById('btn-center');
    if (centerBtn) {
        centerBtn.addEventListener('click', () => sendGameAction('start_restart'));
        centerBtn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            if (!centerBtn.disabled) {
                sendGameAction('start_restart');
                centerBtn.classList.add('active');
            }
        });
        centerBtn.addEventListener('touchend', (e) => {
            e.preventDefault();
            centerBtn.classList.remove('active');
        });
    }
}

function connectToSession(sessionCode) {
    console.log('Attempting to connect to session:', sessionCode);
    
    if (firebaseReady && database) {
        connectViaFirebase(sessionCode);
    } else {
        connectViaLocalStorage(sessionCode);
    }
}

async function connectViaFirebase(sessionCode) {
    try {
        const sessionRef = database.ref(`sessions/${sessionCode}`);
        
        sessionRef.once('value', (snapshot) => {
            if (snapshot.exists()) {
                sessionManager.connectedSession = sessionCode;
                showControllerInterface();
                showConnectionSuccess();
                console.log('Connected to Firebase session:', sessionCode);
                
                // Listen for game state changes to enable/disable center button
                sessionRef.child('gameState').on('value', (stateSnapshot) => {
                    const gameStateData = stateSnapshot.val();
                    if (gameStateData) {
                        updateCenterButton(gameStateData.state);
                    }
                });
                
                // Initial center button state
                updateCenterButton(GameState.WAITING_FOR_START);
                
            } else {
                showConnectionError('Session not found. Make sure the game is running on desktop.');
            }
        });
        
    } catch (error) {
        console.error('Firebase connection error:', error);
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
        
        // For localStorage, assume we can always start
        updateCenterButton(GameState.WAITING_FOR_START);
        
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

function updateCenterButton(currentState) {
    const centerBtn = document.getElementById('btn-center');
    if (!centerBtn) return;
    
    const btnLabel = centerBtn.querySelector('.btn-label');
    
    if (currentState === GameState.WAITING_FOR_START) {
        centerBtn.disabled = false;
        if (btnLabel) btnLabel.textContent = 'START';
    } else if (currentState === GameState.GAME_OVER) {
        centerBtn.disabled = false;
        if (btnLabel) btnLabel.textContent = 'RESTART';
    } else {
        centerBtn.disabled = true;
        if (btnLabel) btnLabel.textContent = 'PLAYING';
    }
}

function sendDirection(direction) {
    if (!sessionManager.connectedSession) {
        console.error('No connected session');
        return;
    }
    
    console.log('Sending direction:', direction);
    
    if (firebaseReady && database) {
        sendDirectionFirebase(direction);
    } else {
        sendDirectionLocalStorage(direction);
    }
    
    // Visual feedback
    const btn = document.getElementById(`btn-${direction}`);
    if (btn) {
        btn.classList.add('pressed');
        setTimeout(() => btn.classList.remove('pressed'), 200);
    }
}

function sendGameAction(action) {
    if (!sessionManager.connectedSession) {
        console.error('No connected session');
        return;
    }
    
    const actionToSend = action === 'start_restart' ? 'start' : action;
    console.log('Sending game action:', actionToSend);
    
    if (firebaseReady && database) {
        sendGameActionFirebase(actionToSend);
    } else {
        sendGameActionLocalStorage(actionToSend);
    }
}

async function sendDirectionFirebase(direction) {
    try {
        const sessionRef = database.ref(`sessions/${sessionManager.connectedSession}`);
        await sessionRef.update({
            connected: true,
            lastDirection: direction,
            timestamp: Date.now()
        });
        console.log('Direction sent via Firebase:', direction);
    } catch (error) {
        console.error('Error sending direction to Firebase:', error);
        sendDirectionLocalStorage(direction);
    }
}

async function sendGameActionFirebase(action) {
    try {
        const sessionRef = database.ref(`sessions/${sessionManager.connectedSession}`);
        await sessionRef.update({
            connected: true,
            gameAction: action,
            timestamp: Date.now()
        });
        console.log('Game action sent via Firebase:', action);
    } catch (error) {
        console.error('Error sending game action to Firebase:', error);
        sendGameActionLocalStorage(action);
    }
}

function sendDirectionLocalStorage(direction) {
    const sessionData = {
        direction: direction,
        timestamp: Date.now()
    };
    
    localStorage.setItem(`session_${sessionManager.connectedSession}`, JSON.stringify(sessionData));
    console.log('Direction sent via localStorage:', direction);
}

function sendGameActionLocalStorage(action) {
    const sessionData = {
        gameAction: action,
        timestamp: Date.now()
    };
    
    localStorage.setItem(`session_${sessionManager.connectedSession}`, JSON.stringify(sessionData));
    console.log('Game action sent via localStorage:', action);
}