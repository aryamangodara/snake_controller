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
 * Effective per-frame turn step — frame-rate-independent and speed-coupled.
 * - `frameFactor` (= elapsedMs / (1000/60), clamped by the caller) scales the step
 *   by how long the frame actually took, so angular velocity is identical on 60 /
 *   120 / 144Hz displays instead of changing with refresh rate.
 * - The speed term scales the turn rate with how fast the snake is moving (relative
 *   to `baseSpeed`), so the turn *radius* stays roughly constant as it speeds up —
 *   the snake stays as maneuverable at full tilt as it is at rest.
 * @param {number} baseTurn - config.turnSpeed (radians per 60fps frame).
 * @param {number} currentSpeed - the snake's current speed.
 * @param {number} baseSpeed - the reference (un-boosted) speed.
 * @param {number} frameFactor - elapsedMs / (1000/60), pre-clamped by the caller.
 * @param {number} maxSpeedFactor - upper clamp on the speed multiplier.
 * @returns {number} the turn step to pass to stepDirection().
 */
function speedToTurnStep(baseTurn, currentSpeed, baseSpeed, frameFactor, maxSpeedFactor) {
    const speedFactor = Math.min(currentSpeed / baseSpeed, maxSpeedFactor);
    return baseTurn * speedFactor * frameFactor;
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
 * True if the head overlaps any segment of `snake`, ignoring the first `skip`
 * segments. skip = minSelfCollisionSegments → classic self-collision (the first
 * segments are always near the head); skip = 0 → ANOTHER player's full snake,
 * head included — this is the multiplayer bite/head-on check.
 * @param {{x:number,y:number}} head
 * @param {Array<{x:number,y:number}>} snake
 * @param {number} skip - how many leading segments to ignore.
 * @param {object} config - gameConfig (uses snakeSegmentSize).
 * @returns {boolean}
 */
function hitsSnake(head, snake, skip, config) {
    for (let i = skip; i < snake.length; i++) {
        const segment = snake[i];
        const distance = Math.hypot(head.x - segment.x, head.y - segment.y);
        if (distance < config.snakeSegmentSize * 0.8) return true;
    }
    return false;
}

/**
 * True if the head overlaps its own body, ignoring the first
 * `minSelfCollisionSegments` segments (which are always near the head).
 * @param {{x:number,y:number}} head
 * @param {Array<{x:number,y:number}>} snake
 * @param {object} config - gameConfig (uses minSelfCollisionSegments, snakeSegmentSize).
 * @returns {boolean}
 */
function hitsSelf(head, snake, config) {
    return hitsSnake(head, snake, config.minSelfCollisionSegments, config);
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

/**
 * Spawn pose for one of N players: heads sit on a ring of radius 150 around the
 * board center, facing radially OUTWARD (away from each other), bodies extending
 * back toward the center. A 1-player game keeps the classic solo pose (center,
 * facing right) so solo layouts are unchanged.
 * @param {number} slotIndex - 0-based player index.
 * @param {number} playerCount - total players this round (1..maxPlayers).
 * @param {object} config - gameConfig (uses boardSize).
 * @returns {{x:number, y:number, heading:number}}
 */
function spawnPose(slotIndex, playerCount, config) {
    const cx = config.boardSize.width / 2;
    const cy = config.boardSize.height / 2;
    if (playerCount <= 1) return { x: cx, y: cy, heading: 0 };
    const heading = Math.PI / 2 + slotIndex * (2 * Math.PI / playerCount);
    return {
        x: cx + Math.cos(heading) * 150,
        y: cy + Math.sin(heading) * 150,
        heading: normalizeAngle(heading)
    };
}

/**
 * Build a snake body from a spawn pose: the head at the pose, segments trailing
 * opposite the heading. spawnPose(0, 1) + this reproduces createInitialSnake().
 * @param {{x:number, y:number, heading:number}} pose
 * @param {number} segmentCount
 * @param {number} spacing - gameConfig.segmentSpacing.
 * @returns {Array<{x:number, y:number}>}
 */
function snakeFromPose(pose, segmentCount, spacing) {
    const dx = -Math.cos(pose.heading) * spacing;
    const dy = -Math.sin(pose.heading) * spacing;
    return Array.from({ length: segmentCount }, (_, i) => ({
        x: pose.x + dx * i,
        y: pose.y + dy * i
    }));
}

/**
 * Smoothly pull each segment toward the one ahead of it (the classic follow).
 * Mutates `snake` in place. Extracted from the solo engine so multiplayer can
 * run it per-snake.
 * @param {Array<{x:number,y:number}>} snake
 * @param {{x:number,y:number}} prevHeadPos - the head's position BEFORE this tick's move.
 * @param {object} config - gameConfig (uses segmentSpacing).
 */
function followSegments(snake, prevHeadPos, config) {
    for (let i = 1; i < snake.length; i++) {
        const currentSegment = snake[i];
        const targetSegment = i === 1 ? prevHeadPos : snake[i - 1];

        const dx = targetSegment.x - currentSegment.x;
        const dy = targetSegment.y - currentSegment.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > config.segmentSpacing) {
            const ratio = (distance - config.segmentSpacing) / distance;
            currentSegment.x += dx * ratio * 0.8; // Smooth following
            currentSegment.y += dy * ratio * 0.8;
        }
    }
}

/**
 * Append a new tail segment one spacing behind the current tail, along the tail
 * direction. Mutates `snake` in place. Extracted from the solo engine so
 * multiplayer can grow any player's snake.
 * @param {Array<{x:number,y:number}>} snake
 * @param {object} config - gameConfig (uses segmentSpacing).
 */
function growTail(snake, config) {
    if (snake.length === 0) return;
    const tail = snake[snake.length - 1];
    let newSegment;

    if (snake.length > 1) {
        const secondToLast = snake[snake.length - 2];
        const dx = tail.x - secondToLast.x;
        const dy = tail.y - secondToLast.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > 0) {
            const ratio = config.segmentSpacing / distance;
            newSegment = { x: tail.x + dx * ratio, y: tail.y + dy * ratio };
        } else {
            newSegment = { x: tail.x - config.segmentSpacing, y: tail.y };
        }
    } else {
        newSegment = { x: tail.x - config.segmentSpacing, y: tail.y };
    }

    snake.push(newSegment);
}

