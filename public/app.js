import { database } from './firebase-config.js';
import { ref, set, onValue, push } from 'firebase/database';


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
    direction: { x: 0, y: 0 }, // Start stationary
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
    connections: new Map(),
    isDesktop: true,
    connectedSession: null
};

// Canvas and game elements
let canvas, ctx;
let gameLoop;

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    detectDevice();
    initializeApp();
});

function detectDevice() {
    const isMobile = window.innerWidth <= 768;
    sessionManager.isDesktop = !isMobile;
    
    console.log('Device detected:', sessionManager.isDesktop ? 'Desktop' : 'Mobile', 'Width:', window.innerWidth);
    
    if (sessionManager.isDesktop) {
        document.getElementById('desktop-view').style.display = 'block';
        document.getElementById('mobile-view').style.display = 'none';
    } else {
        document.getElementById('desktop-view').style.display = 'none';
        document.getElementById('mobile-view').style.display = 'block';
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
    canvas = document.getElementById('game-canvas');
    ctx = canvas.getContext('2d');
    
    // Set canvas size explicitly
    canvas.width = gameConfig.boardSize.width;
    canvas.height = gameConfig.boardSize.height;
    
    console.log('Canvas initialized:', canvas.width, 'x', canvas.height);
    console.log('Grid dimensions:', GRID_WIDTH, 'x', GRID_HEIGHT);
    
    // Generate session code
    generateNewSession();
    
    // Setup event listeners
    document.getElementById('restart-btn').addEventListener('click', restartGame);
    
    // Setup keyboard controls
    document.addEventListener('keydown', handleKeyPress);
    
    // Start the game immediately
    setTimeout(startGame, 100);
    
    // Simulate checking for mobile connections
    setInterval(checkForMobileConnections, 500);
}

/// Generate and store session in Firebase
function generateNewSession() {
    const sessionCode = generateSessionCode();
    const sessionRef = ref(database, `sessions/${sessionCode}`);
    
    set(sessionRef, {
        created: Date.now(),
        connected: false,
        lastDirection: null
    });
    
    sessionManager.currentSession = sessionCode;
    document.getElementById('session-code').textContent = sessionCode;
    generateQRCode(sessionCode);
    
    // Listen for mobile connections
    onValue(sessionRef, (snapshot) => {
        const data = snapshot.val();
        if (data && data.lastDirection) {
            handleDirectionChange(data.lastDirection);
        }
    });
}

// Handle mobile input
function sendDirectionToFirebase(sessionCode, direction) {
    const sessionRef = ref(database, `sessions/${sessionCode}`);
    set(sessionRef, {
        connected: true,
        lastDirection: direction,
        timestamp: Date.now()
    });
}


function generateQRCode(code) {
    const qrCanvas = document.getElementById('qr-code');
    const baseUrl = window.location.origin + window.location.pathname;
    const connectUrl = `${baseUrl}?connect=${code}`;
    
    console.log('Generating QR code for:', connectUrl);
    
    // Check if QRCode library is available
    if (typeof QRCode === 'undefined') {
        console.error('QRCode library not loaded');
        // Fallback: show text
        qrCanvas.style.display = 'none';
        const textNode = document.createElement('div');
        textNode.textContent = 'QR Code URL: ' + connectUrl;
        textNode.style.fontSize = '12px';
        textNode.style.wordBreak = 'break-all';
        textNode.style.padding = '10px';
        textNode.style.background = 'white';
        textNode.style.color = 'black';
        textNode.style.borderRadius = '8px';
        qrCanvas.parentNode.appendChild(textNode);
        return;
    }
    
    QRCode.toCanvas(qrCanvas, connectUrl, {
        width: 150,
        margin: 2,
        color: {
            dark: '#000000',
            light: '#FFFFFF'
        }
    }, function(error) {
        if (error) {
            console.error('QR Code generation failed:', error);
        } else {
            console.log('QR Code generated successfully');
        }
    });
}

function startGame() {
    resetGameState();
    gameState.gameRunning = true;
    gameState.lastUpdateTime = Date.now();
    document.getElementById('game-over').classList.add('hidden');
    
    console.log('Game started');
    console.log('Initial snake position:', gameState.snake[0]);
    console.log('Initial food position:', gameState.food);
    
    // Clear any existing game loop
    if (gameLoop) {
        clearInterval(gameLoop);
    }
    
    // Start game loop
    gameLoop = setInterval(() => {
        if (gameState.gameRunning) {
            updateGame();
            draw();
        }
    }, gameState.speed);
    
    // Initial draw
    draw();
}

function resetGameState() {
    // Place snake in center of grid
    const centerX = Math.floor(GRID_WIDTH / 2);
    const centerY = Math.floor(GRID_HEIGHT / 2);
    
    gameState.snake = [{ x: centerX, y: centerY }];
    gameState.direction = { x: 0, y: 0 }; // Start stationary
    gameState.nextDirection = { x: 0, y: 0 };
    gameState.food = generateRandomFood();
    gameState.score = 0;
    gameState.speed = gameConfig.initialSpeed;
    gameState.lastUpdateTime = Date.now();
    updateScore();
    
    console.log('Game state reset');
    console.log('Snake position:', gameState.snake[0]);
    console.log('Grid boundaries: 0-' + (GRID_WIDTH-1) + ', 0-' + (GRID_HEIGHT-1));
}

function updateGame() {
    if (!gameState.gameRunning) return;
    
    // Only move if there's a direction set
    if (gameState.direction.x === 0 && gameState.direction.y === 0) {
        return;
    }
    
    // Update direction from next direction
    if (gameState.nextDirection.x !== 0 || gameState.nextDirection.y !== 0) {
        gameState.direction = { ...gameState.nextDirection };
        gameState.nextDirection = { x: 0, y: 0 };
    }
    
    moveSnake();
    
    if (checkCollision()) {
        endGame();
        return;
    }
    
    if (checkFoodCollision()) {
        eatFood();
    }
}

function moveSnake() {
    const head = { ...gameState.snake[0] };
    head.x += gameState.direction.x;
    head.y += gameState.direction.y;
    
    gameState.snake.unshift(head);
    
    // Only remove tail if no food was eaten
    if (!checkFoodCollision()) {
        gameState.snake.pop();
    }
}

function checkCollision() {
    const head = gameState.snake[0];
    
    // Wall collision - check against grid boundaries
    if (head.x < 0 || head.x >= GRID_WIDTH || head.y < 0 || head.y >= GRID_HEIGHT) {
        console.log('Wall collision detected at:', head, 'Grid size:', GRID_WIDTH, 'x', GRID_HEIGHT);
        return true;
    }
    
    // Self collision - only check if snake is longer than 1 segment
    if (gameState.snake.length > 1) {
        for (let i = 1; i < gameState.snake.length; i++) {
            if (head.x === gameState.snake[i].x && head.y === gameState.snake[i].y) {
                console.log('Self collision detected');
                return true;
            }
        }
    }
    
    return false;
}

function checkFoodCollision() {
    const head = gameState.snake[0];
    return head.x === gameState.food.x && head.y === gameState.food.y;
}

function eatFood() {
    gameState.score += 10;
    updateScore();
    
    console.log('Food eaten, score:', gameState.score);
    
    // Generate new food
    gameState.food = generateRandomFood();
    
    // Increase speed slightly
    if (gameState.speed > gameConfig.minSpeed) {
        gameState.speed = Math.max(gameState.speed - gameConfig.speedIncrease, gameConfig.minSpeed);
        console.log('Speed increased to:', gameState.speed);
        
        // Restart game loop with new speed
        clearInterval(gameLoop);
        gameLoop = setInterval(() => {
            if (gameState.gameRunning) {
                updateGame();
                draw();
            }
        }, gameState.speed);
    }
}

function generateRandomFood() {
    let food;
    let attempts = 0;
    do {
        food = {
            x: Math.floor(Math.random() * GRID_WIDTH),
            y: Math.floor(Math.random() * GRID_HEIGHT)
        };
        attempts++;
    } while (gameState.snake.some(segment => segment.x === food.x && segment.y === food.y) && attempts < 100);
    
    console.log('New food generated at:', food);
    return food;
}

function draw() {
    if (!ctx) return;
    
    // Clear canvas with background color
    ctx.fillStyle = colors.background;
    ctx.fillRect(0, 0, gameConfig.boardSize.width, gameConfig.boardSize.height);
    
    // Draw grid lines (subtle)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    for (let x = 0; x < gameConfig.boardSize.width; x += gameConfig.gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, gameConfig.boardSize.height);
        ctx.stroke();
    }
    for (let y = 0; y < gameConfig.boardSize.height; y += gameConfig.gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(gameConfig.boardSize.width, y);
        ctx.stroke();
    }
    
    // Draw snake
    gameState.snake.forEach((segment, index) => {
        const x = segment.x * gameConfig.gridSize;
        const y = segment.y * gameConfig.gridSize;
        
        if (index === 0) {
            // Head - brighter green with glow
            ctx.fillStyle = '#44ff44';
            ctx.shadowColor = colors.snake;
            ctx.shadowBlur = 10;
            ctx.fillRect(x + 1, y + 1, gameConfig.gridSize - 2, gameConfig.gridSize - 2);
        } else {
            // Body - normal green
            ctx.fillStyle = colors.snake;
            ctx.shadowColor = colors.snake;
            ctx.shadowBlur = 5;
            ctx.fillRect(x + 2, y + 2, gameConfig.gridSize - 4, gameConfig.gridSize - 4);
        }
    });
    
    // Draw food
    ctx.fillStyle = colors.food;
    ctx.shadowColor = colors.food;
    ctx.shadowBlur = 15;
    
    const foodX = gameState.food.x * gameConfig.gridSize;
    const foodY = gameState.food.y * gameConfig.gridSize;
    
    ctx.beginPath();
    ctx.arc(
        foodX + gameConfig.gridSize / 2,
        foodY + gameConfig.gridSize / 2,
        (gameConfig.gridSize / 2) - 3,
        0,
        2 * Math.PI
    );
    ctx.fill();
    
    // Reset shadow
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
}

