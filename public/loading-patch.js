// Loading screen integration patch
// Add this script before your main app.js or at the beginning of app.js

(function() {
    // Override the original detectDevice function to work with loading screen
    const originalDetectDevice = window.detectDevice || function() {
        const isMobile = window.innerWidth <= 768;
        const sessionManagerExists = typeof sessionManager !== 'undefined';
        
        if (sessionManagerExists) {
            sessionManager.isDesktop = !isMobile;
        }
        
        console.log('Device detected:', !isMobile ? 'Desktop' : 'Mobile');
        
        // Only show views after loading is complete
        if (window.loadingCompleted) {
            showAppropriateView(!isMobile);
        }
    };
    
    // Function to show the correct view
    function showAppropriateView(isDesktop) {
        const desktopView = document.getElementById('desktop-view');
        const mobileView = document.getElementById('mobile-view');
        
        if (isDesktop) {
            if (desktopView) desktopView.style.display = 'block';
            if (mobileView) mobileView.style.display = 'none';
        } else {
            if (desktopView) desktopView.style.display = 'none';
            if (mobileView) mobileView.style.display = 'block';
        }
    }
    
    // Listen for loading complete event
    window.addEventListener('loadingComplete', function() {
        console.log('Loading completed, showing app views...');
        
        // Detect device and show appropriate view
        const isMobile = window.innerWidth <= 768;
        const sessionManagerExists = typeof sessionManager !== 'undefined';
        
        if (sessionManagerExists) {
            sessionManager.isDesktop = !isMobile;
        }
        
        showAppropriateView(!isMobile);
        
        // Initialize the app if the function exists
        if (typeof initializeApp === 'function') {
            setTimeout(initializeApp, 100);
        }
    });
    
    // Override detectDevice globally
    window.detectDevice = originalDetectDevice;
    
    // Patch the DOM ready event handler
    const originalAddEventListener = document.addEventListener;
    let domReadyHandled = false;
    
    document.addEventListener = function(type, listener, options) {
        if (type === 'DOMContentLoaded' && !domReadyHandled) {
            domReadyHandled = true;
            
            // Call original listener but delay initialization until loading is done
            originalAddEventListener.call(document, type, function() {
                console.log('DOM loaded, waiting for loading screen...');
                
                // Wait for loading to complete before running app initialization
                if (window.loadingCompleted) {
                    listener.apply(this, arguments);
                } else {
                    window.addEventListener('loadingComplete', function() {
                        listener.apply(document, arguments);
                    });
                }
            }, options);
        } else {
            originalAddEventListener.call(document, type, listener, options);
        }
    };
})();