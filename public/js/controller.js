// ==========================================
// MOBILE CONTROLLER LOGIC
// ==========================================

// Bounded `reason` enum for controller_connect_failed — frozen so the strings can never
// drift and blow up GA4 cardinality (the low-cardinality guardrail). One value per known
// failure branch of the connect path.
const CONNECT_FAIL_REASONS = Object.freeze({
    NOT_FOUND: 'not_found',                 // Firestore: code typo / host closed
    FIREBASE_UNREACHABLE: 'firebase_unreachable', // Firebase retries exhausted → localStorage
    LS_NOT_FOUND: 'ls_not_found',           // localStorage mode: no matching session
    POST_LOOKUP: 'post_lookup'              // remote doc found, a later handshake step failed (Q8)
});

// 60s "never connected" timer (the created-but-never-paired phone drop-off). Armed when a
// controller view opens; cleared on ANY successful connect (markControllerConnected) so it
// can never fire after a real pairing. Single shared handle (one controller view per page).
let controllerConnectTimer = null;
// Captured arrival method ('qr' | 'manual_code') so controller_never_connected can attribute
// the abandonment without re-reading the URL.
let controllerArrivalMethod = 'manual_code';

/**
 * Clear the 60s never-connected timer the instant any connection path succeeds (solo hybrid,
 * MP slot claim, OR localStorage), and fire the bounded controller_connected. The SINGLE
 * success choke point so controller_never_connected can never fire after a real connect.
 * Idempotent: a second call (re-entrant connect paths) is a harmless no-op.
 */
function markControllerConnected() {
    if (controllerConnectTimer) {
        clearTimeout(controllerConnectTimer);
        controllerConnectTimer = null;
    }
}

/**
 * Grabs the session from URL or prepares listeners
 */
function initializeMobileController() {
    debugLog('📱 Initializing mobile controller...');

    // Check if session code is passed in URL query param
    const urlParams = new URLSearchParams(window.location.search);
    const sessionFromUrl = urlParams.get('session');

    // Attribute how the controller arrived: scanning the QR carries ?session=, manual entry doesn't.
    controllerArrivalMethod = sessionFromUrl ? 'qr' : 'manual_code';
    trackEvent('controller_arrival', { method: controllerArrivalMethod });

    // Arm the created→paired drop-off timer: if no connection succeeds within 60s, fire
    // controller_never_connected ONCE. markControllerConnected() clears it on any success.
    controllerConnectTimer = setTimeout(() => {
        controllerConnectTimer = null;
        trackEvent('controller_never_connected', { arrival: controllerArrivalMethod });
    }, 60000);

    if (sessionFromUrl) {
        const sessionInput = document.getElementById('session-input');
        if (sessionInput) {
            sessionInput.value = sessionFromUrl;
            setTimeout(() => connectToSession(sessionFromUrl), 1000);
        }
    }
    
    setupMobileEventListeners();
}

/**
 * Prepares the DOM event listeners for buttons and joystick
 */
function setupMobileEventListeners() {
    const connectBtn = document.getElementById('connect-btn');
    if (connectBtn) {
        connectBtn.addEventListener('click', function() {
            const sessionInput = document.getElementById('session-input');
            if (sessionInput) {
                const sessionCode = sessionInput.value.trim();
                // Validate 6 digit constraint
                if (sessionCode.length === 6 && /^\d+$/.test(sessionCode)) {
                    connectToSession(sessionCode);
                } else {
                    showConnectionError('Please enter a valid 6-digit code');
                }
            }
        });
    }
    
    // Wire up analog stick behavior
    setupJoystickControls();
    
    // Desktop action triggers (Start, Restart)
    const centerBtn = document.getElementById('btn-center');
    if (centerBtn) {
        centerBtn.addEventListener('click', handleCenterButtonPress);
        
        centerBtn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            handleCenterButtonPress();
            centerBtn.classList.add('active');
        });
        
        centerBtn.addEventListener('touchend', (e) => {
            e.preventDefault();
            centerBtn.classList.remove('active');
        });
    }

    // Wire the game-over share card buttons (share.js): share intents + Play Again.
    if (typeof wireGameOverCard === 'function') wireGameOverCard();
}

