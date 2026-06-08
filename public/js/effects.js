// ==========================================
// VISUAL EFFECTS — particles, ripples, score pops, screen shake
// ==========================================
// A lightweight "juice" layer drawn on top of the game each frame. All motion is
// integrated analytically from a timestamp (Date.now()) so it is frame-rate
// independent — it looks the same at 60 / 120 / 144Hz, matching the game loop. No
// asset files; everything is canvas primitives. Loaded before game.js, which calls
// these helpers from moveSnake()/gameOver()/renderGame().

const effects = {
    particles: [],
    ripples: [],
    scorePops: [],
    shake: { until: 0, magnitude: 0, duration: 1 }
};

/**
 * Burst of particles flying outward from (x, y) plus an expanding ring — e.g. when
 * food is eaten or the snake crashes.
 * @param {number} x
 * @param {number} y
 * @param {string} color
 */
function spawnFoodBurst(x, y, color) {
    const now = Date.now();
    const count = 10;
    for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
        const speed = 0.06 + Math.random() * 0.10; // px per ms
        effects.particles.push({
            x, y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            born: now,
            ttl: 360 + Math.random() * 160,
            size: 2 + Math.random() * 2.5,
            color: color || '#ffcf4d'
        });
    }
    effects.ripples.push({ x, y, born: now, ttl: 380, maxR: 34, color: color || '#ffcf4d' });
}

/**
 * Floating text that rises and fades — e.g. "+20 x2" score gain.
 * @param {number} x
 * @param {number} y
 * @param {string} text
 * @param {string} color
 */
function spawnScorePop(x, y, text, color) {
    effects.scorePops.push({ x, y, text, born: Date.now(), ttl: 700, color: color || '#ffffff' });
}

/**
 * Kick off a screen shake.
 * @param {number} magnitude - peak offset in px.
 * @param {number} durationMs
 */
function triggerShake(magnitude, durationMs) {
    effects.shake = { until: Date.now() + durationMs, magnitude, duration: durationMs };
}

/**
 * Current shake translation for this frame (decays linearly to zero), or {x:0,y:0}.
 * @returns {{x:number, y:number}}
 */
function getShakeOffset() {
    const remaining = effects.shake.until - Date.now();
    if (remaining <= 0) return { x: 0, y: 0 };
    const intensity = (remaining / effects.shake.duration) * effects.shake.magnitude;
    return {
        x: (Math.random() * 2 - 1) * intensity,
        y: (Math.random() * 2 - 1) * intensity
    };
}

/**
 * Advance and draw all active effects. Call once per frame inside renderGame, in the
 * same logical coordinate space as the game. Expired effects are pruned in place.
 * @param {CanvasRenderingContext2D} ctx
 */
function updateAndDrawEffects(ctx) {
    const now = Date.now();

    // Ripples (expanding rings).
    for (let i = effects.ripples.length - 1; i >= 0; i--) {
        const r = effects.ripples[i];
        const t = (now - r.born) / r.ttl;
        if (t >= 1) { effects.ripples.splice(i, 1); continue; }
        ctx.save();
        ctx.globalAlpha = 1 - t;
        ctx.strokeStyle = r.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.maxR * t, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }

    // Particles (fly out, slight gravity, fade).
    for (let i = effects.particles.length - 1; i >= 0; i--) {
        const p = effects.particles[i];
        const t = now - p.born;
        if (t >= p.ttl) { effects.particles.splice(i, 1); continue; }
        const px = p.x + p.vx * t;
        const py = p.y + p.vy * t + 0.00018 * t * t; // subtle downward arc
        ctx.save();
        ctx.globalAlpha = 1 - t / p.ttl;
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.arc(px, py, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    // Score pops (rise + fade).
    for (let i = effects.scorePops.length - 1; i >= 0; i--) {
        const s = effects.scorePops[i];
        const t = (now - s.born) / s.ttl;
        if (t >= 1) { effects.scorePops.splice(i, 1); continue; }
        ctx.save();
        ctx.globalAlpha = 1 - t;
        ctx.fillStyle = s.color;
        ctx.font = 'bold 20px Orbitron, monospace';
        ctx.textAlign = 'center';
        ctx.shadowColor = s.color;
        ctx.shadowBlur = 8;
        ctx.fillText(s.text, s.x, s.y - t * 34);
        ctx.restore();
    }
}

/**
 * Clear all active effects (e.g. on game start / restart).
 */
function resetEffects() {
    effects.particles.length = 0;
    effects.ripples.length = 0;
    effects.scorePops.length = 0;
    effects.shake = { until: 0, magnitude: 0, duration: 1 };
}

// Expose for Node/Vitest only (no-op in the browser classic-script context).
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        effects,
        spawnFoodBurst,
        spawnScorePop,
        triggerShake,
        getShakeOffset,
        updateAndDrawEffects,
        resetEffects
    };
}
