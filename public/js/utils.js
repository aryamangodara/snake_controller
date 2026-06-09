// ==========================================
// SHARED UTILITIES
// ==========================================
// Loaded first in index.html so every later script can use these helpers.

/**
 * Safely parse a JSON string, returning a fallback instead of throwing on
 * malformed input. Used for localStorage payloads, which can be absent or
 * corrupted (e.g. tampered-with or partially written).
 * @param {string|null|undefined} str - The JSON string to parse.
 * @param {*} [fallback={}] - Value returned when input is empty or invalid.
 * @returns {*} The parsed value, or the fallback.
 */
function safeParse(str, fallback = {}) {
    if (!str) return fallback;
    try {
        return JSON.parse(str);
    } catch (error) {
        console.warn('safeParse: ignoring malformed JSON, using fallback.', error);
        return fallback;
    }
}

/**
 * Fire a Google Analytics (GA4) event. Hardened so analytics can NEVER break gameplay: it
 * no-ops when the analytics handle is absent (Firebase init failed, offline/localStorage
 * fallback, or an ad-blocker) and swallows any error. Every event is auto-tagged with the
 * device role so desktop hosts and phone controllers stay segmentable. Never pass PII or the
 * 6-digit session code — keep params low-cardinality (numbers / bounded enums).
 * @param {string} name - GA4 event name.
 * @param {object} [params={}] - Event parameters.
 */
function trackEvent(name, params = {}) {
    try {
        if (typeof analytics === 'undefined' || !analytics) return;
        const role = (typeof sessionManager !== 'undefined' && sessionManager
            && sessionManager.isDesktop === false) ? 'phone_controller' : 'desktop_host';
        analytics.logEvent(name, { device_role: role, ...params });
    } catch (error) {
        /* analytics must never throw into gameplay */
    }
}
