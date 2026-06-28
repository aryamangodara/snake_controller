// ==========================================
// NETWORK & SESSION LOGIC
// ==========================================

/**
 * Generates a new session for the desktop app, creating a 6-digit code,
 * setting up the database listeners, and generating the QR code.
 */
async function generateNewSession() {
    const sessionCode = await generateUniqueSessionCode();
    sessionManager.currentSession = sessionCode;

    debugLog('🎮 Generated session code:', sessionCode);

    const sessionCodeElement = document.getElementById('session-code');
    if (sessionCodeElement) {
        sessionCodeElement.textContent = sessionCode;
    }

    generateQRCode(sessionCode);
    // Surface the same join URL as a copy-able link for can't-scan users.
    setupPairingCopyLink(sessionCode);

    if (firebaseReady) {
        setupRobustHybridSession(sessionCode);
    } else {
        setupLocalStorageSession(sessionCode);
    }

    trackEvent('session_created', { connection: firebaseReady ? 'hybrid' : 'localStorage' });
}

/**
 * Produces a random 6-digit code. When Firebase is available, verifies the code
 * is not already an active session before claiming it, so two desktops cannot
 * collide on the same code. Falls back to an unverified code if the lookups fail.
 * @param {number} [maxAttempts=5] - How many codes to try before giving up.
 * @returns {Promise<string>} A 6-digit session code.
 */
async function generateUniqueSessionCode(maxAttempts = 5) {
    const randomCode = () => Math.floor(100000 + Math.random() * 900000).toString();

    if (!firebaseReady || !firestore) {
        return randomCode();
    }

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const code = randomCode();
        try {
            const existing = await firestore.collection('sessions').doc(code).get();
            if (!existing.exists) return code;
            console.warn(`⚠️ Session code ${code} already in use, regenerating...`);
        } catch (error) {
            // If we can't verify (offline/permission), just use the candidate.
            console.warn('Could not verify session-code uniqueness, using candidate.', error);
            return code;
        }
    }

    console.warn('Could not find an unused session code; using a random one.');
    return randomCode();
}

/**
 * ROBUST HYBRID SESSION with better error handling.
 * Creates the session in Firestore and Database to listen for mobile connections.
 */
async function setupRobustHybridSession(sessionCode) {
    try {
        sessionManager.connectionType = 'hybrid';
        debugLog('🔥 Setting up robust hybrid session...');
        
        // Wait for Firestore to be ready
        await waitForFirebaseReady();
        
        // 1. Create session in Firestore with detailed logging
        const sessionDoc = firestore.collection('sessions').doc(sessionCode);
        
        debugLog('📝 Creating session document in Firestore...');
        // v2 doc: multiplayer-capable from birth (zero toggles). The legacy
        // gameState map stays — 1-player rounds run the classic solo engine
        // and write through the untouched updateGameStateInFirebase.
        await sessionDoc.set({
            created: firebase.firestore.FieldValue.serverTimestamp(),
            connected: false,
            mode: 'multi',
            players: {},
            gameActions: {},
            feedback: {},
            results: null,
            gameState: {
                active: true,
                score: 0,
                state: GameState.WAITING_FOR_START
            },
            lastActivity: firebase.firestore.FieldValue.serverTimestamp(),
            version: Date.now() // Add version for debugging
        });
        mpSession.enabled = true;
        
        debugLog('✅ Session document created successfully in Firestore');
        
        // 2. Verify session was created by reading it back
        const verification = await sessionDoc.get();
        if (!verification.exists) {
            throw new Error('Session verification failed - document not found after creation');
        }
        debugLog('✅ Session verified in Firestore:', verification.data());
        
        // 3. Set up Realtime Database path
        sessionManager.realtimeRef = database.ref(`controllers/${sessionCode}`);
        debugLog('📡 Setting up Realtime Database path...');
        
        // Initialize Realtime Database path
        await sessionManager.realtimeRef.set({
            connected: false,
            joystick: { x: 0, y: 0 },
            timestamp: Date.now(),
            initialized: true
        });
        debugLog('✅ Realtime Database path initialized');

        // Auto-remove this controller node if the host disconnects, so abandoned
        // sessions clean themselves up server-side (backstop for beforeunload).
        sessionManager.realtimeRef.onDisconnect().remove();
        
        // 4. Listen for Realtime Database changes. The node carries either the
        // legacy flat shape (an old cached phone) or per-slot children (new
        // multiplayer phones) — both are handled so version skew degrades softly.
        // Attached via a named helper so the error path can re-subscribe (bounded).
        attachRealtimeListener(sessionManager.realtimeRef);

        // 5. Listen to Firestore for game actions (legacy single field for old
        // phones) + the multiplayer roster/per-slot actions (mp-net.js). Cached on
        // sessionManager so resubscribeListeners() can re-attach the dropped listener.
        sessionManager.firestoreDocRef = sessionDoc;
        attachFirestoreListener(sessionDoc);

        sessionManager.firebaseConnected = true;
        sessionManager.sessionReady = true;
        debugLog('🚀 Hybrid session fully ready! Mobile can now connect.');
        updateConnectionStatus('Waiting for your phone…');
        // Arm the "still waiting?" nudge — fires only if no phone connects in time.
        startPairingNudge('hybrid');

    } catch (error) {
        console.error('❌ Hybrid session setup failed:', error);
        debugLog('🔄 Falling back to localStorage...');
        // Post-hoc degradation: Firebase was "ready" at session_created time but setup threw,
        // so this silent drop to localStorage is invisible to session_created. Record it
        // (no code, no PII) so both transports are observable; pairs with the phone's
        // offline_fallback{side:'phone'}.
        trackEvent('offline_fallback', { side: 'desktop' });
        setupLocalStorageSession(sessionCode);
    }
}

