// Characterization tests for the N-snake multiplayer engine (public/js/mp-engine.js).
//
// The engine is NOT pure: its functions read/mutate the shared-scope globals gameConfig,
// colors, gameState (and the logic.js helpers / player factories), and call side-effecting
// hooks (generateFood, spawnFoodBurst, playFoodSound, triggerShake, the mpUiHook / mpNetHook
// indirection, trackEvent). In a browser those are sibling <script> globals; under Node they
// resolve to `global.<name>` at CALL time.
//
// Harness (Strategy B from the M6 spec — direct require() with injected deps): install every
// global the engine touches on `globalThis` BEFORE requiring, then require the real exported
// modules (logic.js, players.js, utils.js, mp-engine.js). Requiring (vs vm.runInContext) keeps
// the engine source instrumented, so coverage is attributed to mp-engine.js. We STUB the
// side-effects that live in files we don't load — game.js's generateFood / TARGET_FRAME_MS /
// MAX_FRAME_STEP, sound.js, effects.js — as no-ops/spies, and assert on the STATE the engine
// mutates, never on real juice/sound/sync. Date.now is driven by vi fake timers for the combo /
// expiry assertions. Each test calls freshEngine() so globals never leak between cases.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import logic from '../public/js/logic.js';

const require = createRequire(import.meta.url);
const ENGINE_SRC = join(__dirname, '..', 'public', 'js', 'mp-engine.js');

// Mirror the gameConfig fields the engine / factories read (from public/js/config.js).
function makeConfig() {
    return {
        boardSize: { width: 600, height: 600 },
        snakeSegmentSize: 12,
        foodSize: 8,
        baseSpeed: 2.0,
        maxSpeedBoost: 1.5,
        speedIncrease: 0.06,
        maxSpeed: 4,
        turnSpeed: 0.13,
        maxTurnSpeedFactor: 2.2,
        segmentSpacing: 15,
        wallMargin: 20,
        minSelfCollisionSegments: 8,
        comboWindowMs: 4500,
        maxCombo: 6,
        comboJuiceMax: 2.2,
        comboShakeThreshold: 3,
        comboShakeMag: 3,
        comboShakeMs: 120,
        maxComboFlashMag: 5,
        milestones: [100, 250, 500, 1000],
        inputStaleMs: 400,
        movementUpdateMs: 25,
        maxPlayers: 3,
    };
}

