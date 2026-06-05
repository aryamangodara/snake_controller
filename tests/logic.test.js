import { describe, it, expect } from 'vitest';
import logic from '../public/js/logic.js';

const {
    normalizeAngle,
    shortestAngleDelta,
    stepDirection,
    hitsWall,
    hitsSelf,
    eatsFood,
    joystickToControl,
} = logic;

// Mirrors the relevant fields of gameConfig (public/js/config.js).
const config = {
    wallMargin: 20,
    boardSize: { width: 600, height: 600 },
    minSelfCollisionSegments: 8,
    snakeSegmentSize: 12,
    foodSize: 8,
    maxSpeedBoost: 1.5,
};

const TAU = 2 * Math.PI;

describe('normalizeAngle', () => {
    it('leaves angles already in [0, 2π) unchanged', () => {
        expect(normalizeAngle(0)).toBe(0);
        expect(normalizeAngle(Math.PI)).toBeCloseTo(Math.PI);
    });

    it('wraps negative angles into range', () => {
        expect(normalizeAngle(-Math.PI / 2)).toBeCloseTo((3 * Math.PI) / 2);
    });

    it('wraps angles >= 2π into range', () => {
        expect(normalizeAngle(TAU)).toBeCloseTo(0);
        expect(normalizeAngle(TAU + 1)).toBeCloseTo(1);
    });
});

describe('shortestAngleDelta', () => {
    it('returns a simple difference within range', () => {
        expect(shortestAngleDelta(Math.PI / 2, 0)).toBeCloseTo(Math.PI / 2);
    });

    it('takes the short way around the circle', () => {
        // target 0, current 3π/2 -> shortest turn is +π/2, not -3π/2
        expect(shortestAngleDelta(0, (3 * Math.PI) / 2)).toBeCloseTo(Math.PI / 2);
    });

    it('stays within [-π, π]', () => {
        for (const [t, c] of [[0, 0.1], [6, 0.2], [3, -3], [-3, 3]]) {
            const d = shortestAngleDelta(t, c);
            expect(d).toBeGreaterThanOrEqual(-Math.PI);
            expect(d).toBeLessThanOrEqual(Math.PI);
        }
    });
});

describe('stepDirection', () => {
    it('turns by at most turnSpeed toward a far target', () => {
        expect(stepDirection(0, Math.PI / 2, 0.08)).toBeCloseTo(0.08);
    });

    it('snaps to the target when within turnSpeed', () => {
        expect(stepDirection(0, 0.05, 0.08)).toBeCloseTo(0.05);
    });

    it('always returns a normalized angle', () => {
        const d = stepDirection(0.01, -0.5, 0.08); // would go negative before normalizing
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThan(TAU);
    });
});

describe('hitsWall', () => {
    it('is true past each edge (accounting for wallMargin)', () => {
        expect(hitsWall({ x: 5, y: 300 }, config)).toBe(true); // left
        expect(hitsWall({ x: 595, y: 300 }, config)).toBe(true); // right
        expect(hitsWall({ x: 300, y: 5 }, config)).toBe(true); // top
        expect(hitsWall({ x: 300, y: 595 }, config)).toBe(true); // bottom
    });

    it('is false well inside the playable area', () => {
        expect(hitsWall({ x: 300, y: 300 }, config)).toBe(false);
    });
});

describe('hitsSelf', () => {
    // A 12-segment snake laid out far apart; index 8 will be overlapped on purpose.
    const baseSnake = () =>
        Array.from({ length: 12 }, (_, i) => ({ x: 100 + i * 50, y: 100 }));

    it('detects overlap with a segment beyond the ignore window', () => {
        const snake = baseSnake();
        const head = { x: snake[8].x, y: snake[8].y };
        expect(hitsSelf(head, snake, config)).toBe(true);
    });

    it('ignores the first minSelfCollisionSegments segments', () => {
        const snake = baseSnake();
        const head = { x: snake[2].x, y: snake[2].y }; // index 2 < 8, ignored
        expect(hitsSelf(head, snake, config)).toBe(false);
    });

    it('is false when the head is clear of the body', () => {
        expect(hitsSelf({ x: 5000, y: 5000 }, baseSnake(), config)).toBe(false);
    });
});

describe('eatsFood', () => {
    it('is true within (snakeSegmentSize + foodSize)', () => {
        expect(eatsFood({ x: 100, y: 100 }, { x: 105, y: 100 }, config)).toBe(true);
    });

    it('is false when far from the food', () => {
        expect(eatsFood({ x: 100, y: 100 }, { x: 300, y: 300 }, config)).toBe(false);
    });
});

describe('joystickToControl', () => {
    it('coasts at base speed inside the deadzone', () => {
        const c = joystickToControl({ x: 0.05, y: 0 }, 2, config);
        expect(c.active).toBe(false);
        expect(c.targetDirection).toBeNull();
        expect(c.speed).toBe(2);
    });

    it('maps a full-right push to heading 0 and max boost', () => {
        const c = joystickToControl({ x: 1, y: 0 }, 2, config);
        expect(c.active).toBe(true);
        expect(c.targetDirection).toBeCloseTo(0);
        expect(c.speed).toBeCloseTo(2 + config.maxSpeedBoost);
    });

    it('maps a downward push to heading +π/2', () => {
        const c = joystickToControl({ x: 0, y: 1 }, 2, config);
        expect(c.targetDirection).toBeCloseTo(Math.PI / 2);
    });

    it('clamps the speed boost at magnitude 1', () => {
        const big = joystickToControl({ x: 3, y: 4 }, 2, config); // magnitude 5
        expect(big.speed).toBeCloseTo(2 + config.maxSpeedBoost);
    });
});
