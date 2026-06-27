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

    // The GA4 device_role user property is set inside enableAnalytics() (config.js) — i.e.
    // only once the user has consented and analytics actually exists — not unconditionally
    // here. Setting it before consent would have required the (now consent-gated) handle.

    debugLog('Device detected:', sessionManager.isDesktop ? 'Desktop' : 'Mobile');
    
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

// ==========================================
// GLOBAL ERROR TRAP + RECOVERY AFFORDANCE
// ==========================================

// True once the recovery bar is on screen, so an error storm shows it ONCE (no stacked
// banners). main.js is the last script loaded, so reportError/trackEvent already exist.
let errorRecoveryShown = false;

// Per-load cap on js_error sends, so a tight error loop (e.g. a throw on every frame
// that still re-arms) can't spam GA4. Reporting past the cap is dropped silently; the
// recovery bar is the user's signal at that point.
let jsErrorSends = 0;
const MAX_JS_ERROR_SENDS = 20;

/**
 * Report an error via the hardened reportError helper, but capped per page load so a
 * runaway loop can't flood GA4. Never throws (reportError already swallows its own errors).
 * @param {string} reason - bounded enum (see reportError).
 * @param {*} err - the thrown value.
 * @param {object} [extra] - low-cardinality params (numbers / bounded enums).
 */
function reportErrorCapped(reason, err, extra) {
    if (jsErrorSends >= MAX_JS_ERROR_SENDS) return;
    jsErrorSends++;
    reportError(reason, err, extra || {});
}

/**
 * Surface a NON-BLOCKING, dismissible "Something went wrong — Reload" bar when a real
 * error is trapped, turning a wedged page into a one-tap recovery. Idempotent: a second
 * or third error never stacks a second bar. Built with createElement + textContent
 * (XSS-safe), fixed in a corner so it never covers the board, and pointer-events sit on
 * its own buttons only — canvas input outside the bar is untouched.
 */
function showErrorRecovery() {
    try {
        if (errorRecoveryShown) return;
        if (typeof document === 'undefined' || !document.body) return;
        errorRecoveryShown = true;

        const bar = document.createElement('div');
        bar.id = 'error-recovery';
        bar.className = 'error-recovery';
        bar.setAttribute('role', 'alert');

        const msg = document.createElement('span');
        msg.className = 'error-recovery-text';
        msg.textContent = 'Something went wrong.';

        const reloadBtn = document.createElement('button');
        reloadBtn.type = 'button';
        reloadBtn.className = 'btn error-recovery-reload';
        reloadBtn.textContent = 'Reload';
        reloadBtn.addEventListener('click', function () { location.reload(); });

        const dismissBtn = document.createElement('button');
        dismissBtn.type = 'button';
        dismissBtn.className = 'error-recovery-dismiss';
        dismissBtn.setAttribute('aria-label', 'Dismiss');
        dismissBtn.textContent = '×';
        dismissBtn.addEventListener('click', function () {
            if (bar.parentNode) bar.parentNode.removeChild(bar);
            // Allow it to re-appear on a later, distinct error after a manual dismiss.
            errorRecoveryShown = false;
        });

        bar.append(msg, reloadBtn, dismissBtn);
        document.body.appendChild(bar);
    } catch (_e) {
        /* the recovery UI must never throw on the error path */
    }
}

/**
 * Install the global error trap as early as possible (module-evaluation time, before the
 * DOMContentLoaded handler below) so a throw anywhere in boot or gameplay is reported and
 * surfaces the recovery bar. Handlers themselves are wrapped so an error inside the trap
 * can't re-trigger itself infinitely.
 */
function installGlobalErrorTrap() {
    window.addEventListener('error', function (e) {
        try {
            reportErrorCapped('window_error', e && e.error, { source_line: (e && e.lineno) || 0 });
            showErrorRecovery();
        } catch (_e) { /* never recurse out of the trap */ }
    });
    window.addEventListener('unhandledrejection', function (e) {
        try {
            reportErrorCapped('unhandled_rejection', e && e.reason);
            showErrorRecovery();
        } catch (_e) { /* never recurse out of the trap */ }
    });
}

// Run at top level (NOT inside DOMContentLoaded) so boot-time errors are caught too.
installGlobalErrorTrap();

// Initialize the application. No artificial delay: Firebase init in config.js runs
// synchronously before DOMContentLoaded, and both session paths already cope with a
// not-yet-ready Firebase (generateNewSession falls back, connectToSession retries).
document.addEventListener('DOMContentLoaded', function() {
    debugLog('DOM loaded, initializing app...');
    detectDevice();
    initializeApp();
});