// Bounded re-subscribe budget per listener kind, so a permanent error (e.g.
// permission-denied) can't spin a tight re-attach loop. After the cap we stop and
// leave the user-facing "Reload" affordance (main.js) as the recovery path.
let rtdbListenerRetries = 0;
let firestoreListenerRetries = 0;
const MAX_LISTENER_RETRIES = 3;
const LISTENER_RETRY_BACKOFF_MS = 2000;

/**
 * Attach the RTDB joystick listener WITH an error callback. The success body is the
 * original inline handler (network.js); the second arg is the error callback `.on()`
 * accepts — on a drop (permission/network) it reports a bounded `rtdb_listener` js_error
 * and attempts a bounded re-subscribe rather than failing silently.
 * @param {object} ref - the RTDB reference (database.ref(`controllers/${code}`)).
 */
function attachRealtimeListener(ref) {
    if (!ref) return;
    ref.on('value',
        (snapshot) => {
            const controllerData = snapshot.val();
            if (controllerData && controllerData.connected) {
                // Legacy flat shape: one phone driving the solo snake.
                handleJoystickInputFromMobile(controllerData.joystick || { x: 0, y: 0 }, controllerData.timestamp);
                // Fire once per session — this listener re-runs on every joystick
                // update (~30Hz), so anything not per-frame belongs in this guard.
                if (!sessionManager.controllerTracked) {
                    // Did the timeout nudge fire before this phone connected? Capture it for
                    // the funnel BEFORE clearing, so pairing_succeeded can say whether the
                    // nudge "helped". The nudge element being visible == the timer elapsed.
                    const nudgeEl = document.getElementById('desktop-pairing-nudge');
                    const afterNudge = !!(nudgeEl && !nudgeEl.classList.contains('hidden'));
                    sessionManager.controllerTracked = true;
                    clearPairingNudge();
                    updateConnectionStatus('Phone connected ✅');
                    trackEvent('controller_connected', { side: 'desktop' });
                    trackEvent('pairing_succeeded', { after_nudge: afterNudge });
                }
            }
            // Per-slot children: route each live phone's joystick to its player.
            if (typeof mpHandleControllerNode === 'function') {
                mpHandleControllerNode(controllerData);
            }
        },
        (err) => {
            // The listener is cancelled by Firebase on error — report + re-subscribe (bounded).
            if (typeof reportError === 'function') reportError('rtdb_listener', err);
            else console.error('RTDB listener error:', err);
            resubscribeListeners('rtdb');
        });
}

/**
 * Attach the Firestore actions/roster snapshot listener WITH an error callback.
 * onSnapshot's 2nd arg is the error callback — on a drop it reports a bounded
 * `firestore_listener` js_error and attempts a bounded re-subscribe. The unsubscribe
 * handle is cached on sessionManager (beforeunload + re-subscribe both use it).
 * @param {object} sessionDoc - the Firestore session DocumentReference.
 */
