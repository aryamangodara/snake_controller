// Firebase security-rules contract suite — the ONLY emulator-backed test.
//
// WHY THIS FILE IS ISOLATED FROM `npm test`
// -----------------------------------------
// The app has no auth: its entire access-control model lives in `firestore.rules`
// and `database.rules.json`, and CI deploys both to prod on every master push.
// This suite asserts that contract BOTH ways (allow + deny) against the Firestore
// and Realtime Database emulators via `@firebase/rules-unit-testing`.
//
// The emulators need a JRE, which the fast unit job (and Java-less dev machines)
// do not have. So this file is EXCLUDED from the default `vitest run`:
//   - `vitest.config.js`        (used by `npm test`)      -> test.exclude lists this file.
//   - `vitest.rules.config.js`  (used by `npm run test:rules`) -> test.include is ONLY this file.
// `npm run test:rules` wraps the rules config in
//   `firebase emulators:exec --only firestore,database "vitest run --config vitest.rules.config.js"`
// so the emulators are up for the duration. That command runs in CI (GitHub
// runner has Java); it CANNOT run on a Java-less machine.
//
// The emulators load the REAL rule files via the `firestore.rules` /
// `database.rules` mappings in `firebase.json`, so what we test is exactly what
// ships. Rules are read from disk below to keep them in lockstep.
//
// NO PII / NO real session codes: every code here is a literal test fixture and
// is never emitted to analytics.
// `assertSucceeds`/`assertFails` resolve/reject for the contract, so no `expect`.
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    initializeTestEnvironment,
    assertSucceeds,
    assertFails,
} from '@firebase/rules-unit-testing';
import {
    doc,
    getDoc,
    setDoc,
    updateDoc,
    deleteDoc,
    serverTimestamp,
    Timestamp,
} from 'firebase/firestore';
import { ref, get, set } from 'firebase/database';

const ROOT = join(__dirname, '..');
const CODE = '123456'; // valid 6-digit fixture code (never a real session)

let testEnv;

// A single UNAUTHENTICATED context mirrors the no-auth model: the rules never
// read request.auth, so an anonymous client is the correct (and only) caller.
const db = () => testEnv.unauthenticatedContext().firestore();
const rtdb = () => testEnv.unauthenticatedContext().database();

// ----- Shape fixtures (exact key sets the rules allow) -----------------------

// A valid legacy/solo sessions/{code} doc: only the legacy key allowlist.
// Field CONTENT mirrors the real desktop create write (network.js:83-98):
// connected:bool, gameState:{active,score,state} (state in the GameState enum),
// version:number (Date.now()), feedback:{} map, lastActivity:timestamp. These
// shapes must pass the M7 content validators (validGameState / validFeedback).
const soloSession = () => ({
    created: Timestamp.now(),
    connected: true,
    gameState: { active: true, score: 0, state: 'waiting_for_start' },
    gameAction: null,
    lastActivity: Timestamp.now(),
    version: 2,
    feedback: {},
});

// A valid player sub-object (validPlayer): exact key set, all fields in range.
const validPlayer = () => ({
    name: 'Ace',
    token: 'tok-abc',
    score: 10,
    alive: true,
    connected: true,
    joinedAt: 123,
    death: null,
});

// A valid multiplayer sessions/{code} doc.
const multiSession = () => ({
    created: Timestamp.now(),
    mode: 'multi',
    players: { p1: validPlayer() },
    gameActions: { p1: 'start' },
    results: null,
});

// A valid leaderboard row. updatedAt MUST equal request.time -> serverTimestamp().
const validLeaderboard = (score = 50) => ({
    name: 'Ace',
    score,
    updatedAt: serverTimestamp(),
});

// ----- Lifecycle -------------------------------------------------------------

beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
        projectId: 'snake-rules-test',
        firestore: {
            rules: readFileSync(join(ROOT, 'firestore.rules'), 'utf8'),
            host: '127.0.0.1',
            port: 8080,
        },
        database: {
            rules: readFileSync(join(ROOT, 'database.rules.json'), 'utf8'),
            host: '127.0.0.1',
            port: 9000,
        },
    });
});

afterAll(async () => {
    if (testEnv) await testEnv.cleanup();
});

beforeEach(async () => {
    await testEnv.clearFirestore();
    await testEnv.clearDatabase();
});