/**
 * Initializes listeners for mouse drag and touch move events on joystick
 */
function setupJoystickControls() {
    const joystickBase = document.getElementById('joystick-base');
    const joystickHandle = document.getElementById('joystick-handle');
    
    if (!joystickBase || !joystickHandle) return;
    
    joystickState.baseElement = joystickBase;
    joystickState.handleElement = joystickHandle;
    
    // Mouse events tracking
    joystickHandle.addEventListener('mousedown', startJoystickDrag);
    document.addEventListener('mousemove', handleJoystickDrag);
    document.addEventListener('mouseup', endJoystickDrag);
    
    // Touch events tracking
    joystickHandle.addEventListener('touchstart', startJoystickDrag);
    document.addEventListener('touchmove', handleJoystickDrag, { passive: false });
    document.addEventListener('touchend', endJoystickDrag);
    
    // Snap joystick instantly
    joystickBase.addEventListener('mousedown', moveJoystickToPosition);
    joystickBase.addEventListener('touchstart', moveJoystickToPosition);
}

// ==========================================
// JOYSTICK MATH & MECHANICS
// ==========================================

// First-run hint is dismissed at most once per page load (drag OR auto-fade timer).
let joystickHintDismissed = false;

/**
 * Fade out the first-run "drag to steer" hint. Idempotent / once-only, so a drag and the
 * auto-fade timer can both call it harmlessly. Stateless across page loads by design.
 */
function dismissJoystickHint() {
    if (joystickHintDismissed) return;
    joystickHintDismissed = true;
    const hint = document.getElementById('joystick-hint');
    if (hint) hint.classList.add('dismissed');
}

function startJoystickDrag(e) {
    dismissJoystickHint(); // first drag teaches the mechanic — clear the hint
    e.preventDefault();
    joystickState.isDragging = true;
    joystickState.handleElement.classList.add('dragging');
    
    const rect = joystickState.baseElement.getBoundingClientRect();
    joystickState.baseRect = rect;
    joystickState.maxDistance = rect.width / 2 * 0.8;
}

function getPointerPosition(e) {
    if (typeof e.clientX === 'number' && typeof e.clientY === 'number') {
        return { x: e.clientX, y: e.clientY };
    }

    if (e.touches && e.touches.length > 0) {
        return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }

    return null;
}

function handleJoystickDrag(e) {
    if (!joystickState.isDragging) return;
    e.preventDefault();
    
    const pointerPosition = getPointerPosition(e);
    if (!pointerPosition) return;
    
    const rect = joystickState.baseRect;
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    
    let deltaX = pointerPosition.x - centerX;
    let deltaY = pointerPosition.y - centerY;
    
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    
    // Clamp handle inside circle base
    if (distance > joystickState.maxDistance) {
        const ratio = joystickState.maxDistance / distance;
        deltaX *= ratio;
        deltaY *= ratio;
    }
    
    joystickState.handleElement.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
    
    const normalizedX = deltaX / joystickState.maxDistance;
    const normalizedY = deltaY / joystickState.maxDistance;
    
    // THROTTLED input updates downstream to save bandwidth / CPU
    const now = Date.now();
    if (now - joystickState.lastInputTime > gameConfig.joystickThrottleMs) {
        sendJoystickInput(normalizedX, normalizedY);
        joystickState.lastInputTime = now;
    }
}

function endJoystickDrag(e) {
    if (!joystickState.isDragging) return;
    
    e.preventDefault();
    joystickState.isDragging = false;
    joystickState.handleElement.classList.remove('dragging');
    
    // Reset back to center automatically
    joystickState.handleElement.style.transform = 'translate(0px, 0px)';
    sendJoystickInput(0, 0); 
}