function attachFirestoreListener(sessionDoc) {
    if (!sessionDoc) return;
    sessionManager.firestoreUnsubscribe = sessionDoc.onSnapshot(
        (doc) => {
            if (doc.exists) {
                const data = doc.data();
                if (data.gameAction) {
                    debugLog('📱 Game action received:', data.gameAction);
                    handleGameActionFromMobile(data.gameAction);
                    // Clear action immediately
                    sessionDoc.update({
                        gameAction: null,
                        lastActivity: firebase.firestore.FieldValue.serverTimestamp()
                    }).catch(err => console.error('Error clearing game action:', err));
                }
                if (typeof mpHandleDocSnapshot === 'function') {
                    mpHandleDocSnapshot(doc);
                }
            }
        },
        (err) => {
            if (typeof reportError === 'function') reportError('firestore_listener', err);
            else console.error('Firestore listener error:', err);
            resubscribeListeners('firestore');
        });
}

/**
 * Re-attach a dropped desktop listener after a short backoff, bounded by
 * MAX_LISTENER_RETRIES per kind so a permanent error never becomes a hot loop. Guarded
 * by firebaseReady + an active session; after the cap we stop (the Reload affordance is
 * the user's recovery). No new event shape is written — phone side + rules untouched.
 * @param {'rtdb'|'firestore'} kind
 */
function resubscribeListeners(kind) {
    if (!firebaseReady || !sessionManager.currentSession) return;

    if (kind === 'rtdb') {
        if (rtdbListenerRetries >= MAX_LISTENER_RETRIES) return;
        rtdbListenerRetries++;
        setTimeout(() => {
            if (!firebaseReady || !sessionManager.currentSession || !sessionManager.realtimeRef) return;
            try {
                sessionManager.realtimeRef.off('value');
            } catch (_e) { /* ignore — re-attaching anyway */ }
            attachRealtimeListener(sessionManager.realtimeRef);
        }, LISTENER_RETRY_BACKOFF_MS * rtdbListenerRetries);
    } else if (kind === 'firestore') {
        if (firestoreListenerRetries >= MAX_LISTENER_RETRIES) return;
        firestoreListenerRetries++;
        setTimeout(() => {
            if (!firebaseReady || !sessionManager.currentSession || !sessionManager.firestoreDocRef) return;
            if (sessionManager.firestoreUnsubscribe) {
                try { sessionManager.firestoreUnsubscribe(); } catch (_e) { /* ignore */ }
            }
            attachFirestoreListener(sessionManager.firestoreDocRef);
        }, LISTENER_RETRY_BACKOFF_MS * firestoreListenerRetries);
    }
}

/**
 * Ensures firebase instances are fully cached and available before continuing.
 */
function waitForFirebaseReady() {
    return new Promise((resolve, reject) => {
        if (firebaseReady && firestore) {
            resolve();
            return;
        }
        
        let attempts = 0;
        const checkReady = () => {
            attempts++;
            if (firebaseReady && firestore) {
                resolve();
            } else if (attempts > 10) {
                reject(new Error('Firebase initialization timeout'));
            } else {
                setTimeout(checkReady, 500);
            }
        };
        
        checkReady();
    });
}

// True once the desktop's localStorage-mode 'storage' listener is attached, so repeated
// session setups (e.g. Firebase failing after a retry) don't stack duplicate handlers.
let desktopStorageListenerAttached = false;

// Host-side idempotency for the legacy solo action field: the last action we handled and
// when, so a re-delivered / spammed start|restart inside gameConfig.actionIgnoreMs is a
// no-op instead of re-firing startGame/restartGame (and the clearing write it triggers).
// `fired` ensures the action_throttled analytics event emits ONCE per burst, not per drop.
let lastSoloAction = { action: null, at: 0, fired: false };

/**
 * LocalStorage polling backup method if Firebase fails.
 */