function endGame() {
    gameState.gameRunning = false;
    clearInterval(gameLoop);
    console.log('Game ended with score:', gameState.score);
    
    document.getElementById('final-score').textContent = gameState.score;
    document.getElementById('game-over').classList.remove('hidden');
}

function restartGame() {
    console.log('Restarting game');
    startGame();
}

function updateScore() {
    document.getElementById('score').textContent = gameState.score;
}

function handleKeyPress(event) {
    if (!gameState.gameRunning) {
        if (event.key === ' ' || event.key === 'Enter') {
            if (!gameState.gameRunning) {
                startGame();
            }
        }
        return;
    }
    
    const key = event.key;
    let newDirection = null;
    
    switch (key) {
        case 'ArrowUp':
        case 'w':
        case 'W':
            if (gameState.direction.y === 0) { // Not moving vertically
                newDirection = { x: 0, y: -1 };
            }
            break;
        case 'ArrowDown':
        case 's':
        case 'S':
            if (gameState.direction.y === 0) { // Not moving vertically
                newDirection = { x: 0, y: 1 };
            }
            break;
        case 'ArrowLeft':
        case 'a':
        case 'A':
            if (gameState.direction.x === 0) { // Not moving horizontally
                newDirection = { x: -1, y: 0 };
            }
            break;
        case 'ArrowRight':
        case 'd':
        case 'D':
            if (gameState.direction.x === 0) { // Not moving horizontally
                newDirection = { x: 1, y: 0 };
            }
            break;
    }
    
    if (newDirection) {
        changeDirection(newDirection);
    }
    
    event.preventDefault();
}

