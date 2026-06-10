// ==========================================
// MULTIPLAYER ENGINE — N-snake simulation (desktop host)
// ==========================================
// The entire "last snake standing" simulation: per-player movement, the shared
// fruit, cross-snake collisions, eliminations, and the end-of-round verdict.
// Runs only when gameState.mode === 'multi' (game.js updateGame branches here);
// the solo engine in game.js is untouched. Pure math lives in logic.js; player
// identity/factories in players.js. Sync/UI integrations are typeof-guarded
// hooks (mp-net.js / mp-ui.js), so this file stands alone.

/**
 * Begin a multiplayer round with the given roster (called by the sync layer or
 * the desktop keyboard once ≥2 players are in the lobby).
 * @param {Array<{slot:string, name:string}>} roster - slot order, length 1..maxPlayers.
 */
function startMultiplayerGame(roster) {
    debugLog('⚔️ Starting multiplayer round:', roster.map((r) => r.slot).join(', '));
    gameState = createMultiplayerState(roster);
    gameState.gameRunning = true; // the boot-time rAF loop keeps running, like restartGame()
    gameState.currentState = GameState.PLAYING;
    gameState.lastUpdateTime = performance.now();
    gameState.lastMoveTime = performance.now();
    resetEffects();
    hideSoloHud();
    playStartSound();
    generateFood(aliveSnakes());
    mpUiHook('renderMpRoundStart');
    trackEvent('mp_game_start', { players: roster.length });
}

/**
 * One rAF frame of multiplayer: smooth turning every frame, movement + collision
 * on the movementUpdateMs pulse, per-player combo expiry. Mirrors the solo frame
 * in game.js updateGame.
 */
function updateMultiplayerFrame(currentTime, deltaTime, moveDeltaTime) {
    const frameFactor = Math.min(deltaTime / TARGET_FRAME_MS, MAX_FRAME_STEP);
    for (const p of gameState.players) {
        if (p.alive) updatePlayerDirection(p, frameFactor);
    }

    if (moveDeltaTime >= gameConfig.movementUpdateMs) {
        stepMultiplayerTick();
        gameState.lastMoveTime = currentTime;
    }
    gameState.frameCount++;

    const now = Date.now();
    for (const p of gameState.players) {
        if (p.combo > 0 && now - p.lastFoodTime > gameConfig.comboWindowMs) {
            p.combo = 0;
            mpUiHook('updateMpScoreboard');
        }
    }
}

/**
 * Per-player twin of the solo updateSnakeDirection — same math, player fields.
 * (Solo passes the constant gameConfig.baseSpeed as the reference speed; so do we.)
 */
function updatePlayerDirection(player, frameFactor) {
    const turnStep = speedToTurnStep(
        gameConfig.turnSpeed, player.currentSpeed, gameConfig.baseSpeed,
        frameFactor, gameConfig.maxTurnSpeedFactor);
    player.direction = stepDirection(player.direction, player.targetDirection, turnStep);
}

/**
 * One movement pulse for all alive players, in slot order. Deaths are COLLECTED
 * during the loop and resolved after every player has moved, so simultaneous
 * deaths (incl. head-on head-vs-head) are honest: a dying snake still blocks
 * everyone else this tick.
 */
function stepMultiplayerTick() {
    const deaths = []; // [{ player, cause, by }]

    for (const player of gameState.players) {
        if (!player.alive) continue;
        const outcome = movePlayer(player);
        if (outcome.died) {
            deaths.push({ player, cause: outcome.cause, by: outcome.by });
        } else if (outcome.ate) {
            applyFoodEaten(player); // respawns the fruit; later movers see the NEW fruit
        }
    }

    for (const d of deaths) eliminatePlayer(d.player, d.cause, d.by);
    if (deaths.length > 0) checkEndCondition(deaths);
}

/**
 * Advance one player one tick. Mirrors solo moveSnake() but RETURNS the outcome
 * instead of mutating global game-over state. Collision order: wall → self →
 * other snakes (full body incl. head, skip 0 — the biter dies) → food.
 * @returns {{died:true, cause:('wall'|'self'|'bite'), by:(string|null)}
 *          |{died:false, ate:boolean}}
 */
function movePlayer(player) {
    const prevHead = { ...player.snake[0] };
    const head = { ...player.snake[0] };
    head.x += Math.cos(player.direction) * player.currentSpeed;
    head.y += Math.sin(player.direction) * player.currentSpeed;

    if (hitsWall(head, gameConfig)) return { died: true, cause: 'wall', by: null };
    if (hitsSnake(head, player.snake, gameConfig.minSelfCollisionSegments, gameConfig)) {
        return { died: true, cause: 'self', by: null };
    }
    for (const other of gameState.players) {
        if (other === player || !other.alive) continue;
        if (hitsSnake(head, other.snake, 0, gameConfig)) {
            return { died: true, cause: 'bite', by: other.slot };
        }
    }

    player.snake[0] = head;
    followSegments(player.snake, prevHead, gameConfig);

    return { died: false, ate: eatsFood(head, gameState.food, gameConfig) };
}

/**
 * The multiplayer twin of the solo eat block: per-player combo/score/speed ramp,
 * shared juice + sound, fruit respawn clear of every alive snake.
 */
