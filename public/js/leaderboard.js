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