function setupLocalStorageSession(sessionCode) {
    debugLog('📱 Using localStorage fallback for session:', sessionCode);
    sessionManager.connectionType = 'localStorage';
    
    localStorage.setItem('currentSession', sessionCode);
    localStorage.setItem(`session_${sessionCode}_state`, JSON.stringify({
        state: GameState.WAITING_FOR_START,
        score: 0,
        ready: true
    }));
    
    // Listen for localStorage changes (guarded so repeat session setups don't stack handlers)
    if (!desktopStorageListenerAttached) {
        desktopStorageListenerAttached = true;
        window.addEventListener('storage', function(e) {
            const code = sessionManager.currentSession;
            if (!code) return;
            if (e.key === `session_${code}_joystick`) {
                const data = safeParse(e.newValue, {});
                if (data.joystick) {
                    handleJoystickInputFromMobile(data.joystick, data.timestamp);
                    updateConnectionStatus('Phone connected (same-device test) ✅');
                }
            } else if (e.key === `session_${code}_action`) {
                const data = safeParse(e.newValue, {});
                if (data.action) {
                    handleGameActionFromMobile(data.action);
                    localStorage.removeItem(`session_${code}_action`);
                }
            }
        });
    }
    
    sessionManager.sessionReady = true;
    // Same-device (two-tab) test mode — label it so it's never mistaken for real
    // cross-device pairing. No timeout nudge here: localStorage can't bridge two devices.
    updateConnectionStatus('Waiting (same-device test mode)…');
}

/**
 * Builds the controller join URL for a code (the QR target AND the copy-link target).
 * Single source of truth so the QR, the fallback link, and the Copy-link button can
 * never drift apart. The code lives in the URL (it's the join link) — never log it.
 * @param {string} sessionCode - The 6-digit session code.
 * @returns {string} `${origin}${pathname}?session=<code>`
 */
function buildJoinUrl(sessionCode) {
    return `${window.location.origin}${window.location.pathname}?session=${sessionCode}`;
}

/**
 * Displays or draws the QR code for connection via mobile
 */
function generateQRCode(sessionCode) {
    const qrContainer = document.getElementById('qr-code-container');
    const qrCanvas = document.getElementById('qr-canvas');
    const qrLoading = document.getElementById('qr-loading');

    if (!qrContainer) return;

    if (qrLoading) qrLoading.style.display = 'flex';
    if (qrContainer) qrContainer.style.display = 'none';

    const gameUrl = buildJoinUrl(sessionCode);
    let qrGenerated = false;
    
    if (typeof QRious !== 'undefined') {
        try {
            const qr = new QRious({
                element: qrCanvas,
                value: gameUrl,
                size: 150,
                foreground: '#000000',
                background: '#ffffff'
            });
            qrGenerated = true;
            
            if (qrLoading) qrLoading.style.display = 'none';
            if (qrContainer) qrContainer.style.display = 'block';
            
        } catch (error) {
            console.error('QRious failed:', error);
        }
    }
    
    if (!qrGenerated) {
        renderJoinFallback(qrContainer, sessionCode, gameUrl);
        if (qrLoading) qrLoading.style.display = 'none';
        if (qrContainer) qrContainer.style.display = 'block';
    }
}

/**
 * Fallback shown when the QR library is unavailable: render the join URL and
 * session code as selectable, copyable text so the player can still connect by
 * typing the link or the code on their phone. (No fake/un-scannable QR.)
 * @param {HTMLElement} container - The QR container element.
 * @param {string} sessionCode - The 6-digit session code.
 * @param {string} gameUrl - The full controller URL embedding the session code.
 */
function renderJoinFallback(container, sessionCode, gameUrl) {
    if (!container) return;

    // Hide the empty QR canvas, if present.
    const canvas = container.querySelector('#qr-canvas');
    if (canvas) canvas.style.display = 'none';

    // Reuse a single fallback node across re-renders.
    let fallback = container.querySelector('.qr-fallback');
    if (!fallback) {
        fallback = document.createElement('div');
        fallback.className = 'qr-fallback';
        fallback.style.cssText = 'text-align:center;padding:8px;font-size:12px;line-height:1.4;';
        container.appendChild(fallback);
    }
    fallback.innerHTML = '';

    const note = document.createElement('p');
    note.textContent = 'QR unavailable — open this on your phone:';

    // Use textContent/href (not innerHTML) so the code can never inject markup.
    const link = document.createElement('a');
    link.href = gameUrl;
    link.textContent = gameUrl;
    link.target = '_blank';
    link.rel = 'noopener';
    link.style.cssText = 'word-break:break-all;display:block;margin:6px 0;';

    const code = document.createElement('p');
    code.textContent = `or enter code: ${sessionCode}`;

    fallback.append(note, link, code);
}

