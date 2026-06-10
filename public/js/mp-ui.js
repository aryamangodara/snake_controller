// ==========================================
// MULTIPLAYER UI — lobby, scoreboard, end screen, phone identity
// ==========================================
// All multiplayer presentation, desktop + phone. Every element is generated
// from PLAYER_SLOTS, so raising gameConfig.maxPlayers needs zero markup edits.
// Solo never adds the .mp classes, so the classic UI renders byte-identically.
// Loaded after share.js (uses showToast / setMpShareContext).

let mpUiLastRosterKeys = '';
let mpUiLastResultsAt = 0;

/** aria-live announcer for screen readers (joins/leaves/round events). */
function mpAnnounce(text) {
    const el = document.getElementById('mp-announcer');
    if (el) el.textContent = text;
}

/** Engine hook: a round just started — flip the desktop into arena presentation. */
function renderMpRoundStart() {
    const scoreCard = document.querySelector('.score-card');
    if (scoreCard) scoreCard.classList.add('mp');
    const gameOver = document.getElementById('game-over');
    if (gameOver) gameOver.classList.remove('mp');
    updateMpScoreboard();
    mpAnnounce('Round started with ' + gameState.players.length + ' players');
}

/** Desktop lobby roster inside the connection card (called on every doc snapshot). */
function renderMpLobby() {
    const roster = mpSession.roster || {};
    const joined = PLAYER_SLOTS.filter((s) => roster[s]);

    let box = document.getElementById('mp-roster');
    if (!box) return;
    box.classList.toggle('hidden', joined.length === 0);

    const count = document.getElementById('mp-roster-count');
    if (count) count.textContent = joined.length + '/' + gameConfig.maxPlayers;

    const list = document.getElementById('mp-roster-list');
    if (list) {
        list.innerHTML = '';
        for (const slot of PLAYER_SLOTS) {
            const entry = roster[slot];
            const li = document.createElement('li');
            li.className = 'mp-chip' + (entry ? ' mp-chip--joined' : ' mp-chip--ghost');
            li.style.setProperty('--slot-color', PLAYER_COLORS[slot].body);
            li.style.setProperty('--slot-rgb', PLAYER_COLORS[slot].rgb);
            const dot = document.createElement('span');
            dot.className = 'mp-chip-dot';
            dot.setAttribute('aria-hidden', 'true');
            const num = document.createElement('span');
            num.className = 'mp-chip-slot';
            num.textContent = slot.toUpperCase();
            const name = document.createElement('span');
            name.className = 'mp-chip-name';
            name.textContent = entry ? entry.name : 'waiting…';
            li.append(dot, num, name);
            if (entry) {
                const tick = document.createElement('span');
                tick.className = 'mp-chip-ready';
                tick.textContent = entry.connected === false ? '⌛' : '✓';
                li.append(tick);
            }
            list.appendChild(li);
        }
    }

    const hint = document.getElementById('mp-start-hint');
    if (hint) hint.classList.toggle('hidden', joined.length < 1);

    // Headline/subhead phases + announce roster changes.
    const headline = document.querySelector('.qr-headline');
    const subhead = document.querySelector('.qr-subhead');
    const card = document.querySelector('.connection-card');
    const full = joined.length >= gameConfig.maxPlayers;
    if (headline) {
        headline.textContent = full ? '🎮 Lobby Full' : (joined.length > 0 ? '📱 Scan to Join!' : '📱 Scan to Play');
    }
    if (subhead) {
        if (gameState.currentState === GameState.PLAYING) subhead.textContent = "Scan now — you'll join the next round";
        else if (full) subhead.textContent = joined.length + '/' + gameConfig.maxPlayers + ' — press ▶ on any phone!';
        else if (joined.length > 0) subhead.textContent = 'Up to ' + gameConfig.maxPlayers + ' snakes, one board';
        else subhead.textContent = 'Point your phone camera here';
    }
    if (card) card.classList.toggle('mp-full', full);

    const keys = joined.map((s) => s + ':' + roster[s].name).join('|');
    if (keys !== mpUiLastRosterKeys && joined.length > 0) {
        mpAnnounce('Players: ' + joined.map((s) => roster[s].name).join(', '));
        if (typeof showToast === 'function' && sessionManager.isDesktop && mpUiLastRosterKeys !== '') {
            showToast('Lobby: ' + joined.length + '/' + gameConfig.maxPlayers + ' players');
        }
        mpUiLastRosterKeys = keys;
    }
}

