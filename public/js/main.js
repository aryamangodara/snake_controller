// ==========================================
// BOOTSTRAP / ENTRY POINT
// ==========================================

/**
 * Decides the device role ONCE for the whole app: a narrow viewport or a
 * `?session=` URL param (arriving via QR scan) means this device is the
 * controller. Everything else — including the inline reveal script in
 * index.html — must READ sessionManager.isDesktop, never recompute it.
 */
function detectDevice() {
    const isController = window.innerWidth <= 768 ||
        new URLSearchParams(window.location.search).has('session');
    sessionManager.isDesktop = !isController;

    // Tag the GA4 session with the device role so the two audiences are segmentable.
    try {
        if (typeof analytics !== 'undefined' && analytics) {
            analytics.setUserProperties({
                device_role: sessionManager.isDesktop ? 'desktop_host' : 'phone_controller'
            });
        }
    } catch (e) { /* ignore */ }
    
    console.log('Device detected:', sessionManager.isDesktop ? 'Desktop' : 'Mobile');
    
    const desktopView = document.getElementById('desktop-view');
    const mobileView = document.getElementById('mobile-view');
    
    if (sessionManager.isDesktop) {
        if (desktopView) desktopView.style.display = 'block';
        if (mobileView) mobileView.style.display = 'none';
    } else {
        if (desktopView) desktopView.style.display = 'none';
        if (mobileView) mobileView.style.display = 'block';
    }
}

/**
 * Triggers the specific UI controllers
 */
function initializeApp() {
    if (sessionManager.isDesktop) {
        initializeDesktopGame();
    } else {
        initializeMobileController();
    }
}

// Initialize the application. No artificial delay: Firebase init in config.js runs
// synchronously before DOMContentLoaded, and both session paths already cope with a
// not-yet-ready Firebase (generateNewSession falls back, connectToSession retries).
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM loaded, initializing app...');
    detectDevice();
    initializeApp();
});
