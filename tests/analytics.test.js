// ==========================================
// M2 — analytics funnel helpers (pure, testable)
// ==========================================
// Covers the lifecycle param-builder, the per-round metric seeding, and the player_tier
// derivation. All three are pure (no DOM / no Firebase), so they unit-test like logic.js.
import { describe, it, expect } from 'vitest';
import utils from '../public/js/utils.js';

const { gameEventParams, resetRoundMetrics, derivePlayerTier } = utils;

describe('gameEventParams', () => {
    it('reports solo run shape with bounded integer params', () => {
        const started = Date.now() - 12000; // 12s ago
        const gs = { mode: 'solo', roundStartedAt: started, food_eaten: 7, maxCombo: 4 };
        const p = gameEventParams(gs);
        expect(p.mode).toBe('solo');
        expect(p.players).toBe(1);
        expect(p.food_eaten).toBe(7);
        expect(p.max_combo).toBe(4);
        expect(p.duration_s).toBeGreaterThanOrEqual(11);
        expect(p.duration_s).toBeLessThanOrEqual(13);
        expect(Number.isInteger(p.duration_s)).toBe(true);
    });

    it('reports multi run shape with the player count', () => {
        const gs = {
            mode: 'multi',
            players: [{ slot: 'p1' }, { slot: 'p2' }, { slot: 'p3' }],
            roundStartedAt: Date.now(),
            food_eaten: 0,
            maxCombo: 0
        };
        const p = gameEventParams(gs);
        expect(p.mode).toBe('multi');
        expect(p.players).toBe(3);
    });

    it('is safe before a round starts (no counters → all zero)', () => {
        const p = gameEventParams({ mode: 'solo' });
        expect(p).toEqual({ mode: 'solo', players: 1, duration_s: 0, food_eaten: 0, max_combo: 0 });
    });

    it('carries NO score, name, code, or other PII keys', () => {
        const p = gameEventParams({ mode: 'solo', roundStartedAt: Date.now(), food_eaten: 1, maxCombo: 1 });
        expect(Object.keys(p).sort()).toEqual(['duration_s', 'food_eaten', 'max_combo', 'mode', 'players']);
    });
});

describe('resetRoundMetrics', () => {
    it('seeds the per-round counters on a fresh state', () => {
        const gs = {};
        const before = Date.now();
        resetRoundMetrics(gs);
        expect(gs.food_eaten).toBe(0);
        expect(gs.maxCombo).toBe(0);
        expect(gs.roundStartedAt).toBeGreaterThanOrEqual(before);
    });

    it('no-ops without throwing on a missing state', () => {
        expect(() => resetRoundMetrics(null)).not.toThrow();
        expect(() => resetRoundMetrics(undefined)).not.toThrow();
    });
});

describe('derivePlayerTier', () => {
    it('returns "new" for a first-ever player', () => {
        expect(derivePlayerTier(0, 0)).toBe('new');
    });

    it('returns "returning" for ≥1 round across ≥2 distinct days', () => {
        expect(derivePlayerTier(1, 2)).toBe('returning');
        expect(derivePlayerTier(3, 4)).toBe('returning');
    });

    it('does NOT promote a same-day repeat player to "returning"', () => {
        expect(derivePlayerTier(3, 1)).toBe('new');
    });

    it('returns "engaged" once the round threshold is reached', () => {
        expect(derivePlayerTier(5, 1)).toBe('engaged');
        expect(derivePlayerTier(20, 9)).toBe('engaged');
    });

    it('only ever emits a bounded 3-value enum', () => {
        const seen = new Set();
        for (let c = 0; c <= 12; c++) for (let d = 0; d <= 5; d++) seen.add(derivePlayerTier(c, d));
        expect([...seen].sort()).toEqual(['engaged', 'new', 'returning']);
    });
});