function changeDirection(newDirection) {
    // Prevent reversing into self
    if (newDirection.x === -gameState.direction.x && newDirection.y === -gameState.direction.y) {
        return;
    }
    
    // If currently stationary, apply direction immediately
    if (gameState.direction.x === 0 && gameState.direction.y === 0) {
        gameState.direction = newDirection;
    } else {
        gameState.nextDirection = newDirection;
    }
    
    console.log('Direction changed to:', newDirection);
}

// Mobile Controller Functions
function initializeMobileController() {
    console.log('Initializing mobile controller');
    
    // Check URL for connection code
    const urlParams = new URLSearchParams(window.location.search);
    const connectCode = urlParams.get('connect');
    
    if (connectCode) {
        document.getElementById('code-input').value = connectCode.toUpperCase();
        setTimeout(() => connectToSession(), 500);
    }
    
    // Setup event listeners
    document.getElementById('connect-btn').addEventListener('click', connectToSession);
    document.getElementById('code-input').addEventListener('input', handleCodeInput);
    document.getElementById('code-input').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            connectToSession();
        }
    });
    
    // Direction buttons
    const directionBtns = document.querySelectorAll('.direction-btn');
    directionBtns.forEach(btn => {
        // Add both touch and click events
        btn.addEventListener('touchstart', handleDirectionPress, { passive: false });
        btn.addEventListener('click', handleDirectionPress);
        
        // Prevent context menu on long press
        btn.addEventListener('contextmenu', e => e.preventDefault());
    });
}

