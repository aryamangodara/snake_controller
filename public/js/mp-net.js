// ==========================================
// MULTIPLAYER SYNC — desktop host side
// ==========================================
// Owns every multiplayer Firestore/RTDB exchange on the host: the lobby roster,
// per-slot joystick routing, per-slot start/restart actions, score/elimination
// sync, per-player haptic feedback, and the end-of-round results write. All
// writes are event-driven (eat / elimination / state edges) — never per-frame.
// Loaded after network.js; the engine reaches it through typeof-guarded hooks.

/**
 * Round lifecycle policy: ANY joined player (or the desktop keyboard) can start
 * or restart. With 1 player in the roster the CLASSIC solo engine runs (incl.
 * the leaderboard flow); with 2+ the arena engine takes over. Zero toggles.
 */
function mpRosterSlots() {
    return PLAYER_SLOTS.filter((s) => mpSession.roster[s]);
}

/** True when a lobby with 2+ players should own the desktop Space/Enter key. */
function mpDesktopWantsRound() {
    return mpSession.enabled && mpRosterSlots().length >= 2;
}

/** Desktop Space/Enter in a multiplayer context: start or restart the round. */
function mpHandleDesktopStartKey() {
    if (gameState.currentState === GameState.PLAYING) return;
    mpStartRound();
}

/** Handle a per-slot action written by a phone. Idempotent: first start wins. */
function mpHandleAction(slot, action) {
    if (!mpSession.roster[slot]) return; // ghost writer — ignore
    if (action === 'start' && gameState.currentState === GameState.WAITING_FOR_START) {
        mpStartRound();
    } else if (action === 'restart' && gameState.currentState === GameState.GAME_OVER) {
        mpStartRound();
    }
}

/** Start a round for everyone currently in the roster (1 player = classic solo). */
function mpStartRound() {
    const slots = mpRosterSlots();
    if (slots.length === 0) return;

    if (slots.length === 1) {
        // Solo round through the untouched classic engine (leaderboard intact).
        if (gameState.currentState === GameState.GAME_OVER) restartGame();
        else startGame();
        return;
    }

    const roster = slots.map((s) => ({ slot: s, name: mpSession.roster[s].name || 'Player ' + s.slice(1) }));
    mpSession.defeated = [];
    startMultiplayerGame(roster);
    mpWriteRoundStart(slots);
}

/** Round-start sync: state edge + per-slot alive/score reset in ONE write. */
function mpWriteRoundStart(slots) {
    const u = {
        'gameState.state': GameState.PLAYING,
        results: null,
        lastActivity: firebase.firestore.FieldValue.serverTimestamp()
    };
    for (const s of slots) {
        u['players.' + s + '.alive'] = true;
        u['players.' + s + '.score'] = 0;
    }
    mpDocRef().update(u).catch(() => {});
}

/** Engine hook: a player ate — sync their score + a food buzz to THEIR phone only. */
function mpSyncScoreOnEat(slot, score) {
    if (!mpSession.enabled) return;
    mpDocRef().update({
        ['players.' + slot + '.score']: score,
        ['feedback.' + slot]: { type: 'food', at: Date.now() },
        lastActivity: firebase.firestore.FieldValue.serverTimestamp()
    }).catch(() => {});
}

/** Engine hook: a player died — one combined write; only their phone gets the buzz. */
function mpSyncElimination(slot, score, death) {
    if (!mpSession.enabled) return;
    mpSession.defeated.push({
        slot: slot,
        name: (mpSession.roster[slot] || {}).name || slot,
        score: score,
        death: death
    });
    mpDocRef().update({
        ['players.' + slot + '.alive']: false,
        ['players.' + slot + '.death']: death,
        ['players.' + slot + '.score']: score,
        ['feedback.' + slot]: { type: 'eliminated', at: Date.now() },
        lastActivity: firebase.firestore.FieldValue.serverTimestamp()
    }).catch(() => {});
}

/** Engine hook: the round ended — state edge + results in ONE write. */
function publishMpResults(results) {
    if (!mpSession.enabled) return;
    const u = {
        'gameState.state': GameState.GAME_OVER,
        results: {
            winnerSlot: results.winnerSlot,
            endedAt: Date.now(),
            players: results.players,
            defeated: results.defeated
        },
        lastActivity: firebase.firestore.FieldValue.serverTimestamp()
    };
    for (const p of results.players) u['players.' + p.slot + '.score'] = p.score;
    mpDocRef().update(u).catch(() => {});
}