// =============================================================================
// Firestore — sessions/{code}
//   read,delete : code.matches('^[0-9]{6}$')                 (firestore.rules:75)
//   create,update: code regex && validShape()                (firestore.rules:76)
// =============================================================================
describe('Firestore sessions/{code}', () => {
    it('allows create of a valid SOLO doc under a 6-digit code', async () => {
        await assertSucceeds(setDoc(doc(db(), 'sessions', CODE), soloSession()));
    });

    it('allows create of a valid MULTI doc (players.p1 + gameActions.p1:start)', async () => {
        await assertSucceeds(setDoc(doc(db(), 'sessions', CODE), multiSession()));
    });

    it('allows read under a 6-digit code (no validShape on read)', async () => {
        // Seed with rules disabled so the read is the thing under test.
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await setDoc(doc(ctx.firestore(), 'sessions', CODE), soloSession());
        });
        await assertSucceeds(getDoc(doc(db(), 'sessions', CODE)));
    });

    it('allows delete under a 6-digit code (open delete grant, no validShape)', async () => {
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await setDoc(doc(ctx.firestore(), 'sessions', CODE), soloSession());
        });
        await assertSucceeds(deleteDoc(doc(db(), 'sessions', CODE)));
    });

    it('denies create under a 5-digit code (regex)', async () => {
        await assertFails(setDoc(doc(db(), 'sessions', '12345'), soloSession()));
    });

    it('denies create under a 7-digit code (regex)', async () => {
        await assertFails(setDoc(doc(db(), 'sessions', '1234567'), soloSession()));
    });

    it('denies create under a non-numeric code (regex)', async () => {
        await assertFails(setDoc(doc(db(), 'sessions', 'abc123'), soloSession()));
    });

    it('denies an unknown top-level key (validShape key allowlist)', async () => {
        await assertFails(
            setDoc(doc(db(), 'sessions', CODE), { ...soloSession(), evil: true }),
        );
    });

    it("denies mode != 'multi'", async () => {
        await assertFails(
            setDoc(doc(db(), 'sessions', CODE), { created: Timestamp.now(), mode: 'solo' }),
        );
    });

    it('denies a player slot outside p1..p6 (players.p7)', async () => {
        await assertFails(
            setDoc(doc(db(), 'sessions', CODE), {
                ...multiSession(),
                players: { p7: validPlayer() },
            }),
        );
    });

    it('denies a player name longer than 16 chars', async () => {
        await assertFails(
            setDoc(doc(db(), 'sessions', CODE), {
                ...multiSession(),
                players: { p1: { ...validPlayer(), name: 'X'.repeat(17) } },
            }),
        );
    });

    it('denies a player score above 100000', async () => {
        await assertFails(
            setDoc(doc(db(), 'sessions', CODE), {
                ...multiSession(),
                players: { p1: { ...validPlayer(), score: 100001 } },
            }),
        );
    });

    it('denies a negative player score', async () => {
        await assertFails(
            setDoc(doc(db(), 'sessions', CODE), {
                ...multiSession(),
                players: { p1: { ...validPlayer(), score: -1 } },
            }),
        );
    });

    it('denies a non-bool alive field', async () => {
        await assertFails(
            setDoc(doc(db(), 'sessions', CODE), {
                ...multiSession(),
                players: { p1: { ...validPlayer(), alive: 'yes' } },
            }),
        );
    });

    it('denies an extra key inside a player object', async () => {
        await assertFails(
            setDoc(doc(db(), 'sessions', CODE), {
                ...multiSession(),
                players: { p1: { ...validPlayer(), extra: 1 } },
            }),
        );
    });

    it("denies a gameAction outside null|'start'|'restart' (p1:'pause')", async () => {
        await assertFails(
            setDoc(doc(db(), 'sessions', CODE), {
                ...multiSession(),
                gameActions: { p1: 'pause' },
            }),
        );
    });

    // ---- M7: content validators for the legacy solo fields -------------------
    // Seed a valid doc with rules disabled, then exercise the partial-update path
    // the app actually uses (network.js / mp-net.js write dotted fields, which
    // Firestore merges into the full doc before validShape() evaluates it).
    const sref = () => doc(db(), 'sessions', CODE);
    async function seedSession(data = soloSession()) {
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await setDoc(doc(ctx.firestore(), 'sessions', CODE), data);
        });
    }

    it('allows the solo gameState partial update (state+score) [network.js:574-577]', async () => {
        await seedSession();
        await assertSucceeds(
            updateDoc(sref(), {
                'gameState.state': 'playing',
                'gameState.score': 42,
                lastActivity: serverTimestamp(),
            }),
        );
    });

    // A 2-player roster: both slots are FULLY claimed (validPlayer) before any
    // per-slot score/feedback write targets them — exactly the real flow, where a
    // phone claims its slot (mp-client.js) before mp-net.js writes players.pN.score.
    const multiSession2 = () => ({
        ...multiSession(),
        players: { p1: validPlayer(), p2: validPlayer() },
    });

    it('allows the MP round-start update (gameState.state + per-slot reset) [mp-net.js:60-70]', async () => {
        await seedSession(multiSession2());
        await assertSucceeds(
            updateDoc(sref(), {
                'gameState.state': 'playing',
                results: null,
                'players.p1.alive': true,
                'players.p1.score': 0,
                lastActivity: serverTimestamp(),
            }),
        );
    });

    it('allows a solo flat feedback write { type, at } [network.js:599-602]', async () => {
        await seedSession();
        await assertSucceeds(
            updateDoc(sref(), {
                feedback: { type: 'food', at: 123456 },
                lastActivity: serverTimestamp(),
            }),
        );
    });

    it('allows a multiplayer slot-keyed feedback write feedback.p2 [mp-net.js:74-80]', async () => {
        await seedSession(multiSession2());
        await assertSucceeds(
            updateDoc(sref(), {
                'feedback.p2': { type: 'food', at: 123456 },
                'players.p2.score': 5,
                lastActivity: serverTimestamp(),
            }),
        );
    });

    it('allows the mobile connected:true update [controller.js:377-380]', async () => {
        await seedSession();
        await assertSucceeds(
            updateDoc(sref(), { connected: true, lastActivity: serverTimestamp() }),
        );
    });

    it("allows the mobile gameAction:'start' update [controller.js:633-635]", async () => {
        await seedSession();
        await assertSucceeds(
            updateDoc(sref(), { gameAction: 'start', lastActivity: serverTimestamp() }),
        );
    });

    // --- Negative: the new content bounds reject oversized / wrong-typed fields.

    it("denies gameState.state outside the enum ('cheating')", async () => {
        await assertFails(
            setDoc(sref(), {
                ...soloSession(),
                gameState: { active: true, score: 0, state: 'cheating' },
            }),
        );
    });

    it('denies gameState.score above 100000', async () => {
        await assertFails(
            setDoc(sref(), {
                ...soloSession(),
                gameState: { active: true, score: 9999999, state: 'playing' },
            }),
        );
    });

    it('denies a negative gameState.score', async () => {
        await assertFails(
            setDoc(sref(), {
                ...soloSession(),
                gameState: { active: true, score: -1, state: 'playing' },
            }),
        );
    });

    it('denies an unknown key inside gameState (gameState.evil)', async () => {
        await assertFails(
            setDoc(sref(), {
                ...soloSession(),
                gameState: { active: true, score: 0, state: 'playing', evil: 1 },
            }),
        );
    });

    it('denies a non-bool connected field (string)', async () => {
        await assertFails(setDoc(sref(), { ...soloSession(), connected: 'yes' }));
    });

    it('denies a non-number version field (string)', async () => {
        await assertFails(setDoc(sref(), { ...soloSession(), version: 'v2' }));
    });

    it('denies an oversized feedback map (> 6 keys, blob proxy)', async () => {
        await assertFails(
            setDoc(sref(), {
                ...soloSession(),
                feedback: { p1: 1, p2: 2, p3: 3, p4: 4, p5: 5, p6: 6, p7: 7 },
            }),
        );
    });

    it('denies a non-map feedback field (string)', async () => {
        await assertFails(setDoc(sref(), { ...soloSession(), feedback: 'x' }));
    });

    it('denies a non-timestamp lastActivity (number)', async () => {
        await assertFails(setDoc(sref(), { ...soloSession(), lastActivity: 123 }));
    });

    it("denies a legacy gameAction outside null|'start'|'restart' ('pause')", async () => {
        await assertFails(setDoc(sref(), { ...soloSession(), gameAction: 'pause' }));
    });
});

