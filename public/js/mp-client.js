// ==========================================
// MULTIPLAYER SYNC — phone controller side
// ==========================================
// Joining (race-safe slot claim with a rejoin token), the single doc listener
// driving the phone's whole multiplayer journey (lobby → playing → eliminated →
// results), own-slot haptic filtering, and disconnect hygiene. controller.js
// branches here when the session doc carries mode:'multi'; the legacy path
// stays untouched for old cached desktops. Loaded after controller.js.

/** Per-session localStorage key for the rejoin token. */
function mpTokenKey(code) {
    return 'snake_mp_' + code;
}

/**
 * Claim the lowest free slot — or re-claim our previous slot via the stored
 * token (a phone refresh rejoins the SAME snake, even mid-round). Runs inside a
 * Firestore transaction so two phones claiming at once serialize cleanly.
 * Throws tagged errors: .gameFull, .midGame, .notFound.
 * @returns {Promise<string>} the claimed slot id.
 */
async function claimSlot(sessionCode) {
    const docRef = firestore.collection('sessions').doc(sessionCode);
    const saved = safeParse(localStorage.getItem(mpTokenKey(sessionCode)), null);
    const token = (saved && saved.token) ||
        ('t-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
    const name = sanitizeName(getPlayerName() || '') || '';

    const slot = await firestore.runTransaction(async (tx) => {
        const snap = await tx.get(docRef);
        if (!snap.exists) {
            throw Object.assign(new Error('session gone'), { notFound: true });
        }
        const d = snap.data();
        const players = d.players || {};

        // Rejoin: the same token always recovers its old slot — even mid-round
        // (that's a reconnect, not a new join, so the lobby-only rule is bypassed).
        let mySlot = (saved && players[saved.slot] && players[saved.slot].token === token)
            ? saved.slot : null;

        if (!mySlot) {
            if (d.gameState && d.gameState.state === GameState.PLAYING) {
                throw Object.assign(new Error('round in progress'), { midGame: true });
            }
            mySlot = PLAYER_SLOTS.find((s) => !players[s]) || null;
            if (!mySlot) throw Object.assign(new Error('full'), { gameFull: true });
        }

        tx.update(docRef, {
            ['players.' + mySlot]: {
                name: name || 'Player ' + mySlot.slice(1),
                token: token,
                score: 0,
                alive: false,
                connected: true,
                joinedAt: firebase.firestore.FieldValue.serverTimestamp()
            },
            lastActivity: firebase.firestore.FieldValue.serverTimestamp()
        });
        return mySlot;
    });

    try { localStorage.setItem(mpTokenKey(sessionCode), JSON.stringify({ slot, token })); } catch (e) { /* private mode */ }
    mpClient.token = token;
    return slot;
}

/**
 * Entry point from controller.js when the session doc is multiplayer-capable.
 * Sets up the single doc listener; joining happens from inside the snapshot
 * handler so the lobby-only rule and auto-join-next-round share one code path.
 */
async function connectMultiplayer(sessionCode, sessionDoc, sessionData) {
    sessionManager.connectedSession = sessionCode;
    sessionManager.connectionType = 'hybrid';
    mpClient.sessionDocRef = sessionDoc;
    showControllerInterface();
    trackEvent('controller_connected', { side: 'phone' });

    sessionManager.firestoreUnsubscribe = sessionDoc.onSnapshot(mpPhoneSnapshot, (error) => {
        console.error('❌ MP Firestore listener error:', error);
        showConnectionError('Connection lost. Please refresh and try again.');
    });
    mpPhoneSnapshot(await sessionDoc.get()); // immediate first paint + join attempt
}

/**
 * The one phone-side listener: phase routing, lobby UI, own-slot haptics, and
 * the results cards. Also the auto-join mechanism: an unjoined phone that sees
 * the round end simply joins on that same snapshot.
 */
function mpPhoneSnapshot(doc) {
    if (!doc.exists) {
        showConnectionError('Session ended — the host closed the game.');
        return;
    }
    const d = doc.data();
    const st = d.gameState && d.gameState.state;

    if (mpClient.slot === null) {
        if (st === GameState.PLAYING) {
            mpClient.waiting = true;
            if (typeof mpUiPhoneQueued === 'function') mpUiPhoneQueued();
        } else {
            mpClient.waiting = false;
            mpTryJoin(doc.ref.id);
        }
        return;
    }

    const me = d.players && d.players[mpClient.slot];
    if (!me || me.token !== mpClient.token) {
        mpHandleKicked();
        return;
    }

    if (typeof mpUiPhoneUpdate === 'function') mpUiPhoneUpdate(d, mpClient.slot);
    updateCenterButtonIcon(st);
    syncedGameState = st;

    if (d.feedback && d.feedback[mpClient.slot]) mpHandleFeedback(d.feedback[mpClient.slot]);

    if (typeof updateMobileGameOverMp === 'function') updateMobileGameOverMp(d, mpClient.slot);
}

/** Claim a slot (re-entrancy-guarded) and bring the RTDB channel up. */
async function mpTryJoin(code) {
    if (mpClient.joining) return;
    mpClient.joining = true;
    try {
        const slot = await claimSlot(code);
        mpClient.slot = slot;

        sessionManager.realtimeRef = database.ref('controllers/' + code + '/' + slot);
        await sessionManager.realtimeRef.set({
            connected: true,
            joystick: { x: 0, y: 0 },
            timestamp: firebase.database.ServerValue.TIMESTAMP
        });
        sessionManager.realtimeRef.onDisconnect().remove();

        showConnectionSuccess('Joined as Player ' + slot.slice(1) + '!');
        if (typeof mpUiPhoneJoined === 'function') mpUiPhoneJoined(slot);
        debugLog('✅ MP joined as', slot);
    } catch (e) {
        if (e.gameFull) {
            showConnectionError('Game full — ' + gameConfig.maxPlayers + ' players already joined.');
        } else if (e.midGame) {
            mpClient.waiting = true;
            if (typeof mpUiPhoneQueued === 'function') mpUiPhoneQueued();
        } else if (e.notFound) {
            showConnectionError('Session ended — the host closed the game.');
        } else {
            console.error('❌ MP join failed:', e);
            showConnectionError('Could not join — try again.');
        }
    } finally {
        mpClient.joining = false;
    }
}

/** Our roster entry vanished or was overwritten: reset and fall back into the join loop. */
function mpHandleKicked() {
    debugLog('⚠️ MP slot lost — rejoining');
    mpClient.slot = null;
    showConnectionStatus('Reconnecting…');
    // The next snapshot drives mpTryJoin again (or queues us behind a live round).
}

/**
 * Own-slot haptic cues. food = the classic short buzz; eliminated = the loss
 * buzz + the red shake on the game-over card (fires at the moment of DEATH,
 * not at round end — the defeated player feels it immediately).
 */
function mpHandleFeedback(feedback) {
    if (!feedback || typeof feedback.at !== 'number' || feedback.at === lastFeedbackAt) return;
    lastFeedbackAt = feedback.at;
    if (feedback.type === 'food') {
        triggerHaptic(40);
    } else if (feedback.type === 'eliminated') {
        triggerHaptic([120, 60, 120, 60, 240]);
        const card = document.getElementById('mobile-game-over');
        if (card) playLossFlash(card);
        trackEvent('mp_round_result', { outcome: 'loss' });
    }
}

// Free our RTDB slot eagerly when the page is hidden/closed (pagehide fires
// reliably on mobile where beforeunload often doesn't); onDisconnect is the
// server-side backstop either way.
window.addEventListener('pagehide', () => {
    if (mpClient.slot && sessionManager.realtimeRef) {
        sessionManager.realtimeRef.remove().catch(() => {});
    }
});
