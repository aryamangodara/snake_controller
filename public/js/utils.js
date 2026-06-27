// ==========================================
// SHARED UTILITIES
// ==========================================
// Loaded first in index.html so every later script can use these helpers.

// Flip to true for verbose development logging. Warnings and errors always log.
const DEBUG = false;

/**
 * Development-only console.log — a no-op in production so gameplay-path logging
 * (some of it per-frame) doesn't spam or slow the console. console.warn/error
 * are NOT gated; real problems must stay visible.
 * @param {...*} args - Forwarded to console.log when DEBUG is true.
 */
function debugLog(...args) {
    if (DEBUG) console.log(...args);
}

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

/**
 * Report an uncaught error to GA4 as a low-cardinality signal. NEVER logs the raw
 * message (cardinality + PII risk) — only a bounded `reason` enum, a clamped error
 * NAME (the JS constructor name, e.g. TypeError), and caller-supplied numeric/enum
 * extras. Reuses trackEvent (no-ops when analytics/consent is absent, never throws)
 * and additionally console.errors so the raw error stays visible in DevTools — we
 * report + recover, we never swallow-and-hide.
 *
 * Cardinality discipline: `reason` is a fixed ~5-value enum; `error_name` is clamped
 * to 40 chars; callers pass only numbers / bounded enums in `extra`. Never pass
 * err.message, err.stack, a URL, or the 6-digit session code — those are unbounded
 * and can carry PII.
 * @param {string} reason - bounded enum: 'window_error' | 'unhandled_rejection' |
 *                          'raf_loop' | 'rtdb_listener' | 'firestore_listener'
 * @param {*} err - the thrown value (Error or otherwise).
 * @param {object} [extra] - additional low-cardinality params (numbers / bounded enums only).
 */
function reportError(reason, err, extra = {}) {
    try {
        const name = (err && err.name ? String(err.name) : 'Error').slice(0, 40);
        trackEvent('js_error', { reason, error_name: name, ...extra });
        if (typeof console !== 'undefined' && console.error) {
            console.error('[js_error]', reason, err);
        }
    } catch (_e) {
        /* reporting must NEVER throw — it sits on the error path */
    }
}

/**
 * Normalize a leaderboard handle: collapse any whitespace (tabs/newlines → single space),
 * trim, and clamp to 16 chars. Returns null if nothing valid remains. UX-only — the
 * firestore.rules re-validate length on the server, and the board renders names with
 * textContent (so no markup can be injected).
 * @param {string} raw
 * @returns {string|null}
 */
function sanitizeName(raw) {
    if (typeof raw !== 'string') return null;
    const clean = raw.replace(/\s+/g, ' ').trim();
    if (clean.length < 1) return null;
    return clean.slice(0, 16);
}

// Expose the pure helpers to Vitest (same pattern as logic.js); a no-op in the browser.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        safeParse,
        sanitizeName,
        reportError
    };
}
