// ==========================================
// SOUND EFFECTS (Web Audio)
// ==========================================
// Tiny synthesized blips — no asset files. Respects a persisted mute toggle.
// Browsers require a user gesture before audio can play, so the AudioContext is
// created/resumed lazily on the first sound (typically right after the player
// presses Space / clicks, which counts as a gesture).

let audioCtx = null;
let soundMuted = safeParse(localStorage.getItem('snake_muted'), false) === true;

function getAudioContext() {
    if (!audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) audioCtx = new AC();
    }
    return audioCtx;
}

/**
 * Play a short tone.
 * @param {number} freq - Frequency in Hz.
 * @param {number} durationMs - Length in milliseconds.
 * @param {OscillatorType} [type='sine']
 * @param {number} [gainValue=0.08] - Peak gain (0-1).
 */
function playTone(freq, durationMs, type = 'sine', gainValue = 0.08) {
    if (soundMuted) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = gainValue;
    osc.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;
    osc.start(now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);
    osc.stop(now + durationMs / 1000);
}

function playFoodSound() {
    playTone(660, 90, 'square', 0.06);
}

function playCrashSound() {
    playTone(140, 350, 'sawtooth', 0.12);
}

function playStartSound() {
    playTone(520, 120, 'triangle', 0.08);
}

/**
 * Toggle mute, persist it, and refresh the button label.
 * @returns {boolean} The new muted state.
 */
function toggleMute() {
    soundMuted = !soundMuted;
    try {
        localStorage.setItem('snake_muted', JSON.stringify(soundMuted));
    } catch (error) {
        console.warn('Could not persist mute preference.', error);
    }
    updateMuteButton();
    return soundMuted;
}

function updateMuteButton() {
    const btn = document.getElementById('mute-btn');
    if (!btn) return;
    const icon = btn.querySelector('i');
    if (icon) {
        icon.className = soundMuted ? 'fas fa-volume-xmark' : 'fas fa-volume-high';
    }
    btn.setAttribute('aria-label', soundMuted ? 'Unmute sound' : 'Mute sound');
}