// =============================================================================
// Firestore — leaderboard/{playerId}
//   read   : true                                            (firestore.rules:93)
//   create : validLeaderboard(request.resource.data)         (firestore.rules:94)
//   update : validLeaderboard && score >= resource.score     (firestore.rules:95-96)
//   delete : false                                           (firestore.rules:97)
// =============================================================================
describe('Firestore leaderboard/{playerId}', () => {
    const lb = (id = 'device-1') => doc(db(), 'leaderboard', id);

    // Seed a row (rules disabled) so update/delete have an existing doc. The
    // seeded updatedAt is irrelevant to the rules on the *next* write.
    async function seed(id, score) {
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await setDoc(doc(ctx.firestore(), 'leaderboard', id), {
                name: 'Ace',
                score,
                updatedAt: Timestamp.fromMillis(1_000_000),
            });
        });
    }

    it('allows read for any client', async () => {
        await assertSucceeds(getDoc(lb()));
    });

    it('allows create with name(1-16), score in [0,100000], updatedAt=serverTimestamp()', async () => {
        await assertSucceeds(setDoc(lb(), validLeaderboard(50)));
    });

    it('denies create with score above 100000', async () => {
        await assertFails(setDoc(lb(), validLeaderboard(100001)));
    });

    it('denies create with a negative score', async () => {
        await assertFails(setDoc(lb(), validLeaderboard(-1)));
    });

    it('denies create with an empty name', async () => {
        await assertFails(setDoc(lb(), { ...validLeaderboard(50), name: '' }));
    });

    it('denies create with a name longer than 16 chars', async () => {
        await assertFails(setDoc(lb(), { ...validLeaderboard(50), name: 'X'.repeat(17) }));
    });

    it('denies create with an extra key', async () => {
        await assertFails(setDoc(lb(), { ...validLeaderboard(50), extra: 1 }));
    });

    it('denies create with a missing key (no score)', async () => {
        await assertFails(setDoc(lb(), { name: 'Ace', updatedAt: serverTimestamp() }));
    });

    it('denies create when updatedAt != request.time (fixed past Timestamp)', async () => {
        await assertFails(
            setDoc(lb(), { name: 'Ace', score: 50, updatedAt: Timestamp.fromMillis(1_000_000) }),
        );
    });

    it('allows an update RAISING the score (50 -> 80)', async () => {
        await seed('device-1', 50);
        await assertSucceeds(updateDoc(lb('device-1'), { name: 'Ace', score: 80, updatedAt: serverTimestamp() }));
    });

    it('allows an update with an EQUAL score (50 -> 50) [>= is inclusive]', async () => {
        await seed('device-1', 50);
        await assertSucceeds(updateDoc(lb('device-1'), { name: 'Ace', score: 50, updatedAt: serverTimestamp() }));
    });

    it('DENIES an update LOWERING the score (80 -> 30) [monotonic guard]', async () => {
        await seed('device-1', 80);
        await assertFails(updateDoc(lb('device-1'), { name: 'Ace', score: 30, updatedAt: serverTimestamp() }));
    });

    it('DENIES delete of any leaderboard doc', async () => {
        await seed('device-1', 80);
        await assertFails(deleteDoc(lb('device-1')));
    });
});