/**
 * Last-snake-standing verdict after a tick's deaths have been applied.
 * - More than one player alive → the round continues.
 * - Exactly one alive → that slot wins.
 * - Zero alive (simultaneous final deaths, e.g. a head-on) → the best score
 *   among the players who died THIS tick wins; an exact tie is a draw
 *   (winnerSlot null). Players who died on earlier ticks never win.
 * @param {Array<{slot:string, alive:boolean, score:number}>} players
 * @param {Array<string>} justDiedSlots - slots eliminated this tick.
 * @returns {{over:boolean, winnerSlot:(string|null)}}
 */
function resolveWinner(players, justDiedSlots) {
    const alive = players.filter((p) => p.alive);
    if (alive.length > 1) return { over: false, winnerSlot: null };
    if (alive.length === 1) return { over: true, winnerSlot: alive[0].slot };
    const justDied = players.filter((p) => justDiedSlots.includes(p.slot));
    if (justDied.length === 0) return { over: true, winnerSlot: null };
    const top = Math.max(...justDied.map((p) => p.score));
    const winners = justDied.filter((p) => p.score === top);
    return { over: true, winnerSlot: winners.length === 1 ? winners[0].slot : null };
}

// Expose for Node/Vitest only (no-op in the browser).
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        normalizeAngle,
        shortestAngleDelta,
        stepDirection,
        speedToTurnStep,
        hitsWall,
        hitsSnake,
        hitsSelf,
        eatsFood,
        joystickToControl,
        spawnPose,
        snakeFromPose,
        followSegments,
        growTail,
        resolveWinner
    };
}