function moveJoystickToPosition(e) {
    if (joystickState.isDragging) return;
    dismissJoystickHint(); // tap-to-snap counts as a first drag too
    e.preventDefault();
    
    const rect = joystickState.baseElement.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    
    const pointerPosition = getPointerPosition(e);
    if (!pointerPosition) return;
    
    let deltaX = pointerPosition.x - centerX;
    let deltaY = pointerPosition.y - centerY;
    
    const maxDistance = rect.width / 2 * 0.8;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    
    if (distance > maxDistance) {
        const ratio = maxDistance / distance;
        deltaX *= ratio;
        deltaY *= ratio;
    }
    
    joystickState.isDragging = true;
    joystickState.baseRect = rect;
    joystickState.maxDistance = maxDistance;
    
    handleJoystickDrag({ clientX: pointerPosition.x, clientY: pointerPosition.y, preventDefault: () => {} });
}

// ==========================================
// CONTROLLER EVENT HELPERS
// ==========================================

// Last game state synced from the desktop host — drives what the center button
// DOES; the icon glyph is derived display only (see updateCenterButtonIcon).
let syncedGameState = null;

function handleCenterButtonPress() {
    const centerBtn = document.getElementById('btn-center');
    if (!centerBtn || centerBtn.disabled) return;

    if (syncedGameState === GameState.WAITING_FOR_START) {
        sendGameAction('start');
    } else if (syncedGameState === GameState.GAME_OVER) {
        sendGameAction('restart');
    }
}

// Tracks the last feedback event we vibrated for, so repeated snapshot
// deliveries of the same event don't buzz more than once.
let lastFeedbackAt = 0;
// Tracks the last synced game state so the loss reaction (haptic + flash) fires
// exactly ONCE per loss, not on every snapshot. Re-arms when a new game starts.
let lastSyncedState = null;

/**
 * Fire a haptic buzz on the phone — cross-platform and best-effort. Never throws.
 *   • Android (Chrome/Firefox): the real Vibration API.
 *   • iOS Safari: navigator.vibrate has NEVER existed, so we fall back to the hidden
 *     <input switch> trick (Safari 17.4+). Apple patched *programmatic* triggering in
 *     iOS 26.5, so there (and on unsupported browsers) this is a harmless no-op — the
 *     on-screen .loss-flash cue is what covers iPhones.
 * Independent of the audio mute by design: a silenced player still feels the loss.
 * @param {number|number[]} pattern - ms, or an on/off pattern array.
 */
function triggerHaptic(pattern) {
    try {
        if (typeof navigator.vibrate === 'function') { navigator.vibrate(pattern); return; }
        const label = document.createElement('label');
        label.setAttribute('aria-hidden', 'true');
        label.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;';
        const sw = document.createElement('input');
        sw.type = 'checkbox';
        sw.setAttribute('switch', '');
        label.appendChild(sw);
        document.body.appendChild(label);
        try { label.click(); } finally { label.remove(); }
    } catch (e) {
        /* haptics must never throw into gameplay */
    }
}

/**
 * Phone-side haptic for a one-shot feedback event from the desktop host (food only;
 * the loss buzz is driven off the GAME_OVER transition in updateMobileGameOver).
 * @param {{type:string, at:number}} feedback
 */
function handleHapticFeedback(feedback) {
    if (!feedback || typeof feedback.at !== 'number' || feedback.at === lastFeedbackAt) return;
    lastFeedbackAt = feedback.at;
    if (feedback.type === 'food') triggerHaptic(40);
}

/**
 * Brief shake + red danger flash on the game-over card — the iOS-safe loss cue (works
 * where haptics can't). Re-triggers reliably by forcing a reflow before re-adding the
 * class, and self-cleans on animationend.
 * @param {HTMLElement} card - the #mobile-game-over element.
 */
