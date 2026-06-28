// Unit tests for the combo-scaled eat juice (public/js/effects.js). effects.js is a
// classic browser <script>, but its tail exposes a Node/Vitest module.exports block,
// so we can require it directly and assert against the `effects` buffers — no DOM /
// canvas needed (spawnFoodBurst only pushes plain objects).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import effectsModule from '../public/js/effects.js';

const { effects, spawnFoodBurst, triggerShake, getShakeOffset, resetEffects } = effectsModule;

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

describe('triggerShake / getShakeOffset linear decay', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000_000);
        resetEffects();
    });
    afterEach(() => vi.useRealTimers());

    it('offset magnitude decays linearly from ~peak toward zero over the duration', () => {
        triggerShake(9, 340);
        // Stub Math.random to its max (+1 branch) so |offset| === intensity exactly,
        // making the linear ramp deterministically observable.
        const rnd = vi.spyOn(Math, 'random').mockReturnValue(1);
        try {
            // t≈0: remaining≈duration → intensity ≈ magnitude (9).
            const at0 = getShakeOffset();
            expect(Math.hypot(at0.x, at0.y) / Math.SQRT2).toBeCloseTo(9, 1);

            // Halfway through: intensity ≈ magnitude/2 (4.5).
            vi.advanceTimersByTime(170);
            const atHalf = getShakeOffset();
            expect(Math.abs(atHalf.x)).toBeCloseTo(4.5, 1);

            // Strictly decreasing as time passes.
            expect(Math.abs(atHalf.x)).toBeLessThan(Math.abs(at0.x));
        } finally {
            rnd.mockRestore();
        }
    });

    it('returns exactly {x:0, y:0} at and after the shake expires', () => {
        triggerShake(9, 340);
        vi.advanceTimersByTime(340); // remaining === 0
        expect(getShakeOffset()).toEqual({ x: 0, y: 0 });
        vi.advanceTimersByTime(1000); // well past expiry
        expect(getShakeOffset()).toEqual({ x: 0, y: 0 });
    });

    it('with no active shake the offset is zero', () => {
        // resetEffects() set shake.until = 0, which is already in the past.
        expect(getShakeOffset()).toEqual({ x: 0, y: 0 });
    });

    it('resetEffects zeroes the shake (a fired shake no longer offsets)', () => {
        triggerShake(9, 340);
        expect(effects.shake.magnitude).toBe(9);
        resetEffects();
        expect(effects.shake).toEqual({ until: 0, magnitude: 0, duration: 1 });
        expect(getShakeOffset()).toEqual({ x: 0, y: 0 });
    });
});
