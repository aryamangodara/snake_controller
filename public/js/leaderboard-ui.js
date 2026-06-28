// ==========================================
// LEADERBOARD MODAL (desktop host UI)
// ==========================================
// Opens the global Top-N board. Degrades to an "unavailable" state when Firebase is down
// or the rules aren't deployed yet. Handles are rendered with textContent (XSS-safe).

// The element that had focus before the modal opened, so we can restore it on close.
let lbLastFocus = null;

// Standard focusable-element selector for the in-panel Tab trap.
const LB_FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Tab trap for the open leaderboard panel: keeps focus inside .leaderboard-panel.
 * Handles the single-focusable edge case (only #lb-close present) by holding focus
 * on that one element. No-ops if the panel has no focusables.
 */
function lbFocusTrap(e) {
    const panel = document.querySelector('#leaderboard-modal .leaderboard-panel');
    if (!panel) return;
    const focusable = Array.from(panel.querySelectorAll(LB_FOCUSABLE))
        .filter((el) => !el.disabled && el.offsetParent !== null);
    if (focusable.length === 0) { e.preventDefault(); return; }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (focusable.length === 1) { e.preventDefault(); first.focus(); return; }
    if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
    }
}

function openLeaderboard() {
    const modal = document.getElementById('leaderboard-modal');
    if (!modal) return;
    lbLastFocus = document.activeElement; // remember the opener (e.g. #leaderboard-btn)
    modal.classList.remove('hidden');
    trackEvent('leaderboard_view');
    renderLeaderboard();
    // Move focus into the panel; #lb-close is always present and has a focus-visible style.
    document.getElementById('lb-close')?.focus();
}

function closeLeaderboard() {
    const modal = document.getElementById('leaderboard-modal');
    if (modal) modal.classList.add('hidden');
    // Restore focus to the opener, guarding never-opened (null) and removed-from-DOM cases.
    if (lbLastFocus && document.contains(lbLastFocus)) lbLastFocus.focus();
    lbLastFocus = null;
}

function lbToggle(id, on) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('hidden', !on);
}

// Short-lived cache so rapid re-opens of the modal don't re-hit Firestore each time.
const LB_CACHE_MS = 30000;
let lbCacheRows = null;
let lbCacheAt = 0;

async function renderLeaderboard() {
    lbToggle('lb-loading', true);
    lbToggle('lb-list', false);
    lbToggle('lb-empty', false);
    lbToggle('lb-error', false);

    // Offline / Firebase down / rules not deployed → show "unavailable", never throw.
    if (typeof firestore === 'undefined' || !firebaseReady || !firestore) {
        lbToggle('lb-loading', false);
        lbToggle('lb-error', true);
        return;
    }

    let rows;
    if (lbCacheRows && Date.now() - lbCacheAt < LB_CACHE_MS) {
        rows = lbCacheRows;
    } else {
        rows = await fetchTopScores(10);
        if (rows.length) { lbCacheRows = rows; lbCacheAt = Date.now(); }
    }
    lbToggle('lb-loading', false);
    if (!rows.length) { lbToggle('lb-empty', true); return; }

    const me = (typeof getPlayerId === 'function') ? getPlayerId() : null;
    const list = document.getElementById('lb-list');
    if (!list) return;
    list.innerHTML = '';
    rows.forEach((row, i) => {
        const li = document.createElement('li');
        li.className = 'lb-row' + (row.id === me ? ' lb-me' : '');
        const rank = document.createElement('span');
        rank.className = 'lb-rank';
        rank.textContent = '#' + (i + 1);
        const name = document.createElement('span');
        name.className = 'lb-name';
        name.textContent = row.name;
        const score = document.createElement('span');
        score.className = 'lb-score';
        score.textContent = row.score;
        li.append(rank, name, score);
        list.appendChild(li);
    });
    lbToggle('lb-list', true);
}

document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('leaderboard-btn');
    const closeBtn = document.getElementById('lb-close');
    const modal = document.getElementById('leaderboard-modal');
    if (btn) btn.addEventListener('click', openLeaderboard);
    if (closeBtn) closeBtn.addEventListener('click', closeLeaderboard);
    if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) closeLeaderboard(); });
    document.addEventListener('keydown', (e) => {
        if (!modal || modal.classList.contains('hidden')) return;
        if (e.key === 'Escape') closeLeaderboard();
        else if (e.key === 'Tab') lbFocusTrap(e);
    });
});
