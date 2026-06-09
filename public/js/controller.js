// ==========================================
// MOBILE CONTROLLER LOGIC
// ==========================================

/**
 * Grabs the session from URL or prepares listeners
 */
function initializeMobileController() {
    console.log('📱 Initializing mobile controller...');
    
    // Check if session code is passed in URL query param
    const urlParams = new URLSearchParams(window.location.search);
    const sessionFromUrl = urlParams.get('session');

    // Attribute how the controller arrived: scanning the QR carries ?session=, manual entry doesn't.
    trackEvent('controller_arrival', { method: sessionFromUrl ? 'qr' : 'manual_code' });
    
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

function startJoystickDrag(e) {
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

function handleCenterButtonPress() {
    const centerBtn = document.getElementById('btn-center');
    if (!centerBtn || centerBtn.disabled) return;

    const currentIcon = centerBtn.querySelector('.center-icon').textContent;
    if (currentIcon === '▶') {
        sendGameAction('start');
    } else if (currentIcon === '↻') {
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
    console.log('🔗 Attempting to connect to session:', sessionCode);
    showConnectionStatus('Connecting...');
    
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
        console.log(`🔥 Attempting hybrid connection (attempt ${sessionManager.connectionRetries + 1}/${gameConfig.connectionRetries})...`);
        showConnectionStatus(`Connecting to game... (${sessionManager.connectionRetries + 1}/${gameConfig.connectionRetries})`);
        
        await waitForFirebaseReady();
        
        // Find existing created session doc
        const sessionDoc = firestore.collection('sessions').doc(sessionCode);
        console.log('📋 Checking if session exists in Firestore...');
        
        const docSnapshot = await sessionDoc.get();
        if (docSnapshot.exists) {
            const sessionData = docSnapshot.data();
            console.log('✅ Session found in Firestore:', sessionData);
            
            sessionManager.connectedSession = sessionCode;
            sessionManager.connectionType = 'hybrid';
            showControllerInterface();
            showConnectionSuccess();
            console.log('✅ Successfully connected to hybrid session:', sessionCode);
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
            console.log('✅ Updated connection status in Firestore');
            
            sessionManager.realtimeRef = database.ref(`controllers/${sessionCode}`);
            await sessionManager.realtimeRef.set({
                connected: true,
                joystick: { x: 0, y: 0 },
                timestamp: firebase.database.ServerValue.TIMESTAMP
            });
            console.log('✅ Realtime Database connected for joystick input');
            
            if (sessionData.gameState) {
                updateCenterButtonIcon(sessionData.gameState.state);
                updateMobileGameOver(sessionData.gameState);
            }
            
        } else {
            console.log('❌ Session not found in Firestore');
            throw new Error(`Session ${sessionCode} not found in Firestore. Make sure the game is running on desktop.`);
        }
        
    } catch (error) {
        console.error('❌ Hybrid connection failed:', error);
        
        sessionManager.connectionRetries++;
        if (sessionManager.connectionRetries < gameConfig.connectionRetries) {
            console.log(`🔄 Retrying connection in ${gameConfig.retryDelayMs/1000} seconds...`);
            showConnectionError(`Connection failed. Retrying... (${sessionManager.connectionRetries}/${gameConfig.connectionRetries})`);
            
            setTimeout(() => attemptConnection(sessionCode), gameConfig.retryDelayMs);
        } else {
            console.log('🔄 Max retries reached, falling back to localStorage...');
            showConnectionError('Could not connect via Firebase. Trying local mode...');
            connectViaLocalStorage(sessionCode);
        }
    }
}

function connectViaLocalStorage(sessionCode) {
    const currentSession = localStorage.getItem('currentSession');
    
    if (currentSession === sessionCode) {
        sessionManager.connectedSession = sessionCode;
        sessionManager.connectionType = 'localStorage';
        showControllerInterface();
        showConnectionSuccess('Connected via localStorage!');
        console.log('✅ Connected via localStorage:', sessionCode);
        
        const gameStateStr = localStorage.getItem(`session_${sessionCode}_state`);
        const gameStateData = safeParse(gameStateStr, { state: GameState.WAITING_FOR_START });
        updateCenterButtonIcon(gameStateData.state);
        updateMobileGameOver(gameStateData);

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
}

/**
 * Writes a status message into the mobile connection-status element.
 * @param {string} message - Text to display.
 * @param {string} color - CSS color for the message.
 */
function setConnectionStatus(message, color) {
    const statusElement = document.getElementById('mobile-connection-status');
    if (statusElement) {
        statusElement.textContent = message;
        statusElement.style.color = color;
    }
}

function showConnectionSuccess(message = 'Connected! Snake moves continuously!') {
    setConnectionStatus(message, '#00ff00'); // green
}

function showConnectionError(message) {
    setConnectionStatus(message, '#ff1493'); // pink
}

function showConnectionStatus(message) {
    setConnectionStatus(message, '#ff6b35'); // orange
}

function updateCenterButtonIcon(currentState) {
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
    
    const joystickInput = { x, y };
    
    if (sessionManager.connectionType === 'hybrid' && sessionManager.realtimeRef) {
        // Realtime DB avoids throttling limits per second vs firestore
        sessionManager.realtimeRef.update({
            joystick: joystickInput,
            timestamp: firebase.database.ServerValue.TIMESTAMP
        }).catch(error => console.error('Error sending joystick input:', error));
    } else if (sessionManager.connectionType === 'localStorage') {
        localStorage.setItem(`session_${sessionManager.connectedSession}_joystick`, JSON.stringify({
            joystick: joystickInput,
            timestamp: Date.now()
        }));
    }
}

/**
 * Emits signals (Start/Restart) to Firestore since frequency relies on users
 */
function sendGameAction(action) {
    if (!sessionManager.connectedSession) return;
    console.log('📤 Sending game action:', action);
    
    if (sessionManager.connectionType === 'hybrid' && firestore) {
        const sessionDoc = firestore.collection('sessions').doc(sessionManager.connectedSession);
        sessionDoc.update({
            gameAction: action,
            lastActivity: firebase.firestore.FieldValue.serverTimestamp()
        }).catch(error => console.error('Error sending game action:', error));
    } else if (sessionManager.connectionType === 'localStorage') {
        localStorage.setItem(`session_${sessionManager.connectedSession}_action`, JSON.stringify({
            action: action,
            timestamp: Date.now()
        }));
    }
}
