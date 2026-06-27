// Unit tests for the combo-scaled eat juice (public/js/effects.js). effects.js is a
// classic browser <script>, but its tail exposes a Node/Vitest module.exports block,
// so we can require it directly and assert against the `effects` buffers — no DOM /
// canvas needed (spawnFoodBurst only pushes plain objects).
import { describe, it, expect, beforeEach } from 'vitest';
import effectsModule from '../public/js/effects.js';

const { effects, spawnFoodBurst, resetEffects } = effectsModule;

describe('spawnFoodBurst intensity scaling', () => {
    beforeEach(() => resetEffects());

    it('the default call is byte-identical to before: 10 particles + a maxR 34 ripple', () => {
        spawnFoodBurst(100, 100, '#ffcf4d');
        expect(effects.particles).toHaveLength(10);
        expect(effects.ripples).toHaveLength(1);
        expect(effects.ripples[0].maxR).toBe(34);
    });

    it('omitting intensity matches passing intensity 1 exactly', () => {
        spawnFoodBurst(100, 100, '#ffcf4d');
        const defaultCount = effects.particles.length;
        const defaultMaxR = effects.ripples[0].maxR;
        resetEffects();
        spawnFoodBurst(100, 100, '#ffcf4d', 1);
        expect(effects.particles).toHaveLength(defaultCount);
        expect(effects.ripples[0].maxR).toBe(defaultMaxR);
    });

    it('a high intensity emits strictly MORE particles and a LARGER ripple', () => {
        spawnFoodBurst(100, 100, '#ffcf4d', 1);
        const lowCount = effects.particles.length;
        const lowMaxR = effects.ripples[0].maxR;
        resetEffects();
        spawnFoodBurst(100, 100, '#ffcf4d', 2.2);
        expect(effects.particles.length).toBeGreaterThan(lowCount);
        expect(effects.ripples[0].maxR).toBeGreaterThan(lowMaxR);
        // 10 * round(2.2) ≈ 22 particles, maxR 34 * 2.2 ≈ 74.8.
        expect(effects.particles).toHaveLength(Math.round(10 * 2.2));
        expect(effects.ripples[0].maxR).toBeCloseTo(34 * 2.2);
    });

    it('intensity below 1 is clamped to the default (never fewer than 10 particles)', () => {
        spawnFoodBurst(100, 100, '#ffcf4d', 0.5);
        expect(effects.particles).toHaveLength(10);
        expect(effects.ripples[0].maxR).toBe(34);
    });

    it('resetEffects clears the buffers between bursts', () => {
        spawnFoodBurst(100, 100, '#ffcf4d', 2);
        expect(effects.particles.length).toBeGreaterThan(0);
        resetEffects();
        expect(effects.particles).toHaveLength(0);
        expect(effects.ripples).toHaveLength(0);
    });
});
