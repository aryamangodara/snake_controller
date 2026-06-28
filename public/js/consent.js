// ==========================================
// ANALYTICS CONSENT GATE + PRIVACY POLICY
// ==========================================
// OPT-IN consent layer that sits between "Firebase core ready" and "GA4 booted".
// GA4 (firebase.analytics()) is NEVER initialized until the user has either actively
// accepted, or is a returning visitor who previously accepted. Default = NO analytics,
// NO _ga cookies, NO gtag runtime. Honours navigator.doNotTrack / globalPrivacyControl.
//
// Load order: AFTER config.js (defines enableAnalytics / firebase) and state.js (defines
// sessionManager), BEFORE main.js. The actual decision + banner wiring runs on
// DOMContentLoaded so sessionManager.isDesktop (set by detectDevice in main.js) and the
// banner/modal DOM are both ready. All localStorage reads are try/catch-wrapped — a
// consent failure must never throw into gameplay.

const CONSENT_KEY = 'snake_consent'; // localStorage value: 'granted' | 'denied'

let consentWired = false; // guard so consentInit() registers its DOMContentLoaded work once

/**
 * Read the stored consent decision, resilient to a disabled / throwing localStorage.
 * @returns {('granted'|'denied'|null)} the stored decision, or null if none/unavailable.
 */
function getStoredConsent() {
    try {
        const v = localStorage.getItem(CONSENT_KEY);
        return v === 'granted' || v === 'denied' ? v : null;
    } catch (e) {
        return null;
    }
}

/**
 * Persist a consent decision. 'granted' boots analytics (idempotently); 'denied' keeps it off.
 * Always hides the banner. Wrapped so a storage failure never throws into the UI handler.
 * @param {('granted'|'denied')} decision
 */
function setConsent(decision) {
    try {
        localStorage.setItem(CONSENT_KEY, decision);
    } catch (e) {
        /* storage disabled (private mode / quota) — proceed with the in-memory decision */
    }
    hideConsentBanner();
    if (decision === 'granted' && typeof enableAnalytics === 'function') {
        enableAnalytics();
        // The ONLY new event. Fired right after the handle exists so it lands in GA4.
        // A "decline" produces no event because analytics never boots (correct + expected).
        if (typeof trackEvent === 'function') trackEvent('consent_update', { outcome: 'granted' });
    }
}

/**
 * Normalise the browser-level "do not track me" signals into a single boolean. These are
 * non-standard and vary by browser (Chrome removed the toggle; Safari/Firefox/GPC differ),
 * so read every known location defensively. Absence simply means "no signal".
 * @returns {boolean} true if Do-Not-Track or Global Privacy Control is asserted.
 */
function dntEnabled() {
    try {
        const nav = typeof navigator !== 'undefined' ? navigator : {};
        const dnt = nav.doNotTrack
            || (typeof window !== 'undefined' && window.doNotTrack)
            || nav.msDoNotTrack;
        if (dnt === '1' || dnt === 'yes' || dnt === true) return true;
        if (nav.globalPrivacyControl === true) return true;
    } catch (e) {
        /* no navigator (non-browser/test env) → treat as no signal */
    }
    return false;
}

function hideConsentBanner() {
    const banner = document.getElementById('consent-banner');
    if (banner) banner.classList.add('hidden');
}

function showConsentBanner() {
    const banner = document.getElementById('consent-banner');
    if (banner) banner.classList.remove('hidden');
}

// ---- Privacy policy modal (mirrors the leaderboard-modal pattern) ----

function openPrivacyModal() {
    const modal = document.getElementById('privacy-modal');
    if (modal) modal.classList.remove('hidden');
}

function closePrivacyModal() {
    const modal = document.getElementById('privacy-modal');
    if (modal) modal.classList.add('hidden');
}

/**
 * Resolve the consent decision at startup (the §5.2 decision table) and wire the banner +
 * privacy-modal controls. Idempotent: registers its DOMContentLoaded work only once, so the
 * config.js hook and the load-time self-call below can't double-wire. Never throws.
 */
function consentInit() {
    if (consentWired) return;
    consentWired = true;

    const run = () => {
        wirePrivacyModal();

        const stored = getStoredConsent();

        // 1) Browser-level signal wins when there's no explicit stored decision: decline,
        //    never boot analytics, never show the banner.
        if (!stored && dntEnabled()) return;

        // 2) Returning visitor who accepted → boot analytics now, no banner.
        if (stored === 'granted') {
            if (typeof enableAnalytics === 'function') enableAnalytics();
            return;
        }

        // 3) Returning visitor who declined → stay off, no banner.
        if (stored === 'denied') return;

        // 4) No stored decision, DNT off. Only the DESKTOP HOST sees the banner; the phone
        //    controller arrives via ?session= mid-join, so a banner there interrupts the flow.
        //    Phones inherit "declined until the host site is visited" — analytics stays no-op.
        const isDesktop = typeof sessionManager === 'undefined' || !sessionManager
            ? true
            : sessionManager.isDesktop !== false;
        if (!isDesktop) return;

        wireConsentBanner();
        showConsentBanner();
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', run);
    } else {
        run();
    }
}

function wireConsentBanner() {
    const accept = document.getElementById('consent-accept');
    const decline = document.getElementById('consent-decline');
    const learn = document.getElementById('consent-learn');
    if (accept) accept.addEventListener('click', () => setConsent('granted'));
    if (decline) decline.addEventListener('click', () => setConsent('denied'));
    if (learn) learn.addEventListener('click', openPrivacyModal);
}

function wirePrivacyModal() {
    const openBtn = document.getElementById('privacy-link');
    const closeBtn = document.getElementById('privacy-close');
    const modal = document.getElementById('privacy-modal');
    if (openBtn) openBtn.addEventListener('click', openPrivacyModal);
    if (closeBtn) closeBtn.addEventListener('click', closePrivacyModal);
    if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) closePrivacyModal(); });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) closePrivacyModal();
    });
}

// Self-initialise. config.js's initializeFirebase() also calls consentInit() (guarded), but
// that runs at config.js parse time — BEFORE this file loads — so it no-ops there. This call
// is the reliable entry point; consentInit() is idempotent, so a later config.js retry-path
// call is harmless.
consentInit();

// Expose pure helpers to Vitest (same pattern as utils.js / logic.js); a no-op in the browser.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        getStoredConsent,
        dntEnabled,
        CONSENT_KEY
    };
}
