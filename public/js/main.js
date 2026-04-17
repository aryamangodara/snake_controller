// ==========================================
// BOOTSTRAP / ENTRY POINT
// ==========================================

/**
 * Validates the resolution layout to decide rendering logic
 */
function detectDevice() {
    const isMobile = window.innerWidth <= 768;
    sessionManager.isDesktop = !isMobile;
    
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

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM loaded, initializing app...');
    detectDevice();
    setTimeout(initializeApp, 1000);
});
