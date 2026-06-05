// ==========================================
// PURE GAME LOGIC
// ==========================================
// Side-effect-free helpers used by the game loop (game.js) and input handling
// (network.js). Everything is passed in as arguments (no globals), so these can
// be unit-tested in Node — see tests/logic.test.js. The module.exports block at
// the bottom is a no-op in the browser (classic <script>), where `module` is
// undefined; it only activates under Node/Vitest.

/**
 * Wrap an angle (radians) into the range [0, 2π).
 * @param {number} angle
 * @returns {number}
 */
function normalizeAngle(angle) {
    while (angle < 0) angle += 2 * Math.PI;
    while (angle >= 2 * Math.PI) angle -= 2 * Math.PI;
    return angle;
}

/**
 * Smallest signed turn (radians) from `current` to `target`, in [-π, π].
 * @param {number} target
 * @param {number} current
 * @returns {number}
 */
function shortestAngleDelta(target, current) {
    let diff = target - current;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    return diff;
}

/**
 * Advance `current` heading toward `target` by at most `turnSpeed`, snapping to
 * the target once within range. Result is normalized to [0, 2π).
 * @param {number} current
 * @param {number} target
 * @param {number} turnSpeed
 * @returns {number}
 */
function stepDirection(current, target, turnSpeed) {
    const diff = shortestAngleDelta(target, current);
    const next = Math.abs(diff) > turnSpeed
        ? current + Math.sign(diff) * turnSpeed
        : target;
    return normalizeAngle(next);
}

/**
 * True if the head has crossed the playable boundary.
 * @param {{x:number,y:number}} head
 * @param {object} config - gameConfig (uses wallMargin, boardSize).
 * @returns {boolean}
 */
function hitsWall(head, config) {
    return head.x < config.wallMargin ||
        head.x > config.boardSize.width - config.wallMargin ||
        head.y < config.wallMargin ||
        head.y > config.boardSize.height - config.wallMargin;
}

/**
 * True if the head overlaps a body segment, ignoring the first
 * `minSelfCollisionSegments` segments (which are always near the head).
 * @param {{x:number,y:number}} head
 * @param {Array<{x:number,y:number}>} snake
 * @param {object} config - gameConfig (uses minSelfCollisionSegments, snakeSegmentSize).
 * @returns {boolean}
 */
function hitsSelf(head, snake, config) {
    for (let i = config.minSelfCollisionSegments; i < snake.length; i++) {
        const segment = snake[i];
        const distance = Math.hypot(head.x - segment.x, head.y - segment.y);
        if (distance < config.snakeSegmentSize * 0.8) return true;
    }
    return false;
}

/**
 * True if the head is close enough to the food to collect it.
 * @param {{x:number,y:number}} head
 * @param {{x:number,y:number}} food
 * @param {object} config - gameConfig (uses snakeSegmentSize, foodSize).
 * @returns {boolean}
 */
function eatsFood(head, food, config) {
    const distance = Math.hypot(head.x - food.x, head.y - food.y);
    return distance < (config.snakeSegmentSize + config.foodSize);
}

/**
 * Map a normalized joystick vector to a heading + speed. Below a small deadzone
 * the heading is left unchanged and the snake coasts at base speed.
 * @param {{x:number,y:number}} input - components in roughly [-1, 1].
 * @param {number} baseSpeed - current base speed (grows as the snake eats).
 * @param {object} config - gameConfig (uses maxSpeedBoost).
 * @returns {{active:boolean, targetDirection:(number|null), speed:number}}
 */
function joystickToControl(input, baseSpeed, config) {
    const magnitude = Math.hypot(input.x, input.y);
    if (magnitude > 0.1) {
        return {
            active: true,
            targetDirection: Math.atan2(input.y, input.x),
            speed: baseSpeed + Math.min(magnitude, 1) * config.maxSpeedBoost
        };
    }
    return { active: false, targetDirection: null, speed: baseSpeed };
}

// Expose for Node/Vitest only (no-op in the browser).
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        normalizeAngle,
        shortestAngleDelta,
        stepDirection,
        hitsWall,
        hitsSelf,
        eatsFood,
        joystickToControl
    };
}
