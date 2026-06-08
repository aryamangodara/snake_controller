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
    setupHiDPICanvas();
    // Re-scale if the window moves to a screen with a different pixel ratio.
    window.addEventListener('resize', () => { setupHiDPICanvas(); renderGame(); });

    generateNewSession();
    setupKeyboardControls();

    // Sound + leaderboard UI wiring (desktop only).
    updateHighScoreDisplay();
    updateMuteButton();
    const muteBtn = document.getElementById('mute-btn');
    if (muteBtn) muteBtn.addEventListener('click', toggleMute);

    // Game-over share card + Play Again button (share.js).
    if (typeof wireGameOverCard === 'function') wireGameOverCard();

    startGameLoop();
}

/**
 * Sizes the canvas backing store to the device pixel ratio so rendering is crisp on
 * HiDPI / retina screens, while keeping the logical drawing coordinate system at
 * gameConfig.boardSize (600x600). CSS controls the on-screen display size, so all
 * game math stays in logical pixels — only the resolution of the buffer changes.
 */
function setupHiDPICanvas() {
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = gameConfig.boardSize;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    // Draw in logical (CSS-pixel) coordinates; this transform scales to the buffer.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// Maps keyboard keys to direction vectors (screen coords: +y is down).
const KEY_VECTORS = {
    arrowup: { x: 0, y: -1 }, w: { x: 0, y: -1 },
    arrowdown: { x: 0, y: 1 }, s: { x: 0, y: 1 },
    arrowleft: { x: -1, y: 0 }, a: { x: -1, y: 0 },
    arrowright: { x: 1, y: 0 }, d: { x: 1, y: 0 }
};
const activeDirectionKeys = new Set();

/**
 * Lets the desktop host play with the keyboard (arrows / WASD to steer, Space or
 * Enter to start/restart) instead of needing a phone controller.
 */
function setupKeyboardControls() {
    document.addEventListener('keydown', (e) => {
        const key = e.key.toLowerCase();

        if (key === ' ' || key === 'enter') {
            e.preventDefault();
            if (gameState.currentState === GameState.WAITING_FOR_START) startGame();
            else if (gameState.currentState === GameState.GAME_OVER) restartGame();
            return;
        }

        if (KEY_VECTORS[key]) {
            e.preventDefault();
            activeDirectionKeys.add(key);
            applyKeyboardDirection();
        }
    });

    document.addEventListener('keyup', (e) => {
        const key = e.key.toLowerCase();
        if (KEY_VECTORS[key]) {
            activeDirectionKeys.delete(key);
            applyKeyboardDirection();
        }
    });
}

/**
 * Combines all currently-held direction keys into a heading + speed, reusing the
 * same joystick mapping so keyboard and phone control feel identical.
 */
function applyKeyboardDirection() {
    let x = 0, y = 0;
    for (const key of activeDirectionKeys) {
        x += KEY_VECTORS[key].x;
        y += KEY_VECTORS[key].y;
    }

    if (x === 0 && y === 0) {
        gameState.currentSpeed = gameState.baseSpeed; // no keys held: coast
        return;
    }

    const control = joystickToControl({ x, y }, gameState.baseSpeed, gameConfig);
    if (control.active) gameState.targetDirection = control.targetDirection;
    gameState.currentSpeed = control.speed;
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
    playStartSound();
    gameState.direction = 0; // Start facing right
    gameState.targetDirection = 0;
    gameState.baseSpeed = gameConfig.baseSpeed;
    gameState.currentSpeed = gameConfig.baseSpeed;
    gameState.joystickInput = { x: 0, y: 0 };
    gameState.frameCount = 0;
    gameState.lastMoveTime = performance.now();
    gameState.combo = 0;
    gameState.lastFoodTime = 0;
    resetEffects();
    updateComboDisplay();

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
        frameCount: 0,
        combo: 0,
        lastFoodTime: 0
    };

    updateScore();
    resetEffects();
    updateComboDisplay();

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
        // Always update direction smoothly (frame-rate-independent; needs elapsed time)
        updateSnakeDirection(deltaTime);
        
        // CONSTANT MOVEMENT: Snake moves every frame regardless of joystick input
        if (moveDeltaTime >= gameConfig.movementUpdateMs) {
            moveSnake();
            gameState.lastMoveTime = currentTime;
        }

        gameState.frameCount++;

        // Expire a stale combo so the badge clears if you dawdle between bites.
        if (gameState.combo > 0 && Date.now() - gameState.lastFoodTime > gameConfig.comboWindowMs) {
            gameState.combo = 0;
            updateComboDisplay();
        }
    }
    
    renderGame();
    gameState.lastUpdateTime = currentTime;
    
    if (gameState.gameRunning) {
        gameLoop = requestAnimationFrame(updateGame);
    }
}

// Frame-rate-independent turning: turnSpeed is calibrated per 60fps frame, so we
// scale each frame's turn by how long it actually took. Clamp protects against a
// huge jump after the tab is backgrounded (deltaTime can spike to seconds).
const TARGET_FRAME_MS = 1000 / 60;
const MAX_FRAME_STEP = 3;

/**
 * Eases the snake heading toward the joystick target. The per-frame turn step is
 * made frame-rate-independent (so 60 / 120 / 144Hz feel identical) and coupled to
 * speed (so the turn radius stays ~constant as the snake speeds up). See
 * logic.js:speedToTurnStep.
 * @param {number} deltaTime - ms elapsed since the previous frame.
 */