/** Phase-aware canvas waiting-overlay lines (game.js renders them; null = solo default). */
function getLobbyOverlayLines() {
    if (!mpSession.enabled) return null;
    const joined = PLAYER_SLOTS.filter((s) => mpSession.roster[s]);
    if (joined.length === 0) return null; // classic solo prompt
    if (joined.length === 1) {
        const name = (mpSession.roster[joined[0]].name || 'Player 1').slice(0, 14);
        return [name + ' is ready 🐍', 'Press ▶ to play — or scan to add snakes'];
    }
    return ['⚔️ ' + joined.length + ' snakes ready — last one standing wins!',
            'Press ▶ on any phone to start'];
}

/** Engine/eat hook: per-player rows in the (350px) score card. */
function updateMpScoreboard() {
    const list = document.getElementById('mp-scoreboard');
    if (!list || gameState.mode !== 'multi') return;
    const aliveScores = gameState.players.filter((p) => p.alive).map((p) => p.score);
    const top = aliveScores.length ? Math.max(...aliveScores) : -1;
    const leaders = aliveScores.filter((s) => s === top).length;
    list.innerHTML = '';
    for (const p of gameState.players) {
        const li = document.createElement('li');
        li.className = 'mp-score-row' + (p.alive ? '' : ' mp-score-row--dead');
        li.style.setProperty('--slot-color', p.colors.body);
        li.style.setProperty('--slot-rgb', p.colors.rgb);
        const dot = document.createElement('span');
        dot.className = 'mp-row-dot';
        dot.setAttribute('aria-hidden', 'true');
        dot.innerHTML = '<span class="mp-row-slot">' + p.slot.slice(1) + '</span>';
        const name = document.createElement('span');
        name.className = 'mp-row-name';
        name.textContent = p.name;
        const status = document.createElement('span');
        status.className = 'mp-row-status';
        if (!p.alive) { status.textContent = '💀'; status.setAttribute('role', 'img'); status.setAttribute('aria-label', 'eliminated'); }
        else if (p.score === top && top > 0 && leaders === 1) { status.textContent = '👑'; status.setAttribute('role', 'img'); status.setAttribute('aria-label', 'leading'); }
        const score = document.createElement('span');
        score.className = 'mp-row-score';
        score.textContent = p.score;
        li.append(dot, name, status, score);
        list.appendChild(li);
    }
}