function handleCodeInput(event) {
    const input = event.target;
    input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function connectToSession(sessionCode) {
    const sessionRef = ref(database, `sessions/${sessionCode}`);
    
    // Check if session exists
    onValue(sessionRef, (snapshot) => {
        if (snapshot.exists()) {
            sessionManager.connectedSession = sessionCode;
            showConnectionSuccess();
        } else {
            showConnectionError();
        }
    });
}

function sendDirection(direction) {
    if (sessionManager.connectedSession) {
        sendDirectionToFirebase(sessionManager.connectedSession, direction);
    }
}

function showControllerInterface() {
    document.getElementById('controller-interface').classList.remove('hidden');
}

function updateMobileConnectionStatus(message, connected) {
    const statusText = document.getElementById('mobile-connection-text');
    const statusDot = document.querySelector('#mobile-connection-status .status-dot');
    
    statusText.textContent = message;
    
    if (connected) {
        statusDot.classList.add('connected');
    } else {
        statusDot.classList.remove('connected');
    }
}

function handleDirectionPress(event) {
    event.preventDefault();
    
    if (!sessionManager.connectedSession) return;
    
    const button = event.currentTarget;
    const direction = button.getAttribute('data-direction');
    
    if (direction) {
        sendDirectionToDesktop(direction);
        animateButtonPress(button);
        console.log('Direction pressed:', direction);
    }
}

function animateButtonPress(button) {
    button.style.transform = 'scale(0.85)';
    button.style.background = 'rgba(0, 255, 255, 0.4)';
    button.style.boxShadow = '0 0 30px rgba(0, 255, 255, 0.6)';
    
    setTimeout(() => {
        button.style.transform = '';
        button.style.background = '';
        button.style.boxShadow = '';
    }, 150);
}

function sendDirectionToDesktop(direction) {
    const directionMap = {
        'up': { x: 0, y: -1 },
        'down': { x: 0, y: 1 },
        'left': { x: -1, y: 0 },
        'right': { x: 1, y: 0 }
    };
    
    const newDirection = directionMap[direction];
    
    if (newDirection) {
        // Store direction in session for cross-device communication simulation
        simulateDirectionMessage(sessionManager.connectedSession, newDirection);
    }
}

// Cross-device communication simulation
function simulateDirectionMessage(sessionCode, direction) {
    if (sessionManager.connections.has(sessionCode)) {
        const session = sessionManager.connections.get(sessionCode);
        session.lastDirection = direction;
        session.lastDirectionTime = Date.now();
        console.log('Direction sent to session:', sessionCode, direction);
    }
}

function checkForMobileConnections() {
    if (!sessionManager.currentSession) return;
    
    const session = sessionManager.connections.get(sessionManager.currentSession.code);
    if (!session) return;
    
    // Check connection status
    const isConnected = session.connectedDevices && session.connectedDevices.length > 0;
    updateDesktopConnectionStatus(isConnected);
    
    // Check for direction commands from mobile
    if (session.lastDirection && session.lastDirectionTime) {
        const timeDiff = Date.now() - session.lastDirectionTime;
        
        // Process direction if it's recent (within 500ms)
        if (timeDiff < 500) {
            changeDirection(session.lastDirection);
            session.lastDirection = null; // Clear after processing
        }
    }
}

function updateDesktopConnectionStatus(connected) {
    const statusText = document.getElementById('connection-text');
    const statusDot = document.querySelector('#connection-indicator .status-dot');
    
    if (connected) {
        statusText.textContent = 'Mobile controller connected!';
        statusDot.classList.add('connected');
    } else {
        statusText.textContent = 'Waiting for connection...';
        statusDot.classList.remove('connected');
    }
}

// Handle window resize
window.addEventListener('resize', function() {
    const wasDesktop = sessionManager.isDesktop;
    detectDevice();
    
    if (wasDesktop !== sessionManager.isDesktop) {
        location.reload();
    }
});

// Prevent zoom on double tap (mobile)
let lastTouchEnd = 0;
document.addEventListener('touchend', function(event) {
    const now = (new Date()).getTime();
    if (now - lastTouchEnd <= 300) {
        event.preventDefault();
    }
    lastTouchEnd = now;
}, false);

// Prevent pull-to-refresh
document.addEventListener('touchstart', function(e) {
    if (e.touches.length > 1) {
        e.preventDefault();
    }
});

document.addEventListener('touchmove', function(e) {
    if (e.target.closest('.direction-btn') || e.target.closest('#code-input')) {
        return; // Allow touch on interactive elements
    }
    e.preventDefault();
}, { passive: false });