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

// ==========================================
// GAME-LIFECYCLE ANALYTICS (M2 funnel completeness)
// ==========================================
// One shared param-builder so solo (game.js) and multiplayer (mp-engine.js) fire the SAME
// enriched game_start / game_over / round_completed shape — a single comparable funnel
// instead of two disjoint event namespaces. Reads engine state only; NEVER touches PII or
// the 6-digit code. All counters live on gameState (no new global), seeded by the engines at
// round start (resetRoundMetrics) so a missing field reads as 0.

/**
 * Snapshot the current round into low-cardinality GA4 params. Pure read of `gameState`
 * (the shared global) — bounded integers + a 2-value `mode` enum only. Safe before a round
 * starts (everything reads 0 / solo defaults). Used by BOTH engines so the events align.
 * @param {object} [state] - gameState override (tests); defaults to the global.
 * @returns {{mode:('solo'|'multi'), players:number, duration_s:number, food_eaten:number, max_combo:number}}
 */
function gameEventParams(state) {
    const gs = state || (typeof gameState !== 'undefined' ? gameState : {});
    const isMulti = gs && gs.mode === 'multi';
    const players = isMulti && Array.isArray(gs.players) ? gs.players.length : 1;
    const startedAt = gs && gs.roundStartedAt ? gs.roundStartedAt : 0;
    const duration_s = startedAt ? Math.max(0, Math.round((Date.now() - startedAt) / 1000)) : 0;
    return {
        mode: isMulti ? 'multi' : 'solo',
        players: players,
        duration_s: duration_s,
        food_eaten: (gs && gs.food_eaten) | 0,
        max_combo: (gs && gs.maxCombo) | 0
    };
}

/**
 * Seed the per-round metric counters on a freshly-started game state so the lifecycle
 * events (gameEventParams) have non-stale values. Called by startGame()/restartGame() (solo)
 * and startMultiplayerGame() (multi). Keeps the counters as plain gameState fields — no new
 * global, no state.js factory change.
 * @param {object} gs - the live gameState to seed.
 */
function resetRoundMetrics(gs) {
    if (!gs) return;
    gs.roundStartedAt = Date.now();
    gs.food_eaten = 0;
    gs.maxCombo = 0;
}

// ==========================================
// RETENTION / NORTH-STAR (player_tier user property + round counter)
// ==========================================
// The NSM = weekly rounds completed by paired hosts. We emit `round_completed` per finished
// round (game.js / mp-engine.js) and segment returning players with a `player_tier` GA4 user
// property. The tier is derived from a LOCAL round counter + distinct-day set in localStorage
// (same snake_* key + resilience convention as leaderboard.js) — NO device id, NO PII leaves
// the device; only the bounded `new|returning|engaged` bucket reaches GA4.

const ROUNDS_KEY = 'snake_rounds_played'; // { count:int, days:[YYYY-MM-DD…] } — local only
const ENGAGED_ROUNDS = 5;                 // ≥ this many rounds → 'engaged'
const MAX_TIER_DAYS = 14;                 // cap the distinct-day list so storage stays bounded

/**
 * Bucket a player into a bounded retention tier from their local history. Pure (testable):
 *   • new       — 0 prior rounds
 *   • returning — ≥1 prior round across ≥2 distinct days
 *   • engaged   — ≥ ENGAGED_ROUNDS rounds
 * @param {number} count - rounds completed (BEFORE this one).
 * @param {number} distinctDays - distinct calendar days the device has played.
 * @returns {('new'|'returning'|'engaged')}
 */
function derivePlayerTier(count, distinctDays) {
    if ((count | 0) >= ENGAGED_ROUNDS) return 'engaged';
    if ((count | 0) >= 1 && (distinctDays | 0) >= 2) return 'returning';
    return 'new';
}

/**
 * Read the local round-history record, resilient to a disabled / corrupted localStorage.
 * @returns {{count:number, days:string[]}}
 */
function readRoundHistory() {
    try {
        const rec = safeParse(localStorage.getItem(ROUNDS_KEY), {});
        const count = typeof rec.count === 'number' ? rec.count : 0;
        const days = Array.isArray(rec.days) ? rec.days.filter((d) => typeof d === 'string') : [];
        return { count: count, days: days };
    } catch (e) {
        return { count: 0, days: [] };
    }
}

/**
 * Record a completed round locally and refresh the `player_tier` GA4 user property. Increments
 * the local round counter, tracks the distinct play-day (bounded), and — only when analytics
 * actually exists (post-consent) — sets the bounded tier as a user property. NEVER sends the
 * count, the device id, or any PII; only the `new|returning|engaged` bucket. Never throws.
 */
function recordRoundAndTier() {
    try {
        const prev = readRoundHistory();
        // Tier reflects history BEFORE this round (a first-ever round = 'new').
        const tier = derivePlayerTier(prev.count, prev.days.length);

        const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD, no time → no fingerprint
        const days = prev.days.includes(today) ? prev.days : prev.days.concat(today);
        if (days.length > MAX_TIER_DAYS) days.splice(0, days.length - MAX_TIER_DAYS);
        try {
            localStorage.setItem(ROUNDS_KEY, JSON.stringify({ count: prev.count + 1, days: days }));
        } catch (e) { /* private mode / quota — in-memory tier still set below */ }

        // Set the user property only once the consent-gated handle exists (never pre-consent).
        if (typeof analytics !== 'undefined' && analytics && analytics.setUserProperties) {
            analytics.setUserProperties({ player_tier: tier });
        }
    } catch (e) {
        /* retention bookkeeping must never throw into gameplay */
    }
}

// Expose the pure helpers to Vitest (same pattern as logic.js); a no-op in the browser.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        safeParse,
        sanitizeName,
        reportError,
        gameEventParams,
        resetRoundMetrics,
        derivePlayerTier,
        ROUNDS_KEY
    };
}