/** Engine hook: the desktop end screen — winner banner + final standings. */
function renderMpEndScreen(results) {
    const overlay = document.getElementById('game-over');
    const content = document.getElementById('mp-game-over-content');
    if (!overlay || !content) return;
    overlay.classList.add('mp');

    const winner = results.winnerSlot
        ? results.players.find((p) => p.slot === results.winnerSlot) : null;
    const title = document.getElementById('mp-winner-title');
    if (title) {
        title.textContent = winner ? '🏆 ' + winner.name + ' wins!'
            : (results.players.length === 1 ? 'Game Over!' : '🤝 It’s a draw!');
        if (winner) title.style.color = PLAYER_COLORS[winner.slot].head;
    }

    const standings = document.getElementById('mp-standings');
    if (standings) {
        standings.innerHTML = '';
        const ordered = results.players.slice().sort((a, b) => {
            if (!a.death && b.death) return -1;
            if (a.death && !b.death) return 1;
            if (a.death && b.death) return b.death.at - a.death.at; // later death = higher place
            return b.score - a.score;
        });
        const places = ['1st', '2nd', '3rd', '4th', '5th', '6th'];
        ordered.forEach((p, i) => {
            const li = document.createElement('li');
            li.className = 'mp-standing-row';
            li.style.setProperty('--slot-color', PLAYER_COLORS[p.slot].body);
            li.style.setProperty('--slot-rgb', PLAYER_COLORS[p.slot].rgb);
            const place = document.createElement('span');
            place.className = 'mp-standing-place';
            place.textContent = places[i] || (i + 1) + 'th';
            const dot = document.createElement('span');
            dot.className = 'mp-row-dot';
            dot.setAttribute('aria-hidden', 'true');
            dot.innerHTML = '<span class="mp-row-slot">' + p.slot.slice(1) + '</span>';
            const who = document.createElement('span');
            who.className = 'mp-standing-who';
            const nm = document.createElement('span');
            nm.className = 'mp-row-name';
            nm.textContent = p.name;
            const fate = document.createElement('span');
            fate.className = 'mp-standing-cause';
            fate.textContent = mpFateText(p, results);
            who.append(nm, fate);
            const score = document.createElement('span');
            score.className = 'mp-row-score';
            score.textContent = p.score;
            li.append(place, dot, who, score);
            standings.appendChild(li);
        });
    }

    setTimeout(() => overlay.classList.remove('hidden'), 150); // same hitstop beat as solo
    mpAnnounce(title ? title.textContent : 'Round over');
}

/** Human fate line for one player's standing row. */
function mpFateText(p, results) {
    if (!p.death) return 'Survivor 👑';
    if (p.death.cause === 'bite') {
        const killer = results.players.find((q) => q.slot === p.death.by);
        return '⚔️ Defeated by ' + (killer ? killer.name : 'a rival');
    }
    return p.death.cause === 'wall' ? '💥 Hit the wall' : '💥 Bit themselves';
}

// ---------- Phone-side presentation ----------

/** Tint the controller chrome with the player's color + show the identity banner. */
function mpUiPhoneJoined(slot) {
    const iface = document.getElementById('controller-interface');
    if (iface) {
        iface.classList.add('mp');
        iface.classList.remove('mp-queued');
        iface.style.setProperty('--player-color', PLAYER_COLORS[slot].body);
        iface.style.setProperty('--player-color-rgb', PLAYER_COLORS[slot].rgb);
    }
    const banner = document.getElementById('mp-player-banner');
    if (banner) banner.classList.remove('hidden');
}

/** Queued behind a live round: dim the joystick, explain why. */
function mpUiPhoneQueued() {
    const iface = document.getElementById('controller-interface');
    if (iface) iface.classList.add('mp-queued');
    showConnectionStatus("Round in progress — you'll join the next one ⏳");
}

/** Refresh the banner/hint from the latest doc snapshot. */
function mpUiPhoneUpdate(d, mySlot) {
    const me = d.players[mySlot];
    const nameEl = document.getElementById('mp-banner-name');
    if (nameEl) nameEl.textContent = 'Player ' + mySlot.slice(1) + ' — ' + (me.name || '');
    const st = d.gameState && d.gameState.state;
    const hint = document.getElementById('mp-center-hint');
    const joinedCount = PLAYER_SLOTS.filter((s) => d.players[s]).length;
    if (hint) {
        hint.classList.toggle('hidden', st === GameState.PLAYING);
        hint.textContent = st === GameState.GAME_OVER
            ? 'Press ↻ to play again — any player can'
            : (joinedCount > 1 ? 'Press ▶ to start — any player can' : 'Press ▶ to start');
    }
    const edit = document.getElementById('mp-edit-name');
    if (edit) edit.classList.toggle('hidden', st === GameState.PLAYING);
}

/**
 * The phone's round-over cards. Arena rounds render the winner / defeat card
 * from results; 1-player rounds fall back to the classic solo card.
 */