/**
 * Wire the host pairing-card "Copy link" affordance for can't-scan users: populate the
 * visible join-URL element and copy it to the clipboard on click. Uses navigator.clipboard
 * when available (secure context) and gracefully falls back to selecting the URL text so the
 * user can copy manually — never throws (mirrors triggerHaptic/trackEvent posture). The copied
 * URL contains the 6-digit code (it's the join link); that's fine for the clipboard but the
 * code is NEVER passed to trackEvent.
 * @param {string} sessionCode - The 6-digit session code.
 */
function setupPairingCopyLink(sessionCode) {
    const gameUrl = buildJoinUrl(sessionCode);

    // Render the URL via textContent/href (never innerHTML) — same XSS-safe pattern as
    // renderJoinFallback — so the code can never inject markup.
    const linkEl = document.getElementById('join-link');
    if (linkEl) {
        linkEl.href = gameUrl;
        linkEl.textContent = gameUrl;
    }

    const btn = document.getElementById('copy-link-btn');
    if (!btn || btn.dataset.wired === '1') return;
    btn.dataset.wired = '1';

    const confirmCopied = () => {
        const original = btn.dataset.label || btn.textContent;
        btn.dataset.label = original;
        btn.textContent = 'Copied!';
        btn.classList.add('copied');
        setTimeout(() => {
            btn.textContent = btn.dataset.label || 'Can\'t scan? Copy link';
            btn.classList.remove('copied');
        }, 2000);
    };

    const selectFallback = () => {
        // No async clipboard API (insecure context / old browser): select the visible URL
        // so the user can copy it manually. Best-effort; never throws.
        try {
            if (!linkEl) return;
            const range = document.createRange();
            range.selectNodeContents(linkEl);
            const sel = window.getSelection();
            if (sel) { sel.removeAllRanges(); sel.addRange(range); }
        } catch (_e) { /* selection is best-effort */ }
    };

    btn.addEventListener('click', () => {
        // NOTE: gameUrl carries the code — keep it OUT of the analytics payload.
        trackEvent('pairing_link_copied');
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(gameUrl)
                .then(confirmCopied)
                .catch(() => { selectFallback(); confirmCopied(); });
        } else {
            selectFallback();
            confirmCopied();
        }
    });
}

/**
 * Start the single pairing-timeout nudge: after gameConfig.pairingNudgeMs with no phone
 * connected, reveal the "still waiting?" nudge and emit pairing_nudge_shown ONCE. The
 * callback re-checks controllerTracked to avoid racing a phone that connected late. Stashes
 * the timer id on sessionManager so clearPairingNudge() can cancel it on the connect edge.
 * @param {'hybrid'|'localStorage'} transport
 */
function startPairingNudge(transport) {
    if (sessionManager.pairingNudgeTimer) return; // single timer per session
    sessionManager.pairingNudgeTimer = setTimeout(() => {
        sessionManager.pairingNudgeTimer = null;
        if (sessionManager.controllerTracked) return; // a phone already connected
        const nudge = document.getElementById('desktop-pairing-nudge');
        if (nudge) nudge.classList.remove('hidden');
        trackEvent('pairing_nudge_shown', { transport: transport });
    }, gameConfig.pairingNudgeMs);
}

/**
 * Cancel the pending pairing-timeout nudge (a phone connected) and hide it if shown.
 */
function clearPairingNudge() {
    if (sessionManager.pairingNudgeTimer) {
        clearTimeout(sessionManager.pairingNudgeTimer);
        sessionManager.pairingNudgeTimer = null;
    }
    const nudge = document.getElementById('desktop-pairing-nudge');
    if (nudge) nudge.classList.add('hidden');
}

/**
 * Updates joystick parameters locally from mobile pushes (solo path).
 * @param {{x:number,y:number}} joystickInput - the normalized vector.
 * @param {number} [ts] - the packet's client Date.now() stamp, for the monotonic
 *   ordering guard. Missing/non-numeric (legacy phones) is treated as "always newer".
 */
