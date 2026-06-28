// Unit tests for the multiplayer player factories (public/js/players.js).
//
// players.js is a classic browser <script> with no imports: it reads the shared-scope
// globals `gameConfig`, the logic.js pose helpers (`spawnPose` / `snakeFromPose`), and
// `createInitialGameState` / `gameState` at call time, and evaluates `PLAYER_SLOTS` from
// `gameConfig.maxPlayers` at MODULE-EVALUATION time. So we install those globals on
// `globalThis` BEFORE requiring the module (Strategy B from the M6 spec), then require it.
//
// The logic.js pose math is the REAL implementation (imported), so a 1-player roster is
// verified to reproduce the classic solo layout for free. All side-effects the factories
// touch are pure data construction — no DOM, sound, or sync — so nothing needs stubbing here.
import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import logic from '../public/js/logic.js';

const require = createRequire(import.meta.url);

// Mirror the gameConfig fields the factories read. maxPlayers === 3 matches config.js so
// PLAYER_SLOTS is ['p1','p2','p3'] — and lets us exercise the documented over-cap path (p6).
const gameConfig = {
    boardSize: { width: 600, height: 600 },
    segmentSpacing: 15,
    baseSpeed: 2.0,
    maxPlayers: 3,
};

let players;
let PLAYER_COLORS, PLAYER_SLOTS, createPlayer, createMultiplayerState;
let alivePlayers, aliveSnakes, getPlayerBySlot;

beforeAll(() => {
    // Install the shared-scope globals players.js reads, in load order, BEFORE require().
    globalThis.gameConfig = gameConfig;
    globalThis.spawnPose = logic.spawnPose;
    globalThis.snakeFromPose = logic.snakeFromPose;
    // state.js's solo factory — players.js layers 'multi' on top of it.
    globalThis.createInitialGameState = () => ({
        snake: [], food: { x: 450, y: 150 }, score: 0, mode: 'solo',
        players: [], currentState: 'waiting_for_start',
    });
    globalThis.gameState = { players: [] };

    players = require('../public/js/players.js');
    ({
        PLAYER_COLORS, PLAYER_SLOTS, createPlayer, createMultiplayerState,
        alivePlayers, aliveSnakes, getPlayerBySlot,
    } = players);
});

describe('PLAYER_SLOTS / PLAYER_COLORS', () => {
    it('derives the active slot ids from gameConfig.maxPlayers (3 → p1..p3)', () => {
        expect(PLAYER_SLOTS).toEqual(['p1', 'p2', 'p3']);
    });

    it('keeps the six-palette table fully populated (p1 is the solo teal palette)', () => {
        expect(Object.keys(PLAYER_COLORS)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
        expect(PLAYER_COLORS.p1).toMatchObject({ body: '#19c3b2', head: '#7df9ff' });
        for (const slot of Object.keys(PLAYER_COLORS)) {
            expect(PLAYER_COLORS[slot]).toEqual(
                expect.objectContaining({ body: expect.any(String), head: expect.any(String), rgb: expect.any(String) }),
            );
        }
    });
});

describe('createMultiplayerState — 3-player roster', () => {
    const roster = [
        { slot: 'p1', name: 'Ann' },
        { slot: 'p2', name: 'Bo' },
        { slot: 'p3', name: 'Cy' },
    ];
    let state;
    beforeAll(() => { state = createMultiplayerState(roster); });

    it('builds a multi-mode state with one player per roster entry', () => {
        expect(state.mode).toBe('multi');
        expect(state.mpResults).toBe(null);
        expect(state.players).toHaveLength(3);
        // Solo base fields carry through (built from createInitialGameState).
        expect(state.players.map((p) => p.slot)).toEqual(['p1', 'p2', 'p3']);
    });

    it('each player gets the right slot, palette, name, and a 5-segment snake', () => {
        state.players.forEach((p, i) => {
            const slot = roster[i].slot;
            expect(p.slot).toBe(slot);
            expect(p.name).toBe(roster[i].name);
            expect(p.colors).toBe(PLAYER_COLORS[slot]); // same palette object reference
            expect(p.snake).toHaveLength(5);
            // Each segment is a {x, y} point inside the board.
            for (const seg of p.snake) {
                expect(typeof seg.x).toBe('number');
                expect(typeof seg.y).toBe('number');
            }
        });
    });

    it('initializes per-round fields fresh (alive, zero score/combo, empty milestones)', () => {
        for (const p of state.players) {
            expect(p.alive).toBe(true);
            expect(p.death).toBe(null);
            expect(p.score).toBe(0);
            expect(p.combo).toBe(0);
            expect(p.milestonesFired).toEqual([]);
            expect(p.baseSpeed).toBe(gameConfig.baseSpeed);
            expect(p.currentSpeed).toBe(gameConfig.baseSpeed);
        }
    });

    it('spawns the players spread out (heads pairwise separated)', () => {
        const heads = state.players.map((p) => p.snake[0]);
        for (let a = 0; a < heads.length; a++) {
            for (let b = a + 1; b < heads.length; b++) {
                const d = Math.hypot(heads[a].x - heads[b].x, heads[a].y - heads[b].y);
                expect(d).toBeGreaterThan(100);
            }
        }
    });
});

describe('createPlayer — 1-player roster reproduces the classic solo pose', () => {
    it('head at board center, heading 0, body trailing left (matches createInitialSnake)', () => {
        const p = createPlayer('p1', 'Solo', 1);
        expect(p.direction).toBe(0);
        expect(p.targetDirection).toBe(0);
        expect(p.snake).toHaveLength(5);
        // spawnPose(0, 1) === { x: 300, y: 300, heading: 0 }; body extends left by spacing.
        p.snake.forEach((seg, i) => {
            expect(seg.x).toBeCloseTo(300 - gameConfig.segmentSpacing * i);
            expect(seg.y).toBeCloseTo(300);
        });
    });
});

describe('createPlayer — over-cap slot still spawns (documented contract)', () => {
    it('p6 while maxPlayers is 3 does NOT throw and uses PLAYER_COLORS.p6', () => {
        // The slot index is derived from the id (parseInt('p6'.slice(1)) - 1 === 5),
        // NOT PLAYER_SLOTS.indexOf — so a roster beyond the current cap still works.
        let p;
        expect(() => { p = createPlayer('p6', 'Zed', 6); }).not.toThrow();
        expect(p.colors).toBe(PLAYER_COLORS.p6);
        expect(p.snake).toHaveLength(5);
        // It used slotIndex 5 of 6, so its head sits away from the p1 spawn ring point.
        const p1 = createPlayer('p1', 'A', 6);
        const d = Math.hypot(p.snake[0].x - p1.snake[0].x, p.snake[0].y - p1.snake[0].y);
        expect(d).toBeGreaterThan(0);
    });

    it('falls back to a generated name when the roster entry has no name', () => {
        const p = createPlayer('p2', '', 3);
        expect(p.name).toBe('Player 2');
    });
});

describe('roster helpers read live gameState', () => {
    it('alivePlayers / aliveSnakes / getPlayerBySlot operate over gameState.players', () => {
        globalThis.gameState = createMultiplayerState([
            { slot: 'p1', name: 'Ann' },
            { slot: 'p2', name: 'Bo' },
        ]);
        globalThis.gameState.players[1].alive = false;

        expect(alivePlayers().map((p) => p.slot)).toEqual(['p1']);
        expect(aliveSnakes()).toHaveLength(1); // only the alive snake's body
        expect(getPlayerBySlot('p2').name).toBe('Bo');
        expect(getPlayerBySlot('nope')).toBeUndefined();
    });
});