// Install everything the engine resolves as a global, then require() it fresh. Returns
// `{ engine, players, calls }`; `calls` records the side-effects so a test can assert on them.
function freshEngine() {
    const calls = {
        generateFood: [], // each entry: the snakes[] arg generateFood received
        triggerShake: [],
        spawnFoodBurst: [],
        playFoodSound: [],
        track: [], // [name, params] from trackEvent
    };
    const g = globalThis;

    g.gameConfig = makeConfig();
    g.colors = { food: '#ffcf4d' };
    g.GameState = { WAITING_FOR_START: 'waiting_for_start', PLAYING: 'playing', GAME_OVER: 'game_over' };

    // logic.js pure helpers the engine + factories call by bare name.
    for (const k of Object.keys(logic)) g[k] = logic[k];

    // state.js's solo factory (players.js layers 'multi' on top of it). Minimal but complete
    // enough for the engine: every field createMultiplayerState/endMultiplayerGame touches.
    g.createInitialGameState = () => ({
        snake: [], direction: 0, targetDirection: 0,
        baseSpeed: g.gameConfig.baseSpeed, currentSpeed: g.gameConfig.baseSpeed,
        food: { x: 450, y: 150 }, score: 0, gameRunning: false,
        lastUpdateTime: 0, lastMoveTime: 0, currentState: g.GameState.WAITING_FOR_START,
        joystickInput: { x: 0, y: 0 }, frameCount: 0, combo: 0, lastFoodTime: 0,
        milestonesFired: [], mode: 'solo', players: [],
    });
    g.gameState = g.createInitialGameState();
    g.mpSession = { enabled: false, live: new Set(), inputs: {}, stamps: {}, roster: {}, defeated: [] };

    // players.js factories (require the real module so their coverage counts too).
    const players = require('../public/js/players.js');
    for (const k of Object.keys(players)) g[k] = players[k];

    // game.js constants + generateFood (game.js not loaded). generateFood records the alive
    // snakes it received and parks the fruit at a deterministic corner out of every test
    // head's reach, so a later mover never accidentally re-eats it the same tick.
    g.TARGET_FRAME_MS = 1000 / 60;
    g.MAX_FRAME_STEP = 3;
    g.generateFood = (snakes) => {
        calls.generateFood.push(snakes.map((s) => s.slice()));
        g.gameState.food = { x: 60, y: 60 };
    };

    // Side-effect stubs (effects.js / sound.js not loaded).
    g.spawnFoodBurst = (...a) => calls.spawnFoodBurst.push(a);
    g.spawnScorePop = () => {};
    g.triggerShake = (mag, ms) => calls.triggerShake.push([mag, ms]);
    g.resetEffects = () => {};
    g.playFoodSound = (m) => calls.playFoodSound.push(m);
    g.playMilestoneSound = () => {};
    g.playCrashSound = () => {};
    g.playStartSound = () => {};

    // hideSoloHud reads document; mpUiHook/mpNetHook read window[name] — give them inert objects.
    g.window = {};
    g.document = { getElementById: () => null };
    g.performance = { now: () => 0 };

    // The engine calls trackEvent / debugLog by bare name. utils.js does NOT export trackEvent
    // (it's a browser global), so we provide a recording stub directly: a no-op spy that mirrors
    // the production contract (never throws) and lets us assert mp_game_over is PII-free.
    g.debugLog = () => {};
    g.trackEvent = (name, params = {}) => calls.track.push([name, { ...params }]);

    const engine = require('../public/js/mp-engine.js');
    return { engine, players, calls };
}

// Park one player's head + heading deterministically (3-segment body trailing left).
function setHead(player, x, y, dir, speed) {
    player.snake = [{ x, y }, { x: x - 15, y }, { x: x - 30, y }];
    player.direction = dir;
    player.targetDirection = dir;
    player.currentSpeed = speed;
    player.baseSpeed = speed;
}

describe('mp-engine — round setup + exports', () => {
    it('require() yields the engine functions and the export block is a browser no-op', () => {
        const { engine } = freshEngine();
        for (const fn of [
            'startMultiplayerGame', 'updateMultiplayerFrame', 'stepMultiplayerTick',
            'movePlayer', 'applyFoodEaten', 'eliminatePlayer', 'checkEndCondition',
            'endMultiplayerGame',
        ]) {
            expect(typeof engine[fn]).toBe('function');
        }
        // The export guard is `typeof module !== 'undefined' && module.exports`, so in a
        // browser classic <script> (no `module`) the block never runs.
        const src = readFileSync(ENGINE_SRC, 'utf8');
        expect(src).toMatch(/typeof module !== 'undefined' && module\.exports/);
    });

    it('startMultiplayerGame builds a live multi state and generates the first fruit', () => {
        const { engine, calls } = freshEngine();
        engine.startMultiplayerGame([{ slot: 'p1', name: 'Ann' }, { slot: 'p2', name: 'Bo' }]);
        expect(globalThis.gameState.mode).toBe('multi');
        expect(globalThis.gameState.currentState).toBe('playing');
        expect(globalThis.gameState.players).toHaveLength(2);
        expect(calls.generateFood.length).toBeGreaterThan(0);
    });
});

