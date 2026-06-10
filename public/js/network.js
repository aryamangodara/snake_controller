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
        await sessionDoc.set({
            created: firebase.firestore.FieldValue.serverTimestamp(),
            connected: false,
            gameState: {
                active: true,
                score: 0,
                state: GameState.WAITING_FOR_START
            },
            lastActivity: firebase.firestore.FieldValue.serverTimestamp(),
            version: Date.now() // Add version for debugging
        });
        
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
            timestamp: firebase.database.ServerValue.TIMESTAMP,
            initialized: true
        });
        debugLog('✅ Realtime Database path initialized');

        // Auto-remove this controller node if the host disconnects, so abandoned
        // sessions clean themselves up server-side (backstop for beforeunload).
        sessionManager.realtimeRef.onDisconnect().remove();
        
        // 4. Listen for Realtime Database changes
        sessionManager.realtimeRef.on('value', (snapshot) => {
            const controllerData = snapshot.val();
            if (controllerData && controllerData.connected) {
                handleJoystickInputFromMobile(controllerData.joystick || { x: 0, y: 0 });
                // Fire once per session — this listener re-runs on every joystick
                // update (~30Hz), so anything not per-frame belongs in this guard.
                if (!sessionManager.controllerTracked) {
                    sessionManager.controllerTracked = true;
                    updateConnectionStatus('Mobile controller connected ✅');
                    trackEvent('controller_connected', { side: 'desktop' });
                }
            }
        });
        
        // 5. Listen to Firestore for game actions
        sessionManager.firestoreUnsubscribe = sessionDoc.onSnapshot((doc) => {
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
            }
        });
        
        sessionManager.firebaseConnected = true;
        sessionManager.sessionReady = true;
        debugLog('🚀 Hybrid session fully ready! Mobile can now connect.');
        updateConnectionStatus('Waiting for mobile controller...');
        
    } catch (error) {
        console.error('❌ Hybrid session setup failed:', error);
        debugLog('🔄 Falling back to localStorage...');
        setupLocalStorageSession(sessionCode);
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
                    handleJoystickInputFromMobile(data.joystick);
                    updateConnectionStatus('Mobile controller connected (localStorage) ✅');
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
    updateConnectionStatus('Waiting for mobile controller (localStorage mode)...');
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
    
    const gameUrl = `${window.location.origin}${window.location.pathname}?session=${sessionCode}`;
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
 * Updates joystick parameters locally from mobile pushes
 */
function handleJoystickInputFromMobile(joystickInput) {
    if (gameState.currentState !== GameState.PLAYING) return;

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