function playLossFlash(card) {
    const target = card.querySelector('.mobile-game-over-content') || card;
    target.classList.remove('loss-flash');
    void target.offsetWidth; // force reflow so the animation restarts from frame 0
    target.classList.add('loss-flash');
    target.addEventListener('animationend', function handler() {
        target.classList.remove('loss-flash');
        target.removeEventListener('animationend', handler);
    });
}

function connectToSession(sessionCode) {
    debugLog('🔗 Attempting to connect to session:', sessionCode);
    showConnectionStatus('Connecting...');

    // Fresh attempt: clear the "we saw a remote session doc" flag so a previous
    // attempt can't make THIS one wrongly suppress the single-device fallback.
    sessionManager.remoteSessionFound = false;
    sessionManager.connectionRetries = 0;
    attemptConnection(sessionCode);
}

// Connection with retry fallback logic
function attemptConnection(sessionCode) {
    if (firebaseReady) {
        connectViaRobustHybrid(sessionCode);
    } else {
        connectViaLocalStorage(sessionCode);
    }
}

async function connectViaRobustHybrid(sessionCode) {
    try {
        // Attempt count is dev-only telemetry — keep it in debugLog, NOT in user-facing copy.
        debugLog(`🔥 Attempting hybrid connection (attempt ${sessionManager.connectionRetries + 1}/${gameConfig.connectionRetries})...`);
        showConnectionStatus('Connecting…');
        
        await waitForFirebaseReady();
        
        // Find existing created session doc
        const sessionDoc = firestore.collection('sessions').doc(sessionCode);
        debugLog('📋 Checking if session exists in Firestore...');
        
        const docSnapshot = await sessionDoc.get();
        if (docSnapshot.exists) {
            const sessionData = docSnapshot.data();
            debugLog('✅ Session found in Firestore:', sessionData);

            // A REMOTE session doc was actually read. Record it BEFORE the later
            // RTDB/Firestore steps that can throw, so the catch can tell "Firebase was
            // reachable, a later step failed" (honest retryable error — localStorage
            // can't bridge two devices) apart from "Firebase never came up" (the only
            // case the same-device localStorage fallback can legitimately serve).
            sessionManager.remoteSessionFound = true;

            // Multiplayer-capable session (every NEW desktop creates these):
            // the whole join/lobby/round journey lives in mp-client.js. The
            // legacy path below keeps serving old cached desktops. The MP join
            // bypasses showControllerInterface, so clear the never-connected timer
            // HERE before delegating (the remote doc was read = a real connection).
            if (sessionData.mode === 'multi' && typeof connectMultiplayer === 'function') {
                markControllerConnected();
                return connectMultiplayer(sessionCode, sessionDoc, sessionData);
            }

            markControllerConnected(); // a real connect — disarm the never-connected timer
            sessionManager.connectedSession = sessionCode;
            sessionManager.connectionType = 'hybrid';
            showControllerInterface();
            showConnectionSuccess();
            debugLog('✅ Successfully connected to hybrid session:', sessionCode);
            trackEvent('controller_connected', { side: 'phone' });
            
            // Listen to Firestore for session server updates
            sessionManager.firestoreUnsubscribe = sessionDoc.onSnapshot((doc) => {
                if (doc.exists) {
                    const data = doc.data();
                    if (data.gameState) {
                        updateCenterButtonIcon(data.gameState.state);
                        updateMobileGameOver(data.gameState);
                    }
                    if (data.feedback) {
                        handleHapticFeedback(data.feedback);
                    }
                }
            }, (error) => {
                console.error('❌ Firestore listener error:', error);
                showConnectionError('Connection lost. Please refresh and try again.');
            });
            
            // Update connection status centrally
            await sessionDoc.update({ 
                connected: true,
                lastActivity: firebase.firestore.FieldValue.serverTimestamp()
            });
            debugLog('✅ Updated connection status in Firestore');
            
            sessionManager.realtimeRef = database.ref(`controllers/${sessionCode}`);
            await sessionManager.realtimeRef.set({
                connected: true,
                joystick: { x: 0, y: 0 },
                timestamp: Date.now()
            });
            debugLog('✅ Realtime Database connected for joystick input');
            
            if (sessionData.gameState) {
                updateCenterButtonIcon(sessionData.gameState.state);
                updateMobileGameOver(sessionData.gameState);
            }
            
        } else {
            debugLog('❌ Session not found in Firestore');
            const err = new Error(`Session ${sessionCode} not found in Firestore. Make sure the game is running on desktop.`);
            err.notFound = true;
            throw err;
        }

    } catch (error) {
        console.error('❌ Hybrid connection failed:', error);

        // Firebase answered fine — the code is just wrong (typo, or the desktop closed).
        // Retrying or silently dropping into single-device localStorage mode would only
        // confuse the player; tell them plainly and let them re-enter the code.
        if (error.notFound) {
            sessionManager.connectionRetries = 0;
            showConnectionError('Session not found — check the 6-digit code on the game screen.');
            // Firebase answered: the code is just wrong / the host closed. Distinct from the
            // post-lookup and unreachable branches so the pairing drop can be split by cause.
            trackEvent('controller_connect_failed', { reason: CONNECT_FAIL_REASONS.NOT_FOUND });
            return;
        }

        sessionManager.connectionRetries++;
        if (sessionManager.connectionRetries < gameConfig.connectionRetries) {
            // Retry math is dev-only — route the counts to debugLog, keep the user copy generic.
            debugLog(`🔄 Retrying connection in ${gameConfig.retryDelayMs/1000}s (attempt ${sessionManager.connectionRetries}/${gameConfig.connectionRetries})...`);
            showConnectionError('Connection trouble — retrying…');

            setTimeout(() => attemptConnection(sessionCode), gameConfig.retryDelayMs);
        } else if (sessionManager.remoteSessionFound) {
            // The remote session doc DID exist — a later handshake step (RTDB .set,
            // Firestore update, transient blip) failed. localStorage can never bridge
            // two physical devices, so DON'T pretend to "try local mode". Tell the user
            // plainly and reset the counter so the next Connect tap is a clean attempt.
            debugLog('🔄 Max retries reached after a remote session was found — honest retryable error (no localStorage).');
            sessionManager.connectionRetries = 0;
            showConnectionError("Couldn't finish connecting. Check your connection and tap Connect to try again.");
            trackEvent('controller_connect_failed', { reason: CONNECT_FAIL_REASONS.POST_LOOKUP });
        } else {
            // Firebase was never available to this controller (e.g. waitForFirebaseReady
            // rejected before the .get()) so we never confirmed a remote doc. This is the
            // only case where same-device (two-tab) localStorage testing can apply.
            debugLog('🔄 Max retries reached, Firebase unavailable — retrying locally for same-device testing...');
            showConnectionError('Couldn\'t reach the game server — retrying locally for same-device testing…');
            // Firebase retries exhausted with no remote doc confirmed → degrade to localStorage.
            // Record both the connect failure cause AND the transport degradation (pairs with
            // the desktop's offline_fallback{side:'desktop'}).
            trackEvent('controller_connect_failed', { reason: CONNECT_FAIL_REASONS.FIREBASE_UNREACHABLE });
            trackEvent('offline_fallback', { side: 'phone' });
            connectViaLocalStorage(sessionCode);
        }
    }
}