describe('mp-engine — collision: the biter dies, the bitten survives', () => {
    it("movePlayer returns {died, cause:'bite', by} when a head moves into another body", () => {
        const { engine } = freshEngine();
        engine.startMultiplayerGame([{ slot: 'p1', name: 'A' }, { slot: 'p2', name: 'B' }]);
        const [a, b] = globalThis.gameState.players;
        setHead(b, 300, 300, 0, 2); // B body around x=300,285,270 (y=300)
        setHead(a, 296, 300, 0, 5); // A head steps to ~301 → into B's head/segment
        const out = engine.movePlayer(a);
        expect(out.died).toBe(true);
        expect(out.cause).toBe('bite');
        expect(out.by).toBe('p2');
        // B, the bitten, was not moved by A's movePlayer.
        expect(b.alive).toBe(true);
    });

    it('a clean step (no collision) returns {died:false} and advances the head', () => {
        const { engine } = freshEngine();
        engine.startMultiplayerGame([{ slot: 'p1', name: 'A' }, { slot: 'p2', name: 'B' }]);
        const [a, b] = globalThis.gameState.players;
        setHead(b, 100, 100, 0, 2);
        setHead(a, 400, 400, Math.PI, 3); // heading left, open space
        const out = engine.movePlayer(a);
        expect(out.died).toBe(false);
        expect(a.snake[0].x).toBeCloseTo(397); // 400 - 3
    });
});

describe('mp-engine — simultaneous deaths collected then resolved (head-on)', () => {
    it('two heads stepping onto each other in one tick eliminate BOTH', () => {
        const { engine } = freshEngine();
        engine.startMultiplayerGame([{ slot: 'p1', name: 'A' }, { slot: 'p2', name: 'B' }]);
        const [a, b] = globalThis.gameState.players;
        // Heads 6px apart, facing each other, each stepping 4px → both cross into the other's
        // body the SAME tick. Deaths are collected during the loop and applied after, so the
        // second mover still saw the (not-yet-removed) first snake.
        setHead(a, 300, 300, 0, 4); // A faces right (+x)
        setHead(b, 306, 300, Math.PI, 4); // B faces left (-x), 6px to A's right
        a.score = 50;
        b.score = 30;
        engine.stepMultiplayerTick();
        expect(a.alive).toBe(false);
        expect(b.alive).toBe(false);
        // Zero alive, both died THIS tick → resolveWinner picks the higher just-died score.
        expect(globalThis.gameState.currentState).toBe('game_over');
        expect(globalThis.gameState.mpResults.winnerSlot).toBe('p1'); // 50 > 30
    });

    it('an exact score tie among the just-died is a draw (winnerSlot null)', () => {
        const { engine } = freshEngine();
        engine.startMultiplayerGame([{ slot: 'p1', name: 'A' }, { slot: 'p2', name: 'B' }]);
        const [a, b] = globalThis.gameState.players;
        setHead(a, 300, 300, 0, 4);
        setHead(b, 306, 300, Math.PI, 4);
        a.score = 40;
        b.score = 40;
        engine.stepMultiplayerTick();
        expect(globalThis.gameState.currentState).toBe('game_over');
        expect(globalThis.gameState.mpResults.winnerSlot).toBe(null);
    });

    it('last snake standing wins when one of two dies (wall death)', () => {
        const { engine } = freshEngine();
        engine.startMultiplayerGame([{ slot: 'p1', name: 'A' }, { slot: 'p2', name: 'B' }]);
        const [a, b] = globalThis.gameState.players;
        setHead(a, 25, 300, Math.PI, 10); // steps to x≈15 < wallMargin(20) → wall death
        setHead(b, 300, 300, 0, 2);
        engine.stepMultiplayerTick();
        expect(a.alive).toBe(false);
        expect(b.alive).toBe(true);
        expect(a.death.cause).toBe('wall');
        expect(globalThis.gameState.currentState).toBe('game_over');
        expect(globalThis.gameState.mpResults.winnerSlot).toBe('p2');
    });
});

