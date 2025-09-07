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

// Wait for Firebase to be ready
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

// Initialize Firebase when DOM is ready or Firebase is loaded
if (typeof firebase !== 'undefined') {
    initializeFirebase();
} else {
    // Wait for Firebase to load
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

const colors = {
    background: "#0a0a0a",
    snake: "#00ff00",
    food: "#ff0000",
    border: "#333333",
    text: "#ffffff",
    accent: "#00ffff"
};

// Calculate grid dimensions
const GRID_WIDTH = Math.floor(gameConfig.boardSize.width / gameConfig.gridSize);
const GRID_HEIGHT = Math.floor(gameConfig.boardSize.height / gameConfig.gridSize);

// Global game state
let gameState = {
    snake: [{ x: Math.floor(GRID_WIDTH / 2), y: Math.floor(GRID_HEIGHT / 2) }],
    direction: { x: 0, y: 0 },
    nextDirection: { x: 0, y: 0 },
    food: { x: Math.floor(GRID_WIDTH / 4), y: Math.floor(GRID_HEIGHT / 4) },
    score: 0,
    gameRunning: false,
    speed: gameConfig.initialSpeed,
    lastUpdateTime: 0
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
    // Wait a bit for libraries to load
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
    
    // Setup event listeners
    const restartBtn = document.getElementById('restart-btn');
    if (restartBtn) {
        restartBtn.addEventListener('click', restartGame);
    }
    
    // Setup keyboard controls as fallback
    document.addEventListener('keydown', handleKeyPress);
    
    // Start game
    startGame();
}

function generateNewSession() {
    // Generate random 6-digit numeric code
    const sessionCode = Math.floor(100000 + Math.random() * 900000).toString();
    sessionManager.currentSession = sessionCode;
    
    console.log('Generated session code:', sessionCode);
    
    // Update UI
    const sessionCodeElement = document.getElementById('session-code');
    if (sessionCodeElement) {
        sessionCodeElement.textContent = sessionCode;
    }
    
    generateQRCode(sessionCode);
    updateConnectionStatus('Waiting for mobile connection...');
    
    // Setup Firebase or fallback to localStorage
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
            gameState: {
                active: true,
                score: 0
            }
        });
        
        console.log('Session created in Firebase:', sessionCode);
        sessionManager.firebaseConnected = true;
        updateConnectionStatus('Firebase connected - Waiting for mobile...');
        
        // Listen for mobile controller input
        sessionRef.on('value', (snapshot) => {
            const data = snapshot.val();
            if (data && data.lastDirection && data.connected) {
                console.log('Received direction from Firebase:', data.lastDirection);
                handleDirectionFromMobile(data.lastDirection);
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
                updateConnectionStatus('Mobile connected via localStorage');
            }
        }
    });
}

function generateQRCode(sessionCode) {
    console.log('Generating QR code for session:', sessionCode);
    
    const qrCanvas = document.getElementById('qr-code');
    if (!qrCanvas) {
        console.error('QR canvas not found!');
        return;
    }
    
    const gameUrl = `${window.location.origin}${window.location.pathname}?session=${sessionCode}`;
    console.log('QR URL:', gameUrl);
    
    // Check if QRCode library is loaded
    if (typeof QRCode !== 'undefined') {
        try {
            QRCode.toCanvas(qrCanvas, gameUrl, {
                width: 150,
                margin: 2,
                color: {
                    dark: '#00ffff',
                    light: '#ffffff'
                }
            }, function(error) {
                if (error) {
                    console.error('QR Code generation error:', error);
                    drawPlaceholderQR(qrCanvas, sessionCode);
                } else {
                    console.log('QR code generated successfully');
                }
            });
        } catch (error) {
            console.error('QRCode execution error:', error);
            drawPlaceholderQR(qrCanvas, sessionCode);
        }
    } else {
        console.warn('QRCode library not loaded, drawing placeholder');
        drawPlaceholderQR(qrCanvas, sessionCode);
    }
}

