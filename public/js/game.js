// ==========================================
// DESKTOP GAME ENGINE
// ==========================================

/**
 * Grabs the canvas, sets dimensions, generates a session, and loops.
 */
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

/**
 * Bootstraps the animation frame calls
 */
function startGameLoop() {
    console.log('🎮 Starting game loop with constant movement...');
    gameState.gameRunning = true;
    gameState.lastUpdateTime = performance.now();
    gameState.lastMoveTime = performance.now();
    
    generateFood();
    gameLoop = requestAnimationFrame(updateGame);
    renderGame();
}

/**
 * Used from the mobile start button to officially begin moving the snake 
 */
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

/**
 * Resets variables and triggers another fresh game
 */
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
        lastUpdateTime: performance.now(),
        lastMoveTime: performance.now(),
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

/**
 * RequestAnimationFrame engine pulse
 */
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

/**
 * Eases the snake logic towards the target rotation from the joystick
 */
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

/**
 * ENHANCED MOVEMENT: Snake ALWAYS moves forward and checks collisions
 */
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

/**
 * Handles smooth following for the segments
 */
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

/**
 * Automatically places a new tail segment appropriately
 */
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

/**
 * Spawns food randomly, avoiding snake body proximity
 */
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

/**
 * Repaints the entire canvas for the frame
 */
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

/**
 * Sets HTML elements associated to text
 */
function updateScore() {
    const scoreElement = document.getElementById('score');
    if (scoreElement) {
        scoreElement.textContent = gameState.score.toString();
    }
}

/**
 * Triggers game over GUI modal
 */
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

/**
 * Used by desktop or network logger to show active status
 */
function updateConnectionStatus(status) {
    console.log('🔗 Connection status:', status);
}