function updateSnakeDirection(deltaTime) {
    const frameFactor = Math.min(deltaTime / TARGET_FRAME_MS, MAX_FRAME_STEP);
    const turnStep = speedToTurnStep(
        gameConfig.turnSpeed,
        gameState.currentSpeed,
        gameConfig.baseSpeed,
        frameFactor,
        gameConfig.maxTurnSpeedFactor
    );
    gameState.direction = stepDirection(
        gameState.direction,
        gameState.targetDirection,
        turnStep
    );
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
    if (hitsWall(head, gameConfig)) {
        console.log('💥 Wall collision!');
        gameOver();
        return;
    }

    // Self collision detection
    if (hitsSelf(head, gameState.snake, gameConfig)) {
        console.log('💥 Self collision!');
        gameOver();
        return;
    }

    // Update head position
    gameState.snake[0] = head;
    updateSnakeSegments(prevHead);

    // Food collision detection
    if (eatsFood(head, gameState.food, gameConfig)) {
        const foodX = gameState.food.x;
        const foodY = gameState.food.y;
        const now = Date.now();

        // Combo: eating again within the window extends the streak (capped at maxCombo).
        gameState.combo = (now - gameState.lastFoodTime < gameConfig.comboWindowMs)
            ? gameState.combo + 1
            : 1;
        gameState.lastFoodTime = now;
        const multiplier = Math.min(gameState.combo, gameConfig.maxCombo);
        const gained = 10 * multiplier;
        gameState.score += gained;
        updateScore();
        updateComboDisplay();

        // Juice: particle burst + ripple + floating score at the point of the bite.
        spawnFoodBurst(foodX, foodY, colors.food);
        spawnScorePop(foodX, foodY,
            multiplier > 1 ? `+${gained} x${multiplier}` : `+${gained}`,
            multiplier > 1 ? colors.food : '#ffffff');

        playFoodSound(multiplier); // ascending pitch as the streak climbs
        sendHapticFeedback('food');
        generateFood();
        addSnakeSegment();

        // Increase base speed gradually
        if (gameState.baseSpeed < gameConfig.maxSpeed) {
            gameState.baseSpeed = Math.min(gameConfig.maxSpeed, gameState.baseSpeed + gameConfig.speedIncrease);
            gameState.currentSpeed = gameState.baseSpeed; // Update current speed too
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
    
    // Clear canvas (draw in logical coords; the HiDPI transform scales to the buffer)
    const W = gameConfig.boardSize.width;
    const H = gameConfig.boardSize.height;
    ctx.fillStyle = colors.background;
    ctx.fillRect(0, 0, W, H);

    // Screen-shake: everything below is drawn shifted; the offset decays to zero.
    const shake = getShakeOffset();
    ctx.save();
    ctx.translate(shake.x, shake.y);

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
        ctx.fillStyle = 'rgba(10, 10, 16, 0.9)';
        ctx.fillRect(0, 0, W, H);

        const gradient = ctx.createLinearGradient(0, H / 2 - 40, 0, H / 2 + 80);
        gradient.addColorStop(0, '#7df9ff');
        gradient.addColorStop(0.5, '#19c3b2');
        gradient.addColorStop(1, '#2de2c0');

        ctx.fillStyle = gradient;
        ctx.font = 'bold 24px Orbitron, monospace';
        ctx.textAlign = 'center';
        ctx.shadowColor = '#22d3c5';
        ctx.shadowBlur = 10;

        ctx.fillText('Waiting for Mobile Controller', W / 2, H / 2 - 20);
        ctx.fillText('Snake Moves Continuously - Be Ready!', W / 2, H / 2 + 20);
        
        ctx.shadowBlur = 0;
    }

    // Draw juice (particles, ripples, score pops) above the board.
    updateAndDrawEffects(ctx);

    ctx.restore(); // end screen-shake transform
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
 * Shows/hides the combo badge over the board. Visible only while a streak (x2+) is
 * active; reflects the capped multiplier.
 */
function updateComboDisplay() {
    const el = document.getElementById('combo-display');
    if (!el) return;
    const multiplier = Math.min(gameState.combo, gameConfig.maxCombo);
    if (multiplier > 1) {
        el.textContent = `🔥 x${multiplier}`;
        el.classList.remove('hidden');
    } else {
        el.classList.add('hidden');
    }
}

/**
 * Triggers game over GUI modal
 */
function gameOver() {
    console.log('💀 Game over! Final score:', gameState.score, 'Snake length:', gameState.snake.length);
    gameState.currentState = GameState.GAME_OVER;
    playCrashSound();
    sendHapticFeedback('crash');

    // Juice: screen shake + a debris burst at the head for crash impact.
    triggerShake(9, 340);
    const crashHead = gameState.snake[0];
    if (crashHead) spawnFoodBurst(crashHead.x, crashHead.y, colors.snakeHead);

    // The streak is over — clear the combo badge.
    gameState.combo = 0;
    updateComboDisplay();

    const finalScoreElement = document.getElementById('final-score');
    if (finalScoreElement) {
        finalScoreElement.textContent = gameState.score.toString();
    }

    // Record the run and surface a "new best" badge when earned.
    const isNewBest = recordScore(gameState.score);
    updateHighScoreDisplay();
    const newHighEl = document.getElementById('new-high-score');
    if (newHighEl) newHighEl.classList.toggle('hidden', !isNewBest);

    // Hitstop: let the impact register for a beat before the modal slides in. The
    // snake is already frozen (state = GAME_OVER), so the canvas just keeps shaking.
    const gameOverScreen = document.getElementById('game-over');
    if (gameOverScreen) {
        setTimeout(() => gameOverScreen.classList.remove('hidden'), 150);
    }

    updateGameStateInFirebase();
}

/**
 * Used by desktop or network logger to show active status
 */
function updateConnectionStatus(status) {
    console.log('🔗 Connection status:', status);
}