function drawPlaceholderQR(canvas, sessionCode) {
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#333';
    ctx.fillRect(0, 0, 150, 150);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('QR Code', 75, 60);
    ctx.fillText('Placeholder', 75, 80);
    ctx.font = '12px Arial';
    ctx.fillText(`Code: ${sessionCode}`, 75, 110);
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
    if (newDirection && gameState.gameRunning) {
        // Prevent reverse direction
        if (gameState.direction.x !== -newDirection.x || gameState.direction.y !== -newDirection.y) {
            gameState.nextDirection = newDirection;
        }
    }
}

function handleKeyPress(event) {
    if (!gameState.gameRunning) return;
    
    const keyDirections = {
        'ArrowUp': { x: 0, y: -1 },
        'ArrowDown': { x: 0, y: 1 },
        'ArrowLeft': { x: -1, y: 0 },
        'ArrowRight': { x: 1, y: 0 }
    };
    
    const newDirection = keyDirections[event.key];
    if (newDirection) {
        event.preventDefault();
        if (gameState.direction.x !== -newDirection.x || gameState.direction.y !== -newDirection.y) {
            gameState.nextDirection = newDirection;
        }
    }
}

function startGame() {
    console.log('Starting game...');
    gameState.gameRunning = true;
    gameState.lastUpdateTime = performance.now();
    
    const gameOverScreen = document.getElementById('game-over');
    if (gameOverScreen) {
        gameOverScreen.classList.add('hidden');
    }
    
    generateFood();
    gameLoop = requestAnimationFrame(updateGame);
    renderGame();
}

function updateGame(currentTime) {
    if (!gameState.gameRunning) return;
    
    const deltaTime = currentTime - gameState.lastUpdateTime;
    
    if (deltaTime >= gameState.speed) {
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

function renderGame() {
    if (!ctx) return;
    
    // Clear canvas
    ctx.fillStyle = colors.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw snake
    ctx.fillStyle = colors.snake;
    for (let segment of gameState.snake) {
        ctx.fillRect(
            segment.x * gameConfig.gridSize + 1,
            segment.y * gameConfig.gridSize + 1,
            gameConfig.gridSize - 2,
            gameConfig.gridSize - 2
        );
    }
    
    // Draw food
    ctx.fillStyle = colors.food;
    ctx.fillRect(
        gameState.food.x * gameConfig.gridSize + 1,
        gameState.food.y * gameConfig.gridSize + 1,
        gameConfig.gridSize - 2,
        gameConfig.gridSize - 2
    );
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
    gameState.gameRunning = false;
    
    const finalScoreElement = document.getElementById('final-score');
    if (finalScoreElement) {
        finalScoreElement.textContent = gameState.score.toString();
    }
    
    const gameOverScreen = document.getElementById('game-over');
    if (gameOverScreen) {
        gameOverScreen.classList.remove('hidden');
    }
}

function restartGame() {
    console.log('Restarting game...');
    
    gameState = {
        snake: [{ x: Math.floor(GRID_WIDTH / 2), y: Math.floor(GRID_HEIGHT / 2) }],
        direction: { x: 0, y: 0 },
        nextDirection: { x: 0, y: 0 },
        food: { x: Math.floor(GRID_WIDTH / 4), y: Math.floor(GRID_HEIGHT / 4) },
        score: 0,
        gameRunning: false,
        speed: gameConfig.initialSpeed,
        lastUpdateTime: 0
    };
    
    updateScore();
    startGame();
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
            // Auto-connect after a short delay
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
    
    const scanBtn = document.getElementById('scan-btn');
    if (scanBtn) {
        scanBtn.addEventListener('click', simulateQRScan);
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
        statusElement.style.color = '#00ff00';
    }
}

function showConnectionError(message) {
    const statusElement = document.getElementById('mobile-connection-status');
    if (statusElement) {
        statusElement.textContent = message;
        statusElement.style.color = '#ff0000';
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
        setTimeout(() => btn.classList.remove('pressed'), 150);
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
        // Fallback to localStorage
        sendDirectionLocalStorage(direction);
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

function simulateQRScan() {
    const sessionCode = prompt('Enter session code (simulated QR scan):');
    if (sessionCode && sessionCode.length === 6 && /^\d+$/.test(sessionCode)) {
        const sessionInput = document.getElementById('session-input');
        if (sessionInput) {
            sessionInput.value = sessionCode;
            connectToSession(sessionCode);
        }
    } else {
        showConnectionError('Invalid session code format');
    }
}