// M12 — multiplayer presence & host-resilience unit tests.
//
// mp-net.js / mp-client.js are pure browser-global scripts (no module.exports), so we load
// their real source into a shared vm context (same technique as protocol.test.js) with the
// cross-file globals they resolve at call time stubbed on the context. We inject MOCK Firebase
// refs that RECORD onDisconnect()/set() call order and update() payloads, drive Date.now via a
// controllable clock, and assert on the recorded effects — no network, no real Firebase.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const PUB = join(__dirname, '..', 'public', 'js');

// Build a fresh context with the minimal globals mp-net.js + mp-client.js touch, plus mock
// Firebase. Returns { run, ctx, rec } where `rec` accumulates recorded effects for assertions.
function makeCtx() {
    const rec = {
        firestoreUpdates: [], // {payload}
        rtdbCalls: [],        // ordered: 'onDisconnect.remove' | 'set'
        track: [],            // [name, params]
        status: [],           // showConnectionStatus messages
    };

    const DELETE = { __op: 'delete' };
    const SERVER_TS = { __op: 'serverTimestamp' };

    // Mock Firestore doc ref: records every update payload.
    const docRef = {
        update: (payload) => { rec.firestoreUpdates.push(payload); return Promise.resolve(); },
    };
    const firestore = {
        collection: () => ({ doc: () => docRef }),
    };

    // Mock RTDB slot ref: records onDisconnect().remove() and set() in call order.
    const slotRef = {
        onDisconnect: () => ({ remove: () => { rec.rtdbCalls.push('onDisconnect.remove'); } }),
        set: (v) => { rec.rtdbCalls.push('set'); rec.lastSet = v; return Promise.resolve(); },
        remove: () => Promise.resolve(),
    };
    const database = { ref: () => slotRef };

    const firebase = {
        firestore: { FieldValue: { delete: () => DELETE, serverTimestamp: () => SERVER_TS } },
    };

    const sandbox = {
        // cross-file game globals
        PLAYER_SLOTS: ['p1', 'p2', 'p3'],
        gameConfig: {
            rosterReapMs: 8000, rosterReapSweepMs: 3000,
            hostStaleMs: 12000, hostStaleCheckMs: 2000,
            maxPlayers: 3, actionIgnoreMs: 400,
        },
        GameState: { WAITING_FOR_START: 'waiting_for_start', PLAYING: 'playing', GAME_OVER: 'game_over' },
        gameState: { currentState: 'waiting_for_start', mode: 'solo' },
        sessionManager: { currentSession: '123456', realtimeRef: null },
        mpSession: {
            enabled: false, live: new Set(), inputs: {}, stamps: {}, roster: {},
            defeated: [], lastAction: {}, seenAt: {}, reconcileTimer: null,
        },
        mpClient: {
            slot: null, token: null, waiting: false, joining: false, sessionDocRef: null,
            lastHostActivityAt: 0, hostWatchTimer: null, hostStale: false,
        },
        // firebase mocks
        firebase, firestore, database, slotRef, docRef, DELETE, SERVER_TS,
        // hooks / helpers stubbed
        mpUiHook: () => {},
        trackEvent: (name, params = {}) => rec.track.push([name, { ...params }]),
        debugLog: () => {},
        isNewerStamp: () => true,
        applyPlayerJoystick: () => {},
        handleJoystickInputFromMobile: () => {},
        showConnectionStatus: (m) => rec.status.push(m),
        showConnectionSuccess: () => {},
        showConnectionError: () => {},
        mpUiPhoneQueued: () => {},
        // timers + dom + console
        setInterval, clearInterval, setTimeout, clearTimeout,
        document: { getElementById: () => ({ classList: { add() {}, remove() {} } }) },
        window: { addEventListener: () => {} },
        console,
        Date,
    };
    const ctx = vm.createContext(sandbox);
    // mpRosterSlots / mpHandleAction etc. live in mp-net.js; load it, then mp-client.js.
    vm.runInContext(readFileSync(join(PUB, 'mp-net.js'), 'utf8'), ctx, { filename: 'mp-net.js' });
    vm.runInContext(readFileSync(join(PUB, 'mp-client.js'), 'utf8'), ctx, { filename: 'mp-client.js' });
    return { ctx, rec, sandbox, run: (code) => vm.runInContext(code, ctx) };
}

describe('M12 (a) onDisconnect-before-set in mpTryJoin', () => {
    it('registers onDisconnect().remove() BEFORE set() resolves', async () => {
        const { run, rec } = makeCtx();
        run('claimSlot = async () => "p1";'); // bypass the Firestore transaction
        await run('mpTryJoin("123456")');
        expect(rec.rtdbCalls).toEqual(['onDisconnect.remove', 'set']);
    });
});