function applyFoodEaten(player) {
    const foodX = gameState.food.x;
    const foodY = gameState.food.y;
    const now = Date.now();
    player.combo = (now - player.lastFoodTime < gameConfig.comboWindowMs) ? player.combo + 1 : 1;
    player.lastFoodTime = now;
    const multiplier = Math.min(player.combo, gameConfig.maxCombo);
    const gained = 10 * multiplier;
    player.score += gained;

    spawnFoodBurst(foodX, foodY, colors.food);
    // The pop carries the player's head color so everyone can see WHO scored.
    spawnScorePop(foodX, foodY,
        multiplier > 1 ? `+${gained} x${multiplier}` : `+${gained}`,
        player.colors.head);
    playFoodSound(multiplier);

    generateFood(aliveSnakes());
    growTail(player.snake, gameConfig);

    if (player.baseSpeed < gameConfig.maxSpeed) {
        player.baseSpeed = Math.min(gameConfig.maxSpeed, player.baseSpeed + gameConfig.speedIncrease);
        player.currentSpeed = player.baseSpeed;
    }

    mpUiHook('updateMpScoreboard');
    mpNetHook('mpSyncScoreOnEat', player.slot, player.score);
}

/**
 * Resolve one death: juice in the player's own color, mark dead, remove the
 * snake from the board (and from all collision checks), notify sync/UI.
 * @param {('wall'|'self'|'bite')} cause
 * @param {(string|null)} bySlot - the snake that was bitten INTO (it gets the
 *   "defeated" credit on the winner card); null for wall/self deaths.
 */
function eliminatePlayer(player, cause, bySlot) {
    debugLog(`💀 ${player.slot} eliminated (${cause}${bySlot ? ' by ' + bySlot : ''})`);
    player.alive = false;
    player.death = { cause: cause, by: bySlot, at: Date.now() };
    player.combo = 0;

    playCrashSound();
    triggerShake(9, 340);
    const head = player.snake[0];
    if (head) spawnFoodBurst(head.x, head.y, player.colors.head);

    player.snake = []; // vanishes from the board and from every collision check

    mpUiHook('updateMpScoreboard');
    mpNetHook('mpSyncElimination', player.slot, player.score, player.death);
    trackEvent('mp_elimination', { cause: cause, players_alive: alivePlayers().length });
}

/**
 * After a tick's deaths: is the round over, and who won?
 * @param {Array<{player:object, cause:string, by:(string|null)}>} deathsThisTick
 */
function checkEndCondition(deathsThisTick) {
    const verdict = resolveWinner(gameState.players, deathsThisTick.map((d) => d.player.slot));
    if (verdict.over) endMultiplayerGame(verdict.winnerSlot);
}

/**
 * Multiplayer terminal path — fully replaces the solo gameOver(): NO local best,
 * NO global leaderboard, NO name entry. Builds the results object the defeat /
 * winner cards render from.
 * @param {(string|null)} winnerSlot - null = draw (or a 1-player round).
 */
function endMultiplayerGame(winnerSlot) {
    gameState.currentState = GameState.GAME_OVER;
    gameState.mpResults = {
        winnerSlot: winnerSlot,
        defeated: gameState.players
            .filter((p) => winnerSlot !== null && p.death && p.death.by === winnerSlot)
            .map((p) => p.name),
        players: gameState.players.map((p) => ({
            slot: p.slot, name: p.name, score: p.score, death: p.death // death null = survivor
        }))
    };

    const winner = winnerSlot ? getPlayerBySlot(winnerSlot) : null;
    debugLog('🏁 Multiplayer round over. Winner:', winnerSlot || 'draw');
    mpUiHook('renderMpEndScreen', gameState.mpResults);
    mpNetHook('publishMpResults', gameState.mpResults);
    trackEvent('mp_game_over', {
        players: gameState.players.length,
        winner_score: winner ? winner.score : 0 // no PII — names never leave the session
    });
}

/**
 * Route a phone's joystick onto its player. Per-player twin of the solo
 * handleJoystickInputFromMobile path (network.js).
 * @param {string} slot
 * @param {{x:number, y:number}} input
 */
function applyPlayerJoystick(slot, input) {
    if (gameState.mode !== 'multi' || gameState.currentState !== GameState.PLAYING) return;
    const p = getPlayerBySlot(slot);
    if (!p || !p.alive) return;
    p.joystickInput = input;
    const control = joystickToControl(input, p.baseSpeed, gameConfig);
    if (control.active) p.targetDirection = control.targetDirection;
    p.currentSpeed = control.speed;
}

/**
 * Hide the solo-only HUD when a multiplayer round starts (the MP scoreboard and
 * end screen are owned by mp-ui.js). The combo badge stays hidden in MP —
 * per-player combos surface through the colored score pops instead.
 */
function hideSoloHud() {
    const combo = document.getElementById('combo-display');
    if (combo) combo.classList.add('hidden');
    const gameOverScreen = document.getElementById('game-over');
    if (gameOverScreen) gameOverScreen.classList.add('hidden');
}

/** Call a UI-layer hook (mp-ui.js) if it has been loaded; harmless no-op otherwise. */
function mpUiHook(name, arg) {
    try {
        const fn = window[name];
        if (typeof fn === 'function') fn(arg);
    } catch (e) {
        console.warn('mp-ui hook failed:', name, e);
    }
}

/** Call a sync-layer hook (mp-net.js) if it has been loaded; harmless no-op otherwise. */
function mpNetHook(name, a, b, c) {
    try {
        const fn = window[name];
        if (typeof fn === 'function') fn(a, b, c);
    } catch (e) {
        console.warn('mp-net hook failed:', name, e);
    }
}
