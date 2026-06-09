// ==========================================
// LOCAL LEADERBOARD / HIGH SCORES
// ==========================================
// Persists the top scores in localStorage (per-browser). Could later be promoted
// to a Firestore `scores` collection governed by the rules in firestore.rules.

const HIGH_SCORES_KEY = 'snake_highscores';
const MAX_HIGH_SCORES = 5;

/**
 * @returns {number[]} Stored high scores, highest first (may be empty).
 */
function getHighScores() {
    const scores = safeParse(localStorage.getItem(HIGH_SCORES_KEY), []);
    return Array.isArray(scores) ? scores.filter((n) => typeof n === 'number') : [];
}

/**
 * @returns {number} The current best score, or 0 if none recorded.
 */
function getHighScore() {
    const scores = getHighScores();
    return scores.length ? scores[0] : 0;
}

/**
 * Record a finished game's score into the local high-score table.
 * @param {number} score
 * @returns {boolean} True if this score is a new personal best.
 */
function recordScore(score) {
    if (typeof score !== 'number' || score <= 0) return false;

    const scores = getHighScores();
    const prevBest = scores.length ? scores[0] : 0;

    scores.push(score);
    scores.sort((a, b) => b - a);
    scores.splice(MAX_HIGH_SCORES);

    try {
        localStorage.setItem(HIGH_SCORES_KEY, JSON.stringify(scores));
    } catch (error) {
        console.warn('Could not persist high score.', error);
    }

    return score > prevBest;
}

/**
 * Refresh the desktop "Best" score display from storage.
 */
function updateHighScoreDisplay() {
    const el = document.getElementById('high-score');
    if (el) el.textContent = getHighScore().toString();
}

// ==========================================
// GLOBAL LEADERBOARD (Firestore)
// ==========================================
// Public board keyed by a stable per-device id, so each device is one row. Reads are
// public; writes are shape/score-validated in firestore.rules — which the owner must
// deploy (`firebase deploy --only firestore:rules`) before writes are accepted. Every
// call is guarded + try/caught so it can never throw into gameplay.

const LB_COLLECTION = 'leaderboard';
const PLAYER_ID_KEY = 'snake_player_id';
const PLAYER_NAME_KEY = 'snake_player_name';
const LB_BEST_KEY = 'snake_lb_best'; // highest score already submitted (skip redundant writes)
const LB_SCORE_CEILING = 100000;

/** Stable per-device id, generated once and persisted. */
function getPlayerId() {
    let id = localStorage.getItem(PLAYER_ID_KEY);
    if (id) return id;
    id = (window.crypto && crypto.randomUUID)
        ? crypto.randomUUID()
        : 'p-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    try { localStorage.setItem(PLAYER_ID_KEY, id); } catch (e) { /* private mode */ }
    return id;
}

/** @returns {string} The saved handle, or '' if none. */
function getPlayerName() {
    return localStorage.getItem(PLAYER_NAME_KEY) || '';
}

/**
 * Persist a sanitized handle.
 * @param {string} name
 * @returns {string} The stored value, or '' if the input was rejected.
 */
function setPlayerName(name) {
    const clean = sanitizeName(name);
    if (!clean) return '';
    try { localStorage.setItem(PLAYER_NAME_KEY, clean); } catch (e) { /* ignore */ }
    return clean;
}

/**
 * Upsert this device's row when `score` beats our last submission. Resolves to the
 * player's global rank (number) or null on any failure/no-op. Never throws.
 * @param {number} score
 * @returns {Promise<number|null>}
 */
async function submitGlobalScore(score) {
    try {
        if (typeof firestore === 'undefined' || !firebaseReady || !firestore) return null;
        const name = getPlayerName();
        if (typeof score !== 'number' || score <= 0 || score > LB_SCORE_CEILING || !name) return null;

        const prevBest = Number(localStorage.getItem(LB_BEST_KEY)) || 0;
        if (score <= prevBest) return await getPlayerRank(score); // already submitted higher/equal

        await firestore.collection(LB_COLLECTION).doc(getPlayerId()).set({
            name: name,
            score: score,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        try { localStorage.setItem(LB_BEST_KEY, String(score)); } catch (e) { /* ignore */ }
        return await getPlayerRank(score);
    } catch (error) {
        console.warn('submitGlobalScore failed (are the leaderboard rules deployed?):', error);
        return null;
    }
}

/**
 * Top-N rows, highest first.
 * @param {number} [n=10]
 * @returns {Promise<Array<{id:string, name:string, score:number}>>} [] on failure.
 */
async function fetchTopScores(n = 10) {
    try {
        if (typeof firestore === 'undefined' || !firebaseReady || !firestore) return [];
        const snap = await firestore.collection(LB_COLLECTION)
            .orderBy('score', 'desc').limit(n).get();
        return snap.docs.map((d) => {
            const data = d.data() || {};
            return { id: d.id, name: data.name || '—', score: Number(data.score) || 0 };
        });
    } catch (error) {
        console.warn('fetchTopScores failed:', error);
        return [];
    }
}

/**
 * Global rank for a score = (rows strictly above it) + 1. One read; reuses the single
 * `score` index.
 * @param {number} score
 * @returns {Promise<number|null>}
 */
async function getPlayerRank(score) {
    try {
        if (typeof firestore === 'undefined' || !firebaseReady || !firestore) return null;
        const snap = await firestore.collection(LB_COLLECTION)
            .where('score', '>', score).get();
        return snap.size + 1;
    } catch (error) {
        console.warn('getPlayerRank failed:', error);
        return null;
    }
}