// =============================================================================
// RTDB — controllers/{$sessionId}
//   .read/.write : $sessionId.matches(/^[0-9]{6}$/)          (database.rules.json:5-6)
//   joystick x/y : isNumber && -1.01..1.01                   (database.rules.json:12-13,22-23)
//   $slot        : $slot.matches(/^p[1-6]$/)                 (database.rules.json:17)
//   joystick.$other / $slot.$other : .validate false         (database.rules.json:14,24,26)
// =============================================================================
describe('RTDB controllers/{$sessionId}', () => {
    const node = (path) => ref(rtdb(), `controllers/${path}`);

    it('allows a valid legacy-flat write under a 6-digit code', async () => {
        await assertSucceeds(
            set(node(CODE), {
                connected: true,
                joystick: { x: 0.5, y: -0.5 },
                timestamp: 123,
                initialized: true,
            }),
        );
    });

    it('allows a valid per-slot child write (p3)', async () => {
        await assertSucceeds(
            set(node(`${CODE}/p3`), {
                connected: true,
                joystick: { x: 1.0, y: -1.0 },
                timestamp: 123,
            }),
        );
    });

    it('allows read under a 6-digit code', async () => {
        await assertSucceeds(get(node(CODE)));
    });

    it('denies a write under a 5-digit code', async () => {
        await assertFails(
            set(ref(rtdb(), 'controllers/12345'), {
                connected: true,
                joystick: { x: 0, y: 0 },
                timestamp: 123,
            }),
        );
    });

    it('denies joystick x above the +1.01 clamp (flat)', async () => {
        await assertFails(
            set(node(CODE), { joystick: { x: 1.5, y: 0 }, timestamp: 123 }),
        );
    });

    it('denies joystick y below the -1.01 clamp (flat)', async () => {
        await assertFails(
            set(node(CODE), { joystick: { x: 0, y: -2 }, timestamp: 123 }),
        );
    });

    it('denies joystick x above the +1.01 clamp (per-slot)', async () => {
        await assertFails(
            set(node(`${CODE}/p2`), { joystick: { x: 1.5, y: 0 }, timestamp: 123 }),
        );
    });

    it('denies a slot key outside p[1-6] (p7)', async () => {
        await assertFails(
            set(node(`${CODE}/p7`), { joystick: { x: 0, y: 0 }, timestamp: 123 }),
        );
    });

    it('denies an unknown child inside joystick (joystick.z, flat)', async () => {
        await assertFails(
            set(node(CODE), { joystick: { x: 0, y: 0, z: 1 }, timestamp: 123 }),
        );
    });
});