/** Generic per-slot haptic cue (engine's mpNetHook target for future cues). */
function sendHapticFeedbackTo(slot, type) {
    if (!mpSession.enabled) return;
    // food + eliminated are bundled into the score/elimination writes above to
    // halve the write count; anything else goes out standalone here.
    if (type === 'food' || type === 'eliminated') return;
    mpDocRef().update({
        ['feedback.' + slot]: { type: type, at: Date.now() },
        lastActivity: firebase.firestore.FieldValue.serverTimestamp()
    }).catch(() => {});
}

/**
 * Firestore doc listener body: roster → lobby UI, per-slot actions → handle +
 * clear. Shares the legacy listener's doc (network.js calls this from its
 * onSnapshot so there is exactly ONE listener).
 */
function mpHandleDocSnapshot(doc) {
    if (!doc.exists) return;
    const d = doc.data();
    if (d.mode !== 'multi') return;
    mpSession.enabled = true;
    mpSession.roster = d.players || {};
    mpUiHook('renderMpLobby');

    const actions = d.gameActions || {};
    const clear = {};
    for (const slot of PLAYER_SLOTS) {
        if (actions[slot]) {
            mpHandleAction(slot, actions[slot]);
            clear['gameActions.' + slot] = null;
        }
    }
    if (Object.keys(clear).length) {
        clear.lastActivity = firebase.firestore.FieldValue.serverTimestamp();
        doc.ref.update(clear).catch((e) => console.error('mp action clear failed', e));
    }
}

/**
 * RTDB parent-node listener body: route each live slot's joystick to its player
 * (arena rounds) or to the classic solo handler (1-player rounds), and reconcile
 * roster liveness. Legacy flat-shape nodes (old cached phones) are handled by
 * the caller's existing path.
 * @param {object} node - the whole controllers/{code} value.
 */
function mpHandleControllerNode(node) {
    for (const slot of PLAYER_SLOTS) {
        const c = node ? node[slot] : null;
        const wasLive = mpSession.live.has(slot);
        if (c && c.connected) {
            mpSession.inputs[slot] = c.joystick || { x: 0, y: 0 };
            if (gameState.mode === 'multi') {
                applyPlayerJoystick(slot, mpSession.inputs[slot]);
            } else if (gameState.currentState === GameState.PLAYING) {
                // 1-player round: the lone phone drives the classic solo snake.
                handleJoystickInputFromMobile(mpSession.inputs[slot]);
            }
            if (!wasLive) {
                mpSession.live.add(slot);
                mpOnControllerLive(slot);
            }
        } else if (wasLive) {
            mpSession.live.delete(slot);
            mpOnControllerGone(slot);
        }
    }
}

/** A slot's RTDB child vanished: reap in lobby; flag + coast mid-round. */
function mpOnControllerGone(slot) {
    debugLog('📵 controller gone:', slot);
    if (gameState.currentState === GameState.PLAYING) {
        // The snake coasts on its last heading and dies naturally — pausing a
        // last-snake-standing round for one flaky phone punishes the others.
        mpDocRef().update({ ['players.' + slot + '.connected']: false }).catch(() => {});
    } else {
        mpDocRef().update({
            ['players.' + slot]: firebase.firestore.FieldValue.delete(),
            lastActivity: firebase.firestore.FieldValue.serverTimestamp()
        }).catch(() => {});
    }
    mpUiHook('renderMpLobby');
    trackEvent('mp_lobby_leave', { players: mpRosterSlots().length });
}

/** A slot's RTDB child (re)appeared. */
function mpOnControllerLive(slot) {
    debugLog('📶 controller live:', slot);
    const entry = mpSession.roster[slot];
    if (entry && entry.connected === false) {
        mpDocRef().update({ ['players.' + slot + '.connected']: true }).catch(() => {});
    }
    trackEvent('mp_lobby_join', { slot: parseInt(slot.slice(1), 10), players: mpRosterSlots().length });
}

/** @returns the live session doc ref. */
function mpDocRef() {
    return firestore.collection('sessions').doc(sessionManager.currentSession);
}