// True once the localStorage-mode 'storage' listener is attached, so repeated
// Connect taps (e.g. after a failed Firebase attempt) don't stack duplicate handlers.
let storageListenerAttached = false;

function connectViaLocalStorage(sessionCode) {
    const currentSession = localStorage.getItem('currentSession');

    if (currentSession === sessionCode) {
        markControllerConnected(); // same-device connect established — disarm the timer
        sessionManager.connectedSession = sessionCode;
        sessionManager.connectionType = 'localStorage';
        showControllerInterface();
        showConnectionSuccess('Connected via localStorage!');
        debugLog('✅ Connected via localStorage:', sessionCode);

        const gameStateStr = localStorage.getItem(`session_${sessionCode}_state`);
        const gameStateData = safeParse(gameStateStr, { state: GameState.WAITING_FOR_START });
        updateCenterButtonIcon(gameStateData.state);
        updateMobileGameOver(gameStateData);

        if (storageListenerAttached) return;
        storageListenerAttached = true;
        window.addEventListener('storage', function(e) {
            if (e.key === `session_${sessionCode}_state`) {
                const data = safeParse(e.newValue, {});
                if (data.state) {
                    updateCenterButtonIcon(data.state);
                    updateMobileGameOver(data);
                }
            }
        });
        
    } else {
        showConnectionError('Session not found. Make sure the game is running on desktop and try again.');
        // localStorage mode found no matching session (the same-device-test miss). Bounded
        // reason so the three connect failure causes stay separable in GA4.
        trackEvent('controller_connect_failed', { reason: CONNECT_FAIL_REASONS.LS_NOT_FOUND });
    }
}