function updateMobileGameOverMp(d, mySlot) {
    const st = d.gameState && d.gameState.state;
    const card = document.getElementById('mobile-game-over');
    if (!card) return;

    if (st !== GameState.GAME_OVER) {
        card.classList.add('hidden');
        lastSyncedState = st;
        return;
    }

    if (!d.results || !d.results.players || d.results.players.length <= 1) {
        // 1-player round (or legacy data): the classic solo card + loss flash.
        updateMobileGameOver(d.gameState);
        return;
    }

    const r = d.results;
    const me = r.players.find((p) => p.slot === mySlot);
    const iWon = r.winnerSlot === mySlot;
    const title = card.querySelector('.mobile-go-title');
    const subtitle = document.getElementById('mobile-go-subtitle');
    const scoreEl = document.getElementById('mobile-final-score');
    const waitNote = document.getElementById('mp-wait-note');
    const playAgain = document.getElementById('play-again-btn');

    if (scoreEl) scoreEl.textContent = me ? String(me.score) : '0';
    if (title) title.textContent = iWon ? '🏆 You won!' : (me && me.death ? '💀 Eliminated!' : 'Game Over!');
    if (subtitle) {
        let sub = '';
        if (iWon) sub = r.defeated.length ? 'You defeated ' + r.defeated.join(' & ') + '!' : 'Last snake standing!';
        else if (me && me.death && me.death.cause === 'bite') {
            const killer = r.players.find((p) => p.slot === me.death.by);
            sub = 'Defeated by ' + (killer ? killer.name : 'a rival');
        } else if (me && me.death) sub = me.death.cause === 'wall' ? 'You hit the wall' : 'You bit yourself';
        subtitle.textContent = sub;
        subtitle.classList.toggle('hidden', !sub);
    }
    if (waitNote) waitNote.classList.add('hidden'); // round IS over
    if (playAgain) playAgain.classList.remove('hidden');

    if (typeof setMpShareContext === 'function') {
        setMpShareContext(iWon
            ? { outcome: 'winner', defeated: r.defeated, score: me ? me.score : 0 }
            : { outcome: 'eliminated',
                by: (me && me.death && me.death.cause === 'bite')
                    ? ((r.players.find((p) => p.slot === me.death.by) || {}).name || null) : null,
                score: me ? me.score : 0 });
    }

    card.classList.remove('hidden');
    if (iWon && r.endedAt !== mpUiLastResultsAt) {
        triggerHaptic([60, 40, 60, 40, 160]); // celebratory, distinct from the loss buzz
        const content = card.querySelector('.mobile-game-over-content');
        if (content) {
            content.classList.remove('win-flash');
            void content.offsetWidth;
            content.classList.add('win-flash');
        }
        trackEvent('mp_round_result', { outcome: 'win' });
    }
    mpUiLastResultsAt = r.endedAt || 0;
    lastSyncedState = st;
}

// Phone: pre-round name editing (✏️ in the banner). Persists to the shared
// leaderboard handle and writes straight into our roster entry.
document.addEventListener('DOMContentLoaded', () => {
    const edit = document.getElementById('mp-edit-name');
    if (!edit) return;
    edit.addEventListener('click', () => {
        const current = (typeof getPlayerName === 'function' && getPlayerName()) || '';
        const raw = prompt('Your player name (1–16 chars):', current);
        if (raw === null) return;
        const clean = typeof setPlayerName === 'function' ? setPlayerName(raw) : '';
        if (!clean) { showToast('That name didn’t work — try another.'); return; }
        if (mpClient.slot && mpClient.sessionDocRef) {
            mpClient.sessionDocRef.update({
                ['players.' + mpClient.slot + '.name']: clean,
                lastActivity: firebase.firestore.FieldValue.serverTimestamp()
            }).catch(() => {});
        }
        showToast('You are ' + clean);
    });
});
