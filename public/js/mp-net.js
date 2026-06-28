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

/**
 * Handle a per-slot action written by a phone. Idempotent: first start wins.
 * Returns true if this action was CONSUMED this snapshot (so the caller should clear it),
 * false if it was dropped inside the per-slot ignore-window — in which case the caller must
 * NOT re-enter the clearing-write branch, so a faster-than-clear re-write can't make the host
 * pay a per-snapshot clear-write loop. Keyed per slot so p1 never suppresses p2.
 */
function mpHandleAction(slot, action) {
    if (!mpSession.roster[slot]) return false; // ghost writer — ignore (nothing to clear)

    const prev = mpSession.lastAction[slot];
    const now = Date.now();
    if (prev && prev.action === action && now - prev.at < gameConfig.actionIgnoreMs) {
        if (!prev.fired && typeof trackEvent === 'function') {
            trackEvent('action_throttled', { side: 'host', kind: 'mp' });
            prev.fired = true; // one analytics event per burst, not per dropped write
        }
        return false; // repeated within window — drop, and do NOT issue a clearing write
    }
    mpSession.lastAction[slot] = { action, at: now, fired: false };

    if (action === 'start' && gameState.currentState === GameState.WAITING_FOR_START) {
        mpStartRound();
    } else if (action === 'restart' && gameState.currentState === GameState.GAME_OVER) {
        mpStartRound();
    }
    return true;
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
    mpSession.stamps = {}; // fresh per-round ordering baseline; first input of the round always applies
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
    // Seed the reap clock for any roster slot we have NOT yet seen live, so a slot that
    // committed its Firestore entry but never brought up an RTDB child (the claim→live drop,
    // M12 defect (a)) starts aging toward reconciliation from when we first observed it —
    // not from 0 (which would reap instantly) and not never (the ghost-forever bug).
    for (const slot of PLAYER_SLOTS) {
        if (mpSession.roster[slot] && !mpSession.live.has(slot) && mpSession.seenAt[slot] == null) {
            mpSession.seenAt[slot] = Date.now();
        }
    }
    mpStartRosterReconcile(); // idempotent; arms the ghost-roster sweep once the session is live
    mpUiHook('renderMpLobby');

    const actions = d.gameActions || {};
    const clear = {};
    for (const slot of PLAYER_SLOTS) {
        // Only clear a slot's action if mpHandleAction actually CONSUMED it. A repeat that
        // lands inside the ignore-window returns false, so we skip the clear and avoid the
        // per-snapshot clearing-write loop a flood would otherwise force on the host.
        if (actions[slot] && mpHandleAction(slot, actions[slot])) {
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
 *
 * Retained as a thin wrapper over the per-slot entry point so the localStorage /
 * legacy callers and any test referencing it keep working. The hybrid Firebase
 * host now drives per-child listeners and calls mpHandleControllerChild directly
 * (network.js), so this whole-node fan-out only runs on non-per-child callers.
 * @param {object} node - the whole controllers/{code} value.
 */
function mpHandleControllerNode(node) {
    for (const slot of PLAYER_SLOTS) {
        mpHandleControllerChild(slot, node ? node[slot] : null);
    }
}

/**
 * Per-slot RTDB child handler — the O(1)-per-write entry point. Applies one
 * slot's joystick to its arena player (multi) or to the classic solo snake
 * (1-player round), and reconciles that slot's liveness. Called once per child
 * event from the host's per-child listeners (child_added/changed/removed) so a
 * single phone's write wakes only its own slot. A removed/absent child
 * (childData == null/undefined, or connected falsy) runs the "slot gone" branch.
 * @param {string} slot - the slot id (p1..p6); callers must pre-filter to ^p[1-6]$.
 * @param {object|null} c - that slot's child value ({connected,joystick,timestamp}).
 */
function mpHandleControllerChild(slot, c) {
    const wasLive = mpSession.live.has(slot);
    if (c && c.connected) {
        // Liveness clock for the reconciliation sweep: a live child is "seen now", so its
        // roster entry is never a ghost (M12 defect (a) backstop).
        mpSession.seenAt[slot] = Date.now();
        // Out-of-order drop: only apply this slot's input when its client stamp is
        // strictly newer than the last we applied for THIS slot (per-source compare).
        // A missing/legacy stamp is treated as "always newer" so old phones still work.
        const fresh = isNewerStamp(c.timestamp, mpSession.stamps[slot]);
        if (fresh) {
            if (typeof c.timestamp === 'number' && isFinite(c.timestamp)) {
                mpSession.stamps[slot] = c.timestamp;
            }
            mpSession.inputs[slot] = c.joystick || { x: 0, y: 0 };
            if (gameState.mode === 'multi') {
                applyPlayerJoystick(slot, mpSession.inputs[slot]);
            } else if (gameState.currentState === GameState.PLAYING) {
                // 1-player round: the lone phone drives the classic solo snake.
                // Pass the stamp so the solo monotonic guard + coast see fresh input.
                handleJoystickInputFromMobile(mpSession.inputs[slot], c.timestamp);
            }
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
    mpSession.seenAt[slot] = Date.now();
    const entry = mpSession.roster[slot];
    if (entry && entry.connected === false) {
        // Alive-aware reconnect (M12 defect (b)): mid-round, an ALREADY-ELIMINATED player's
        // child reappearing must NOT resurrect them as connected/active. The snake already
        // coasted and died (mpOnControllerGone), so we leave connected:false — the phone falls
        // into the queued/spectator path on its next snapshot. The gate is ARENA-ONLY
        // (gameState.mode === 'multi'): a 1-player solo round never runs the elimination roster
        // (its p1.alive stays false because mpWriteRoundStart is skipped), so gating on mode keeps
        // the lone solo phone's reconnect restoring connected exactly as before (no solo regression).
        // Outside PLAYING (lobby / between rounds) there is no live snake to protect either.
        const blockReconnect = gameState.mode === 'multi' &&
            gameState.currentState === GameState.PLAYING &&
            entry.alive === false;
        if (blockReconnect) {
            debugLog('🚫 reconnect blocked for eliminated slot:', slot);
            trackEvent('mp_reconnect_blocked', { slot: parseInt(slot.slice(1), 10) });
        } else {
            mpDocRef().update({ ['players.' + slot + '.connected']: true }).catch(() => {});
        }
    }
    trackEvent('mp_lobby_join', { slot: parseInt(slot.slice(1), 10), players: mpRosterSlots().length });
}

/**
 * Host roster reconciliation (M12 defect (a) backstop). Reaps a Firestore roster entry that
 * has NO live RTDB child for gameConfig.rosterReapMs — the ghost left by a phone that committed
 * its roster write but dropped before (or without) its slot child ever going live, so no
 * onDisconnect and no child_removed will ever reap it. M4's per-child liveness (mpSession.live)
 * is the truth source: a slot that IS live is never reaped, and a slot's seenAt is refreshed
 * whenever its child is live (mpHandleControllerChild / mpOnControllerLive).
 *
 * Mirrors the existing lobby-only reap (mpOnControllerGone): only runs OUTSIDE PLAYING, so an
 * in-round disconnect still coasts-and-dies naturally rather than being reaped mid-game.
 */
function mpReconcileRoster() {
    if (!mpSession.enabled) return;
    if (gameState.currentState === GameState.PLAYING) return; // never reap mid-round
    const now = Date.now();
    let reaped = 0;
    for (const slot of PLAYER_SLOTS) {
        if (!mpSession.roster[slot]) continue;      // no roster entry — nothing to reap
        if (mpSession.live.has(slot)) continue;     // live child present — NEVER reap a healthy phone
        const seen = mpSession.seenAt[slot];
        if (seen == null) { mpSession.seenAt[slot] = now; continue; } // just observed — start its clock
        if (now - seen <= gameConfig.rosterReapMs) continue;          // still inside grace

        // Ghost: roster entry with no live child past the grace window. Reap it (same write the
        // lobby-gone path uses) and forget its clock so a future rejoin starts fresh.
        delete mpSession.seenAt[slot];
        mpDocRef().update({
            ['players.' + slot]: firebase.firestore.FieldValue.delete(),
            lastActivity: firebase.firestore.FieldValue.serverTimestamp()
        }).catch(() => {});
        delete mpSession.roster[slot]; // optimistic local prune so the count is right immediately
        reaped++;
        debugLog('🧹 reaped ghost roster slot:', slot);
    }
    if (reaped) {
        mpUiHook('renderMpLobby');
        // Distinguish ghost reaps from genuine leaves (mp_lobby_leave) for the funnel.
        trackEvent('mp_ghost_reaped', { players: mpRosterSlots().length });
    }
}

/**
 * Arm the roster reconciliation sweep exactly once per host session. Guarded against
 * double-start (mirrors desktopStorageListenerAttached). The handle lives on mpSession so
 * beforeunload (network.js) can tear it down — no interval leak.
 */
function mpStartRosterReconcile() {
    if (mpSession.reconcileTimer) return; // single sweep per session
    mpSession.reconcileTimer = setInterval(mpReconcileRoster, gameConfig.rosterReapSweepMs);
}

/** @returns the live session doc ref. */
function mpDocRef() {
    return firestore.collection('sessions').doc(sessionManager.currentSession);
}