// ==========================================
// DOM VIEW CONTROLLERS
// ==========================================

function showControllerInterface() {
    const connectionForm = document.getElementById('connection-form');
    const controllerInterface = document.getElementById('controller-interface');

    if (connectionForm) connectionForm.style.display = 'none';
    if (controllerInterface) controllerInterface.style.display = 'block';

    // Reveal the first-run joystick hint now the stick is on screen. Auto-fade after a few
    // seconds so it never lingers for a player who reads, then presses ▶ instead of dragging.
    const hint = document.getElementById('joystick-hint');
    if (hint && !joystickHintDismissed) {
        hint.classList.remove('hidden');
        setTimeout(dismissJoystickHint, 6000);
    }
}

/**
 * Writes a status message into the mobile connection-status element and colors it from a
 * brand token via a CSS class (no inline hex), so it stays on-brand in light AND dark mode.
 * @param {string} message - Text to display.
 * @param {'success'|'error'|'info'} variant - Which semantic token class to apply.
 */
function setConnectionStatus(message, variant) {
    const statusElement = document.getElementById('mobile-connection-status');
    if (statusElement) {
        statusElement.textContent = message;
        statusElement.classList.remove('is-success', 'is-error', 'is-info');
        statusElement.classList.add('is-' + variant);
    }
}

function showConnectionSuccess(message = 'Connected! Snake moves continuously!') {
    setConnectionStatus(message, 'success');
}

function showConnectionError(message) {
    setConnectionStatus(message, 'error');
}

function showConnectionStatus(message) {
    setConnectionStatus(message, 'info');
}

function updateCenterButtonIcon(currentState) {
    syncedGameState = currentState;

    const centerBtn = document.getElementById('btn-center');
    if (!centerBtn) return;

    const btnIcon = centerBtn.querySelector('.center-icon');
    centerBtn.classList.remove('ready', 'playing', 'restart');
    
    if (currentState === GameState.WAITING_FOR_START) {
        centerBtn.disabled = false;
        centerBtn.classList.add('ready');
        if (btnIcon) btnIcon.textContent = '▶';
    } else if (currentState === GameState.GAME_OVER) {
        centerBtn.disabled = false;
        centerBtn.classList.add('restart');
        if (btnIcon) btnIcon.textContent = '↻';
    } else if (currentState === GameState.PLAYING) {
        centerBtn.disabled = true;
        centerBtn.classList.add('playing');
        if (btnIcon) btnIcon.textContent = '🐍';
    }
}

/**
 * Shows/hides the phone's game-over share card and reflects the synced final score.
 * Mirrors the desktop's score into the local gameState so share.js can read it.
 * @param {{state:string, score:(number|undefined)}} gs - the desktop's synced game state.
 */
