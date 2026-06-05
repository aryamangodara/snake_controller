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