describe('mp-engine — combo ramp, cap, and score gain', () => {
    it('repeated eats within comboWindowMs ramp the multiplier and cap at maxCombo', () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000_000);
        try {
            const { engine } = freshEngine();
            engine.startMultiplayerGame([{ slot: 'p1', name: 'A' }]);
            const p = globalThis.gameState.players[0];
            const maxCombo = globalThis.gameConfig.maxCombo; // 6
            let expectedScore = 0;
            for (let n = 1; n <= maxCombo + 3; n++) {
                vi.advanceTimersByTime(10); // each eat a few ms apart, well inside the window
                engine.applyFoodEaten(p);
                expectedScore += 10 * Math.min(n, maxCombo); // score uses the CAPPED multiplier
                expect(p.combo).toBe(n); // the counter keeps rising past the cap
                expect(p.score).toBe(expectedScore);
            }
            // The last (over-cap) eats each scored 10 * maxCombo, not 10 * combo.
            const lastGain = 10 * maxCombo;
            const prevScore = expectedScore - lastGain;
            expect(p.score - prevScore).toBe(lastGain);
        } finally {
            vi.useRealTimers();
        }
    });

    it('an eat after comboWindowMs resets the streak to 1 (no carry-over)', () => {
        vi.useFakeTimers();
        vi.setSystemTime(2_000_000);
        try {
            const { engine } = freshEngine();
            engine.startMultiplayerGame([{ slot: 'p1', name: 'A' }]);
            const p = globalThis.gameState.players[0];
            engine.applyFoodEaten(p); // combo 1
            engine.applyFoodEaten(p); // combo 2
            expect(p.combo).toBe(2);
            vi.advanceTimersByTime(globalThis.gameConfig.comboWindowMs + 1); // lapse
            engine.applyFoodEaten(p);
            expect(p.combo).toBe(1); // fresh streak
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('mp-engine — combo expiry in updateMultiplayerFrame', () => {
    it('a stale combo resets to 0 once the clock passes comboWindowMs', () => {
        vi.useFakeTimers();
        vi.setSystemTime(3_000_000);
        try {
            const { engine } = freshEngine();
            engine.startMultiplayerGame([{ slot: 'p1', name: 'A' }]);
            const p = globalThis.gameState.players[0];
            engine.applyFoodEaten(p);
            expect(p.combo).toBe(1);
            vi.advanceTimersByTime(globalThis.gameConfig.comboWindowMs + 50);
            // moveDeltaTime 0 → no movement step; only the combo-expiry sweep runs.
            engine.updateMultiplayerFrame(0, 0, 0);
            expect(p.combo).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it('a still-fresh combo is NOT expired by updateMultiplayerFrame', () => {
        vi.useFakeTimers();
        vi.setSystemTime(4_000_000);
        try {
            const { engine } = freshEngine();
            engine.startMultiplayerGame([{ slot: 'p1', name: 'A' }]);
            const p = globalThis.gameState.players[0];
            engine.applyFoodEaten(p);
            vi.advanceTimersByTime(10); // well inside comboWindowMs
            engine.updateMultiplayerFrame(0, 0, 0);
            expect(p.combo).toBe(1);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('mp-engine — speed ramp on eat', () => {
    it('baseSpeed/currentSpeed step up by speedIncrease', () => {
        const { engine } = freshEngine();
        engine.startMultiplayerGame([{ slot: 'p1', name: 'A' }]);
        const p = globalThis.gameState.players[0];
        const base = globalThis.gameConfig.baseSpeed;
        const inc = globalThis.gameConfig.speedIncrease;
        engine.applyFoodEaten(p);
        expect(p.baseSpeed).toBeCloseTo(base + inc);
        expect(p.currentSpeed).toBeCloseTo(base + inc);
    });

    it('speed never exceeds gameConfig.maxSpeed even after many eats', () => {
        const { engine } = freshEngine();
        engine.startMultiplayerGame([{ slot: 'p1', name: 'A' }]);
        const p = globalThis.gameState.players[0];
        const max = globalThis.gameConfig.maxSpeed;
        p.baseSpeed = max - 0.01;
        engine.applyFoodEaten(p);
        expect(p.baseSpeed).toBeLessThanOrEqual(max);
        expect(p.baseSpeed).toBeCloseTo(max);
        // Already at max → the if-guard skips, so a further eat does not push past it.
        engine.applyFoodEaten(p);
        expect(p.baseSpeed).toBeLessThanOrEqual(max);
    });
});

describe('mp-engine — fruit respawns over ALIVE snakes between movers in one tick', () => {
    it('an earlier mover eating moves the fruit (generated with alive snakes only)', () => {
        const { engine, calls } = freshEngine();
        engine.startMultiplayerGame([
            { slot: 'p1', name: 'A' }, { slot: 'p2', name: 'B' }, { slot: 'p3', name: 'C' },
        ]);
        const [a, b, c] = globalThis.gameState.players;
        calls.generateFood.length = 0; // ignore the start-of-round generate
        // Fruit sits ON A's next-step position so A (first mover) eats; B/C move cleanly.
        globalThis.gameState.food = { x: 302, y: 300 };
        setHead(a, 300, 300, 0, 2); // A steps 300→302 into the fruit
        setHead(b, 100, 100, Math.PI, 2);
        setHead(c, 500, 500, Math.PI, 2);
        // Pre-kill C so aliveSnakes() excludes it from the respawn's exclusion set.
        c.alive = false;
        c.snake = [];

        engine.stepMultiplayerTick();

        // generateFood was called exactly once (only A ate) ...
        expect(calls.generateFood).toHaveLength(1);
        // ... with the ALIVE snakes only (A and B), not the dead C.
        expect(calls.generateFood[0]).toHaveLength(2);
        // ... and the fruit moved to the deterministic respawn spot.
        expect(globalThis.gameState.food).toEqual({ x: 60, y: 60 });
    });
});

describe('mp-engine — eliminatePlayer bookkeeping', () => {
    it('marks dead, records the death cause/by, clears the snake, and fires crash juice', () => {
        const { engine, calls } = freshEngine();
        engine.startMultiplayerGame([{ slot: 'p1', name: 'A' }, { slot: 'p2', name: 'B' }]);
        const a = globalThis.gameState.players[0];
        engine.eliminatePlayer(a, 'bite', 'p2');
        expect(a.alive).toBe(false);
        expect(a.death).toMatchObject({ cause: 'bite', by: 'p2' });
        expect(a.combo).toBe(0);
        expect(a.snake).toEqual([]); // vanishes from the board + every collision check
        expect(calls.triggerShake).toContainEqual([9, 340]); // the death shake
    });
});

describe('mp-engine — endMultiplayerGame results + no-PII analytics', () => {
    it('builds mpResults (winner, defeated names, per-player rows) and emits a PII-free event', () => {
        const { engine, calls } = freshEngine();
        engine.startMultiplayerGame([{ slot: 'p1', name: 'Ann' }, { slot: 'p2', name: 'Bo' }]);
        const [a, b] = globalThis.gameState.players;
        a.score = 70;
        b.alive = false;
        b.death = { cause: 'bite', by: 'p1', at: 1 };
        b.snake = [];
        engine.endMultiplayerGame('p1');

        expect(globalThis.gameState.mpResults.winnerSlot).toBe('p1');
        expect(globalThis.gameState.mpResults.defeated).toEqual(['Bo']);
        expect(globalThis.gameState.mpResults.players).toHaveLength(2);
        expect(globalThis.gameState.currentState).toBe('game_over');

        // mp_game_over fired with winner_score and NO name / NO 6-digit session code.
        const over = calls.track.find((c) => c[0] === 'mp_game_over');
        expect(over).toBeTruthy();
        expect(over[1].winner_score).toBe(70);
        const blob = JSON.stringify(over[1]);
        expect(blob).not.toMatch(/Ann|Bo/); // no PII (names)
        expect(/\d{6}/.test(blob)).toBe(false); // no 6-digit session code
    });
});