function updateMobileGameOver(gs) {
    if (!gs) return;
    if (typeof gs.score === 'number') gameState.score = gs.score;

    const card = document.getElementById('mobile-game-over');
    if (!card) return;

    if (gs.state === GameState.GAME_OVER) {
        const scoreEl = document.getElementById('mobile-final-score');
        if (scoreEl) scoreEl.textContent = (typeof gs.score === 'number' ? gs.score : gameState.score).toString();
        card.classList.remove('hidden');

        // React ONCE per loss: a strong "you lost" buzz + an on-screen shake/flash.
        // Driven off the state edge so it works in BOTH Firebase and localStorage modes.
        if (lastSyncedState !== GameState.GAME_OVER) {
            triggerHaptic([120, 60, 120, 60, 240]);
            playLossFlash(card);
            // The defeat/share card is the highest-intent moment in the loop. Fire rematch_prompt
            // on this SAME once-per-loss edge guard so it can't double-fire on snapshot replays.
            // mode keys off the MP slot (typeof-guarded — mp-client.js may be absent on this path).
            const onMpSlot = typeof mpClient !== 'undefined' && mpClient && mpClient.slot;
            trackEvent('rematch_prompt', { mode: onMpSlot ? 'multi' : 'solo' });
        }
    } else {
        card.classList.add('hidden');
    }

    lastSyncedState = gs.state;
}

// ==========================================
// DATA TRANSMISSION
// ==========================================

/**
 * Optimally sends XY offsets to the backend
 */
function sendJoystickInput(x, y) {
    if (!sessionManager.connectedSession) return;

    // Change-gate: a held-steady stick (Δ < joystickEpsilon) re-sends nothing, so RTDB/
    // localStorage writes collapse toward zero while the stick is parked. The (0,0)
    // release is always allowed through (gated only against a duplicate zero) so the
    // snake reliably coasts. Applies to BOTH transports — this is the single send path.
    if (!shouldSendJoystick(x, y, joystickState.lastSentX, joystickState.lastSentY, gameConfig.joystickEpsilon)) {
        return;
    }

    const joystickInput = { x, y };
    // Client stamp (Date.now()) instead of the server-resolved sentinel: the host only
    // compares each source's stamp against that SAME source's previous stamp (never
    // cross-device), so no server round-trip is needed for ordering.
    const stamp = Date.now();

    if (sessionManager.connectionType === 'hybrid' && sessionManager.realtimeRef) {
        // Realtime DB avoids throttling limits per second vs firestore
        sessionManager.realtimeRef.update({
            joystick: joystickInput,
            timestamp: stamp
        }).catch(error => console.error('Error sending joystick input:', error));
    } else if (sessionManager.connectionType === 'localStorage') {
        localStorage.setItem(`session_${sessionManager.connectedSession}_joystick`, JSON.stringify({
            joystick: joystickInput,
            timestamp: stamp
        }));
    } else {
        return; // no transport — don't record this as sent
    }

    // Only update the change-gate reference when a write actually went out.
    joystickState.lastSentX = x;
    joystickState.lastSentY = y;
}

/**
 * Emits signals (Start/Restart) to Firestore since frequency relies on users
 */
function sendGameAction(action) {
    if (!sessionManager.connectedSession) return;
    debugLog('📤 Sending game action:', action);
    
    if (sessionManager.connectionType === 'hybrid' && firestore) {
        const sessionDoc = firestore.collection('sessions').doc(sessionManager.connectedSession);
        const update = { lastActivity: firebase.firestore.FieldValue.serverTimestamp() };
        if (mpClient.slot) update['gameActions.' + mpClient.slot] = action; // multiplayer: own slot
        else update.gameAction = action;                                    // legacy solo field
        sessionDoc.update(update).catch(error => console.error('Error sending game action:', error));
    } else if (sessionManager.connectionType === 'localStorage') {
        localStorage.setItem(`session_${sessionManager.connectedSession}_action`, JSON.stringify({
            action: action,
            timestamp: Date.now()
        }));
    }
}
