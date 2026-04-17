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
            
            // Listen to Firestore for session server updates
            sessionManager.firestoreUnsubscribe = sessionDoc.onSnapshot((doc) => {
                if (doc.exists) {
                    const data = doc.data();
                    if (data.gameState) {
                        updateCenterButtonIcon(data.gameState.state);
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
        const gameStateData = gameStateStr ? JSON.parse(gameStateStr) : { state: GameState.WAITING_FOR_START };
        updateCenterButtonIcon(gameStateData.state);
        
        window.addEventListener('storage', function(e) {
            if (e.key === `session_${sessionCode}_state`) {
                const data = JSON.parse(e.newValue || '{}');
                if (data.state) {
                    updateCenterButtonIcon(data.state);
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

function showConnectionSuccess(message = 'Connected! Snake moves continuously!') {
    const statusElement = document.getElementById('mobile-connection-status');
    if (statusElement) {
        statusElement.textContent = message;
        statusElement.style.color = '#00ff00';
    }
}

function showConnectionError(message) {
    const statusElement = document.getElementById('mobile-connection-status');
    if (statusElement) {
        statusElement.textContent = message;
        statusElement.style.color = '#ff1493';
    }
}

function showConnectionStatus(message) {
    const statusElement = document.getElementById('mobile-connection-status');
    if (statusElement) {
        statusElement.textContent = message;
        statusElement.style.color = '#ff6b35';
    }
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
