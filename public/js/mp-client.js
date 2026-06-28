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

    // Host-staleness watchdog (M12 defect (c)): record the freshest host write time and run
    // the watchdog only while PLAYING. A fresh snapshot here also clears any stale flag.
    mpClient.lastHostActivityAt = Date.now();
    mpClientClearHostStale();
    if (st === GameState.PLAYING) mpClientStartHostWatch();
    else mpClientStopHostWatch();

    // Alive-aware reconnect (M12 defect (b)): an eliminated player who reconnects mid-round
    // must NOT be presented as an active participant. The host already keeps connected:false
    // for a dead snake; here the phone shows the queued/spectator UI rather than a live
    // joystick. waiting drives the same path as queueing behind a round.
    //
    // ARENA-ONLY: a 1-player solo round never flips its roster `alive` to true (mpWriteRoundStart
    // is host-side skipped for 1 player), so me.alive stays false for the WHOLE solo round. Gating
    // on joinedCount >= 2 means the lone solo phone is never mis-shown as a spectator during its
    // own live round — only a genuinely-eliminated arena player is queued.
    const joinedCount = d.players ? PLAYER_SLOTS.filter((s) => d.players[s]).length : 0;
    const isArenaRound = joinedCount >= 2;
    if (st === GameState.PLAYING && isArenaRound && me.alive === false) {
        if (!mpClient.waiting) {
            mpClient.waiting = true;
            if (typeof mpUiPhoneQueued === 'function') mpUiPhoneQueued();
        }
    } else if (st !== GameState.PLAYING) {
        // Lobby / game-over: a queued spectator is released for the next round.
        mpClient.waiting = false;
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
        // Arm the server-side reaper FIRST (atomic-ish join). onDisconnect() registers the
        // remove independently of — and BEFORE — the data write, so a drop in the
        // claim→live window (set() not yet reached/resolved) is still reaped server-side and
        // never strands a Firestore roster entry the host can't see go away (M12 defect (a)).
        sessionManager.realtimeRef.onDisconnect().remove();
        await sessionManager.realtimeRef.set({
            connected: true,
            joystick: { x: 0, y: 0 },
            timestamp: Date.now()
        });

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
    mpClientStopHostWatch(); // never leave the watchdog running once we've lost the slot
    showConnectionStatus('Reconnecting…');
    // The next snapshot drives mpTryJoin again (or queues us behind a live round).
}

/**
 * Host-staleness watchdog (M12 defect (c)). During PLAYING the host stamps `lastActivity`
 * on every state write (mp-net.js), so a healthy round produces frequent snapshots and
 * mpClient.lastHostActivityAt keeps moving. A host that silently goes (laptop sleep, wifi
 * loss without beforeunload) stops writing, so no snapshot arrives, lastHostActivityAt
 * freezes, and after gameConfig.hostStaleMs this surfaces a bounded, advisory
 * "Host disconnected" state. Single guarded interval (no double-start); self-heals on the
 * next fresh snapshot via mpClientClearHostStale().
 */
function mpClientStartHostWatch() {
    if (mpClient.hostWatchTimer) return; // single watchdog
    mpClient.hostWatchTimer = setInterval(() => {
        if (syncedGameState !== GameState.PLAYING) { mpClientStopHostWatch(); return; }
        const since = Date.now() - (mpClient.lastHostActivityAt || 0);
        if (since > gameConfig.hostStaleMs && !mpClient.hostStale) {
            mpClient.hostStale = true;
            showConnectionStatus('Host disconnected — waiting to reconnect…');
            const iface = document.getElementById('controller-interface');
            if (iface) iface.classList.add('mp-queued'); // dim the joystick (reuse the queued style)
            // since_ms bucketed to the nearest threshold multiple — counts only, no code/PII.
            trackEvent('mp_host_stale', { since_ms: Math.round(since / 1000) * 1000 });
        }
    }, gameConfig.hostStaleCheckMs);
}

/** Stop the host-staleness watchdog and clear any advisory state. */
function mpClientStopHostWatch() {
    if (mpClient.hostWatchTimer) {
        clearInterval(mpClient.hostWatchTimer);
        mpClient.hostWatchTimer = null;
    }
    mpClientClearHostStale();
}

/** A fresh host snapshot arrived: clear the stale advisory + restore the joystick. */
function mpClientClearHostStale() {
    if (!mpClient.hostStale) return;
    mpClient.hostStale = false;
    // Only un-dim if we're not legitimately queued behind a round we can't play.
    if (!mpClient.waiting) {
        const iface = document.getElementById('controller-interface');
        if (iface) iface.classList.remove('mp-queued');
    }
    showConnectionStatus('Reconnected ✓');
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
    mpClientStopHostWatch(); // never leak the watchdog interval across a hide/close
    if (mpClient.slot && sessionManager.realtimeRef) {
        sessionManager.realtimeRef.remove().catch(() => {});
    }
});
