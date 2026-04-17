// ==========================================
// NETWORK & SESSION LOGIC
// ==========================================

/**
 * Generates a new session for the desktop app, creating a 6-digit code,
 * setting up the database listeners, and generating the QR code.
 */
function generateNewSession() {
    const sessionCode = Math.floor(100000 + Math.random() * 900000).toString();
    sessionManager.currentSession = sessionCode;
    
    console.log('🎮 Generated session code:', sessionCode);
    
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
}

/**
 * ROBUST HYBRID SESSION with better error handling.
 * Creates the session in Firestore and Database to listen for mobile connections.
 */
async function setupRobustHybridSession(sessionCode) {
    try {
        sessionManager.connectionType = 'hybrid';
        console.log('🔥 Setting up robust hybrid session...');
        
        // Wait for Firestore to be ready
        await waitForFirebaseReady();
        
        // 1. Create session in Firestore with detailed logging
        const sessionDoc = firestore.collection('sessions').doc(sessionCode);
        
        console.log('📝 Creating session document in Firestore...');
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
        
        console.log('✅ Session document created successfully in Firestore');
        
        // 2. Verify session was created by reading it back
        const verification = await sessionDoc.get();
        if (!verification.exists) {
            throw new Error('Session verification failed - document not found after creation');
        }
        console.log('✅ Session verified in Firestore:', verification.data());
        
        // 3. Set up Realtime Database path
        sessionManager.realtimeRef = database.ref(`controllers/${sessionCode}`);
        console.log('📡 Setting up Realtime Database path...');
        
        // Initialize Realtime Database path
        await sessionManager.realtimeRef.set({
            connected: false,
            joystick: { x: 0, y: 0 },
            timestamp: firebase.database.ServerValue.TIMESTAMP,
            initialized: true
        });
        console.log('✅ Realtime Database path initialized');
        
        // 4. Listen for Realtime Database changes
        sessionManager.realtimeRef.on('value', (snapshot) => {
            const controllerData = snapshot.val();
            if (controllerData && controllerData.connected) {
                handleJoystickInputFromMobile(controllerData.joystick || { x: 0, y: 0 });
                updateConnectionStatus('Mobile controller connected ✅');
            }
        });
        
        // 5. Listen to Firestore for game actions
        sessionManager.firestoreUnsubscribe = sessionDoc.onSnapshot((doc) => {
            if (doc.exists) {
                const data = doc.data();
                if (data.gameAction) {
                    console.log('📱 Game action received:', data.gameAction);
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
        console.log('🚀 Hybrid session fully ready! Mobile can now connect.');
        updateConnectionStatus('Waiting for mobile controller...');
        
    } catch (error) {
        console.error('❌ Hybrid session setup failed:', error);
        console.log('🔄 Falling back to localStorage...');
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

/**
 * LocalStorage polling backup method if Firebase fails.
 */
function setupLocalStorageSession(sessionCode) {
    console.log('📱 Using localStorage fallback for session:', sessionCode);
    sessionManager.connectionType = 'localStorage';
    
    localStorage.setItem('currentSession', sessionCode);
    localStorage.setItem(`session_${sessionCode}_state`, JSON.stringify({
        state: GameState.WAITING_FOR_START,
        score: 0,
        ready: true
    }));
    
    // Listen for localStorage changes
    window.addEventListener('storage', function(e) {
        if (e.key === `session_${sessionCode}_joystick`) {
            const data = JSON.parse(e.newValue || '{}');
            if (data.joystick) {
                handleJoystickInputFromMobile(data.joystick);
                updateConnectionStatus('Mobile controller connected (localStorage) ✅');
            }
        } else if (e.key === `session_${sessionCode}_action`) {
            const data = JSON.parse(e.newValue || '{}');
            if (data.action) {
                handleGameActionFromMobile(data.action);
                localStorage.removeItem(`session_${sessionCode}_action`);
            }
        }
    });
    
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
        setTimeout(() => {
            drawPlaceholderQR(qrCanvas, sessionCode);
            if (qrLoading) qrLoading.style.display = 'none';
            if (qrContainer) qrContainer.style.display = 'block';
        }, 1000);
    }
}

/**
 * Draws a backup grid pattern if QRious fails to load
 */
function drawPlaceholderQR(canvas, sessionCode) {
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 150, 150);
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.strokeRect(5, 5, 140, 140);
    ctx.fillStyle = '#000000';
    
    // QR corners
    [[15, 15], [110, 15], [15, 110]].forEach(([x, y]) => {
        ctx.fillRect(x, y, 25, 25);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x + 5, y + 5, 15, 15);
        ctx.fillStyle = '#000000';
        ctx.fillRect(x + 8, y + 8, 9, 9);
    });
    
    // Random pattern
    for (let i = 0; i < 20; i++) {
        const x = Math.floor(Math.random() * 100) + 25;
        const y = Math.floor(Math.random() * 100) + 25;
        ctx.fillRect(x, y, 3, 3);
    }
    
    ctx.font = 'bold 10px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('SCAN QR', 75, 60);
    ctx.font = '8px Arial';
    ctx.fillText(`Code: ${sessionCode}`, 75, 75);
}

/**
 * Updates joystick parameters locally from mobile pushes
 */
function handleJoystickInputFromMobile(joystickInput) {
    if (gameState.currentState === GameState.PLAYING) {
        gameState.joystickInput = joystickInput;
        
        // Calculate direction and speed from joystick
        const magnitude = Math.sqrt(joystickInput.x * joystickInput.x + joystickInput.y * joystickInput.y);
        
        if (magnitude > 0.1) {
            // Update target direction based on joystick
            gameState.targetDirection = Math.atan2(joystickInput.y, joystickInput.x);
            
            // Speed boost based on joystick magnitude
            const speedBoost = Math.min(magnitude, 1) * gameConfig.maxSpeedBoost;
            gameState.currentSpeed = gameState.baseSpeed + speedBoost;
        } else {
            // No joystick input - snake moves at constant base speed
            gameState.currentSpeed = gameState.baseSpeed;
        }
    }
}

/**
 * Process remote actions (start/restart) sent from the mobile connected device
 */
function handleGameActionFromMobile(action) {
    console.log('🎮 Handling game action:', action);
    
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
            console.log('📊 Game state updated in Firestore');
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

// Cleanup resources on page unload
window.addEventListener('beforeunload', function() {
    if (sessionManager.firestoreUnsubscribe) {
        sessionManager.firestoreUnsubscribe();
    }
    if (sessionManager.realtimeRef) {
        sessionManager.realtimeRef.off();
    }
});