function handleJoystickInputFromMobile(joystickInput, ts) {
    if (gameState.currentState !== GameState.PLAYING) return;

    // Drop out-of-order packets: a late older packet must not overwrite a newer
    // heading. Compared per-source against this same source's previous stamp only.
    if (!isNewerStamp(ts, sessionManager.lastJoystickUpdate)) return;
    if (typeof ts === 'number' && isFinite(ts)) sessionManager.lastJoystickUpdate = ts;

    gameState.joystickInput = joystickInput;

    // Map the joystick vector to a heading + speed (see logic.js).
    const control = joystickToControl(joystickInput, gameState.baseSpeed, gameConfig);
    if (control.active) {
        gameState.targetDirection = control.targetDirection;
    }
    gameState.currentSpeed = control.speed;
}

/**
 * Process remote actions (start/restart) sent from the mobile connected device
 */
function handleGameActionFromMobile(action) {
    // Idempotency / ignore-window: a re-delivered or spammed copy of the same action
    // within actionIgnoreMs is dropped before it can re-fire startGame/restartGame (and
    // the Firestore clearing write that follows). State-based no-ops already guard a
    // mistimed action; this additionally collapses a same-window action FLOOD to one.
    const now = Date.now();
    if (action === lastSoloAction.action && now - lastSoloAction.at < gameConfig.actionIgnoreMs) {
        debugLog('🚫 Ignored repeated solo action within window:', action);
        if (!lastSoloAction.fired && typeof trackEvent === 'function') {
            trackEvent('action_throttled', { side: 'host', kind: 'solo' });
            lastSoloAction.fired = true; // one analytics event per burst, not per dropped write
        }
        return;
    }
    lastSoloAction = { action, at: now, fired: false };

    debugLog('🎮 Handling game action:', action);

    if (action === 'start' && gameState.currentState === GameState.WAITING_FOR_START) {
        startGame();
    } else if (action === 'restart' && gameState.currentState === GameState.GAME_OVER) {
        restartGame();
    }
}

/**
 * Optimized Firebase state updates - MINIMAL operations
 */
async function updateGameStateInFirebase() {
    if (sessionManager.connectionType === 'hybrid' && firestore && sessionManager.currentSession) {
        try {
            // Only update on major state changes - NOT continuous updates
            const sessionDoc = firestore.collection('sessions').doc(sessionManager.currentSession);
            await sessionDoc.update({
                'gameState.state': gameState.currentState,
                'gameState.score': gameState.score,
                lastActivity: firebase.firestore.FieldValue.serverTimestamp()
            });
            debugLog('📊 Game state updated in Firestore');
        } catch (error) {
            console.error('Error updating game state:', error);
        }
    } else if (sessionManager.connectionType === 'localStorage' && sessionManager.currentSession) {
        localStorage.setItem(`session_${sessionManager.currentSession}_state`, JSON.stringify({
            state: gameState.currentState,
            score: gameState.score
        }));
    }
}

/**
 * Sends a one-shot haptic feedback event to the connected phone (which vibrates).
 * Reuses the Firestore session doc the controller already listens to. Best-effort;
 * no-op outside hybrid mode. Vibration only fires on devices that support it.
 * @param {'food'|'crash'} type
 */
function sendHapticFeedback(type) {
    if (sessionManager.connectionType === 'hybrid' && firestore && sessionManager.currentSession) {
        firestore.collection('sessions').doc(sessionManager.currentSession).update({
            feedback: { type: type, at: Date.now() },
            lastActivity: firebase.firestore.FieldValue.serverTimestamp()
        }).catch(() => {});
    }
}

// Cleanup resources on page unload.
window.addEventListener('beforeunload', function() {
    if (sessionManager.firestoreUnsubscribe) {
        sessionManager.firestoreUnsubscribe();
    }
    if (sessionManager.realtimeRef) {
        sessionManager.realtimeRef.off();
    }

    // Only the desktop host owns the session lifecycle. Remove the session on exit
    // so abandoned sessions don't accumulate in Firestore / Realtime DB. These are
    // best-effort (the browser may cut the request short); onDisconnect().remove()
    // is the reliable RTDB backstop, and a Firestore TTL policy on `lastActivity`
    // is recommended for guaranteed Firestore cleanup (see .agent/system/firebase_schema.md).
    if (sessionManager.isDesktop && sessionManager.connectionType === 'hybrid') {
        if (sessionManager.realtimeRef) {
            sessionManager.realtimeRef.remove().catch(() => {});
        }
        if (firestore && sessionManager.currentSession) {
            firestore.collection('sessions').doc(sessionManager.currentSession).delete().catch(() => {});
        }
    }
});
