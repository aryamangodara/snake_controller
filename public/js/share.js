// ==========================================
// SHARE-SCORE CARD — game-over social sharing
// ==========================================
// Wires the game-over card's share buttons (WhatsApp / X / Facebook / Instagram)
// and the "Play Again" button. Text + link sharing via each network's web intent;
// Instagram (which has no web text-share) uses the native share sheet when present,
// otherwise copies the caption and opens instagram.com. The score is read live from
// gameState at click time. Loaded after game.js (needs restartGame) and
// leaderboard.js (getHighScore); kept separate so game.js stays small.

/** Base game URL to share (no session param). */
function shareUrl() {
    return `${location.origin}${location.pathname}`;
}

/** Caption for the score. (No high-score flair: the phone's localStorage differs from the host's.) */
function buildShareText(score) {
    return `I scored ${score} on Snake 🐍🔥 — can you beat me?`;
}

/** Small transient toast for share feedback (e.g. the Instagram copy fallback). */
function showToast(message) {
    let toast = document.getElementById('share-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'share-toast';
        toast.className = 'toast';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('toast--visible');
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => toast.classList.remove('toast--visible'), 2600);
}

/** Open a popup window for a web share intent. */
function openShareWindow(url) {
    window.open(url, '_blank', 'noopener,noreferrer,width=600,height=520');
}

/** Instagram has no web text-share: use the native sheet, else copy caption + open IG. */
function shareToInstagram(text, url) {
    if (navigator.share) {
        navigator.share({ text, url }).catch(() => {});
        return;
    }
    const caption = `${text} ${url}`;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(caption)
            .then(() => showToast('Caption copied — paste it into your Instagram story!'))
            .catch(() => showToast('Copy your score to share on Instagram'));
    } else {
        showToast('Copy your score to share on Instagram');
    }
    window.open('https://www.instagram.com/', '_blank', 'noopener,noreferrer');
}

/** Route a share button to its network's web intent. */
function openShare(network) {
    const score = (typeof gameState !== 'undefined' && gameState) ? gameState.score : 0;
    trackEvent('share', { method: network, content_type: 'score' });
    const text = buildShareText(score);
    const url = shareUrl();
    const t = encodeURIComponent(text);
    const u = encodeURIComponent(url);

    switch (network) {
        case 'whatsapp':
            openShareWindow(`https://wa.me/?text=${encodeURIComponent(text + ' ' + url)}`);
            break;
        case 'x':
            openShareWindow(`https://twitter.com/intent/tweet?text=${t}&url=${u}`);
            break;
        case 'facebook':
            // Facebook's sharer only shares the link; it ignores prefilled text.
            openShareWindow(`https://www.facebook.com/sharer/sharer.php?u=${u}`);
            break;
        case 'instagram':
            shareToInstagram(text, url);
            break;
    }
}

/** Attach handlers for the game-over card's share + Play Again buttons (call once). */
function wireGameOverCard() {
    document.querySelectorAll('[data-share]').forEach((btn) => {
        btn.addEventListener('click', () => openShare(btn.getAttribute('data-share')));
    });
    const playAgain = document.getElementById('play-again-btn');
    if (!playAgain) return;
    playAgain.addEventListener('click', () => {
        // On the phone, ask the desktop host to restart; on the desktop, restart directly.
        const onPhone = (typeof sessionManager !== 'undefined' && sessionManager && sessionManager.isDesktop === false);
        if (onPhone && typeof sendGameAction === 'function') {
            sendGameAction('restart');
        } else if (typeof restartGame === 'function') {
            restartGame();
        }
    });
}

// Expose for Node/Vitest only (no-op in the browser classic-script context).
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { shareUrl, buildShareText, openShare, wireGameOverCard };
}
