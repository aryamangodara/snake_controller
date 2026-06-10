import { describe, it, expect } from 'vitest';
import logic from '../public/js/logic.js';

const {
    normalizeAngle,
    shortestAngleDelta,
    stepDirection,
    speedToTurnStep,
    hitsWall,
    hitsSnake,
    hitsSelf,
    eatsFood,
    joystickToControl,
    spawnPose,
    snakeFromPose,
    followSegments,
    growTail,
    resolveWinner,
} = logic;

// Mirrors the relevant fields of gameConfig (public/js/config.js).
const config = {
    wallMargin: 20,
    boardSize: { width: 600, height: 600 },
    minSelfCollisionSegments: 8,
    snakeSegmentSize: 12,
    foodSize: 8,
    maxSpeedBoost: 1.5,
    segmentSpacing: 15,
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

describe('speedToTurnStep', () => {
    const BASE_TURN = 0.13;
    const BASE_SPEED = 2;
    const MAX_FACTOR = 2.2;

    it('returns the base turn at base speed on a 60fps frame', () => {
        // frameFactor 1 (= a 60fps frame), currentSpeed == baseSpeed -> no scaling.
        expect(speedToTurnStep(BASE_TURN, BASE_SPEED, BASE_SPEED, 1, MAX_FACTOR)).toBeCloseTo(BASE_TURN);
    });

    it('scales the turn rate up with speed (keeps turn radius ~constant)', () => {
        // Twice the speed -> twice the angular step, so radius = speed/angular stays put.
        expect(speedToTurnStep(BASE_TURN, 4, BASE_SPEED, 1, MAX_FACTOR)).toBeCloseTo(BASE_TURN * 2);
    });

    it('clamps the speed multiplier at maxSpeedFactor', () => {
        expect(speedToTurnStep(BASE_TURN, 100, BASE_SPEED, 1, MAX_FACTOR)).toBeCloseTo(BASE_TURN * MAX_FACTOR);
    });

    it('is frame-rate independent: a longer frame turns proportionally further', () => {
        // A frame twice as long (frameFactor 2) turns twice as far -> constant rad/sec.
        expect(speedToTurnStep(BASE_TURN, BASE_SPEED, BASE_SPEED, 2, MAX_FACTOR)).toBeCloseTo(BASE_TURN * 2);
        expect(speedToTurnStep(BASE_TURN, BASE_SPEED, BASE_SPEED, 0.5, MAX_FACTOR)).toBeCloseTo(BASE_TURN / 2);
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

describe('hitsSnake', () => {
    const snake = () => Array.from({ length: 12 }, (_, i) => ({ x: 100 + i * 50, y: 100 }));

    it('with skip 0, detects overlap with the very first segment (head-on)', () => {
        const s = snake();
        expect(hitsSnake({ x: s[0].x, y: s[0].y }, s, 0, config)).toBe(true);
    });

    it('with skip 0, detects overlap with a mid-body segment', () => {
        const s = snake();
        expect(hitsSnake({ x: s[5].x, y: s[5].y }, s, 0, config)).toBe(true);
    });

    it('with skip = minSelfCollisionSegments, reproduces hitsSelf', () => {
        const s = snake();
        for (const head of [
            { x: s[2].x, y: s[2].y },   // inside ignore window
            { x: s[8].x, y: s[8].y },   // beyond ignore window
            { x: 5000, y: 5000 },       // clear of the body
        ]) {
            expect(hitsSnake(head, s, config.minSelfCollisionSegments, config))
                .toBe(hitsSelf(head, s, config));
        }
    });

    it('hits inside the 0.8 * snakeSegmentSize radius and misses outside it', () => {
        // A clear margin on each side — the exact boundary is FP-rounding territory
        // (Math.hypot can differ from the threshold product by one ulp).
        const s = [{ x: 100, y: 100 }];
        const justOutside = { x: 100 + config.snakeSegmentSize * 0.8 + 0.01, y: 100 };
        const justInside = { x: 100 + config.snakeSegmentSize * 0.8 - 0.01, y: 100 };
        expect(hitsSnake(justOutside, s, 0, config)).toBe(false);
        expect(hitsSnake(justInside, s, 0, config)).toBe(true);
    });
});

describe('spawnPose / snakeFromPose', () => {
    it('a 1-player pose is the classic solo layout (center, facing right)', () => {
        const pose = spawnPose(0, 1, config);
        expect(pose).toEqual({ x: 300, y: 300, heading: 0 });
        const snake = snakeFromPose(pose, 5, config.segmentSpacing);
        // Identical to createInitialSnake(): head at center, body extending left.
        expect(snake).toHaveLength(5);
        snake.forEach((seg, i) => {
            expect(seg.x).toBeCloseTo(300 - config.segmentSpacing * i);
            expect(seg.y).toBeCloseTo(300);
        });
    });

    for (const count of [2, 3, 6]) {
        it(`${count}-player heads are pairwise well-separated and in bounds`, () => {
            const poses = Array.from({ length: count }, (_, i) => spawnPose(i, count, config));
            for (let a = 0; a < count; a++) {
                for (let b = a + 1; b < count; b++) {
                    const d = Math.hypot(poses[a].x - poses[b].x, poses[a].y - poses[b].y);
                    expect(d).toBeGreaterThan(100);
                }
            }
            for (const pose of poses) {
                const snake = snakeFromPose(pose, 5, config.segmentSpacing);
                for (const seg of snake) {
                    expect(seg.x).toBeGreaterThan(config.wallMargin);
                    expect(seg.x).toBeLessThan(config.boardSize.width - config.wallMargin);
                    expect(seg.y).toBeGreaterThan(config.wallMargin);
                    expect(seg.y).toBeLessThan(config.boardSize.height - config.wallMargin);
                }
            }
        });
    }

    it('headings face away from each other (heads diverge after one step)', () => {
        const count = 3;
        const poses = Array.from({ length: count }, (_, i) => spawnPose(i, count, config));
        const step = (p) => ({ x: p.x + Math.cos(p.heading) * 10, y: p.y + Math.sin(p.heading) * 10 });
        for (let a = 0; a < count; a++) {
            for (let b = a + 1; b < count; b++) {
                const before = Math.hypot(poses[a].x - poses[b].x, poses[a].y - poses[b].y);
                const sa = step(poses[a]), sb = step(poses[b]);
                const after = Math.hypot(sa.x - sb.x, sa.y - sb.y);
                expect(after).toBeGreaterThan(before);
            }
        }
    });
});

describe('followSegments', () => {
    it('pulls a too-far segment 0.8 of the slack toward its target', () => {
        // Segment 40px behind the previous head; spacing 15 → slack 25, moves 20.
        const snake = [{ x: 100, y: 100 }, { x: 40, y: 100 }];
        followSegments(snake, { x: 80, y: 100 }, config);
        expect(snake[1].x).toBeCloseTo(40 + (40 - config.segmentSpacing) / 40 * 40 * 0.8);
        expect(snake[1].y).toBeCloseTo(100);
    });

    it('leaves segments within spacing untouched', () => {
        const snake = [{ x: 100, y: 100 }, { x: 90, y: 100 }];
        followSegments(snake, { x: 100, y: 100 }, config);
        expect(snake[1]).toEqual({ x: 90, y: 100 });
    });
});

describe('growTail', () => {
    it('appends a segment one spacing behind, along the tail direction', () => {
        const snake = [{ x: 100, y: 100 }, { x: 85, y: 100 }];
        growTail(snake, config);
        expect(snake).toHaveLength(3);
        expect(snake[2].x).toBeCloseTo(70);
        expect(snake[2].y).toBeCloseTo(100);
    });

    it('falls back to straight-left for a single-segment snake', () => {
        const snake = [{ x: 100, y: 100 }];
        growTail(snake, config);
        expect(snake[1]).toEqual({ x: 100 - config.segmentSpacing, y: 100 });
    });

    it('is a no-op on an empty snake', () => {
        const snake = [];
        growTail(snake, config);
        expect(snake).toHaveLength(0);
    });
});

describe('resolveWinner (last snake standing)', () => {
    const p = (slot, alive, score) => ({ slot, alive, score });

    it('continues while more than one player is alive', () => {
        const players = [p('p1', true, 10), p('p2', true, 20), p('p3', false, 5)];
        expect(resolveWinner(players, ['p3'])).toEqual({ over: false, winnerSlot: null });
    });

    it('the sole survivor wins regardless of scores', () => {
        const players = [p('p1', true, 0), p('p2', false, 990)];
        expect(resolveWinner(players, ['p2'])).toEqual({ over: true, winnerSlot: 'p1' });
    });

    it('head-on with unequal scores: the higher just-died score wins', () => {
        const players = [p('p1', false, 40), p('p2', false, 70)];
        expect(resolveWinner(players, ['p1', 'p2'])).toEqual({ over: true, winnerSlot: 'p2' });
    });

    it('head-on with equal scores is a draw', () => {
        const players = [p('p1', false, 50), p('p2', false, 50)];
        expect(resolveWinner(players, ['p1', 'p2'])).toEqual({ over: true, winnerSlot: null });
    });

    it('a 3p double death leaving one survivor: the survivor wins', () => {
        const players = [p('p1', false, 200), p('p2', false, 150), p('p3', true, 10)];
        expect(resolveWinner(players, ['p1', 'p2'])).toEqual({ over: true, winnerSlot: 'p3' });
    });

    it('0-alive ignores higher scores of players who died on EARLIER ticks', () => {
        // p1 died earlier with 999; p2+p3 die together now — only they contend.
        const players = [p('p1', false, 999), p('p2', false, 30), p('p3', false, 60)];
        expect(resolveWinner(players, ['p2', 'p3'])).toEqual({ over: true, winnerSlot: 'p3' });
    });
});