describe('M12 (b) host roster reconciliation reaps only childless ghosts', () => {
    it('reaps a roster slot with no live child past the grace window', () => {
        vi.useFakeTimers();
        const t0 = 1_000_000;
        vi.setSystemTime(t0);
        const { run, rec, sandbox } = makeCtx();
        // A roster entry exists, but its RTDB child never went live.
        sandbox.mpSession.roster = { p1: { name: 'Ann', alive: false, connected: true } };
        sandbox.mpSession.enabled = true;
        run('mpReconcileRoster();');               // first pass seeds seenAt[p1]
        expect(rec.firestoreUpdates).toHaveLength(0);
        vi.setSystemTime(t0 + 9000);               // advance past rosterReapMs (8000)
        run('mpReconcileRoster();');
        expect(rec.firestoreUpdates).toHaveLength(1);
        expect(rec.firestoreUpdates[0]['players.p1']).toBe(sandbox.DELETE);
        expect(rec.track.some(([n]) => n === 'mp_ghost_reaped')).toBe(true);
        vi.useRealTimers();
    });

    it('NEVER reaps a slot whose child is live', () => {
        vi.useFakeTimers();
        const t0 = 2_000_000;
        vi.setSystemTime(t0);
        const { run, rec, sandbox } = makeCtx();
        sandbox.mpSession.roster = { p1: { name: 'Ann', alive: false, connected: true } };
        sandbox.mpSession.live = new Set(['p1']); // healthy live child
        sandbox.mpSession.enabled = true;
        run('mpReconcileRoster();');
        vi.setSystemTime(t0 + 20000);              // way past grace
        run('mpReconcileRoster();');
        expect(rec.firestoreUpdates).toHaveLength(0); // never evicted
        vi.useRealTimers();
    });

    it('does not reap mid-round (PLAYING)', () => {
        vi.useFakeTimers();
        const t0 = 3_000_000;
        vi.setSystemTime(t0);
        const { run, rec, sandbox } = makeCtx();
        sandbox.mpSession.roster = { p1: { name: 'Ann', alive: true, connected: true } };
        sandbox.mpSession.enabled = true;
        sandbox.gameState.currentState = 'playing';
        run('mpReconcileRoster();');
        vi.setSystemTime(t0 + 20000);
        run('mpReconcileRoster();');
        expect(rec.firestoreUpdates).toHaveLength(0);
        vi.useRealTimers();
    });
});

describe('M12 (b) alive-aware reconnect (host mpOnControllerLive)', () => {
    it('does NOT restore connected:true for an eliminated arena player mid-round', () => {
        const { run, rec, sandbox } = makeCtx();
        sandbox.gameState.mode = 'multi';
        sandbox.gameState.currentState = 'playing';
        sandbox.mpSession.roster = { p2: { name: 'Bo', alive: false, connected: false } };
        run('mpOnControllerLive("p2");');
        // No connected:true write; a reconnect-blocked event fires.
        const restored = rec.firestoreUpdates.some((u) => u['players.p2.connected'] === true);
        expect(restored).toBe(false);
        expect(rec.track.some(([n]) => n === 'mp_reconnect_blocked')).toBe(true);
    });

    it('DOES restore connected for a still-alive reconnecting player', () => {
        const { run, rec, sandbox } = makeCtx();
        sandbox.gameState.mode = 'multi';
        sandbox.gameState.currentState = 'playing';
        sandbox.mpSession.roster = { p2: { name: 'Bo', alive: true, connected: false } };
        run('mpOnControllerLive("p2");');
        const restored = rec.firestoreUpdates.some((u) => u['players.p2.connected'] === true);
        expect(restored).toBe(true);
    });

    it('SOLO round: alive===false p1 reconnect still restores connected (no solo regression)', () => {
        const { run, rec, sandbox } = makeCtx();
        sandbox.gameState.mode = 'solo'; // 1-player classic round
        sandbox.gameState.currentState = 'playing';
        sandbox.mpSession.roster = { p1: { name: 'Ann', alive: false, connected: false } };
        run('mpOnControllerLive("p1");');
        const restored = rec.firestoreUpdates.some((u) => u['players.p1.connected'] === true);
        expect(restored).toBe(true);
        expect(rec.track.some(([n]) => n === 'mp_reconnect_blocked')).toBe(false);
    });
});

describe('M12 (d) phone host-staleness watchdog', () => {
    it('flips to stale after hostStaleMs of no fresh snapshot, self-heals on a fresh one', () => {
        vi.useFakeTimers();
        const t0 = 5_000_000;
        vi.setSystemTime(t0);
        const { run, rec, sandbox } = makeCtx();
        // Simulate a fresh PLAYING snapshot: record host activity + start the watch.
        run('syncedGameState = "playing";');
        sandbox.mpClient.lastHostActivityAt = t0;
        run('mpClientStartHostWatch();');
        // Not yet stale.
        vi.advanceTimersByTime(4000);
        expect(sandbox.mpClient.hostStale).toBe(false);
        // Past the threshold with no new snapshot → stale.
        vi.advanceTimersByTime(10000); // now t0+14000, gap 14000 > 12000
        expect(sandbox.mpClient.hostStale).toBe(true);
        expect(rec.track.some(([n]) => n === 'mp_host_stale')).toBe(true);
        // A fresh snapshot clears it.
        sandbox.mpClient.lastHostActivityAt = Date.now();
        run('mpClientClearHostStale();');
        expect(sandbox.mpClient.hostStale).toBe(false);
        run('mpClientStopHostWatch();');
        vi.useRealTimers();
    });

    it('never flags a host that keeps the activity time fresh', () => {
        vi.useFakeTimers();
        const t0 = 6_000_000;
        vi.setSystemTime(t0);
        const { run, sandbox } = makeCtx();
        run('syncedGameState = "playing";');
        sandbox.mpClient.lastHostActivityAt = t0;
        run('mpClientStartHostWatch();');
        // Every 2s the "host" writes (refresh lastHostActivityAt), so it never goes stale.
        for (let i = 0; i < 20; i++) {
            vi.advanceTimersByTime(2000);
            sandbox.mpClient.lastHostActivityAt = Date.now();
        }
        expect(sandbox.mpClient.hostStale).toBe(false);
        run('mpClientStopHostWatch();');
        vi.useRealTimers();
    });
});
