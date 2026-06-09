// ==========================================
// LEADERBOARD MODAL (desktop host UI)
// ==========================================
// Opens the global Top-N board. Degrades to an "unavailable" state when Firebase is down
// or the rules aren't deployed yet. Handles are rendered with textContent (XSS-safe).

function openLeaderboard() {
    const modal = document.getElementById('leaderboard-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    trackEvent('leaderboard_view');
    renderLeaderboard();
}

function closeLeaderboard() {
    const modal = document.getElementById('leaderboard-modal');
    if (modal) modal.classList.add('hidden');
}

function lbToggle(id, on) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('hidden', !on);
}

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

    const rows = await fetchTopScores(10);
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
        if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) closeLeaderboard();
    });
});
