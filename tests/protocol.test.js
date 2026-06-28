// Protocol smoke test — exercises the desktop ↔ controller sync protocol end-to-end
// through the localStorage fallback mode, with the production scripts UNMODIFIED.
//
// Harness: two separate JSDOM windows ("desktop" and "controller"), each loaded with
// the real index.html markup. The classic <script> files are evaluated into each
// window's vm context with vm.runInContext, which shares the global *lexical*
// environment across scripts exactly like sequential <script> tags (a plain eval /
// new Function approach would not share top-level let/const such as gameState).
//
// Browsers fire the 'storage' event only in OTHER documents, so a bridge mirrors
// every localStorage.setItem into the peer window and dispatches a StorageEvent
// there — same semantics as two tabs sharing one origin. Delivery is synchronous,
// so assertions need no async waits.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import logic from '../public/js/logic.js';

const PUB = join(__dirname, '..', 'public');
// index.html order, minus main.js (we drive init manually), leaderboard-ui.js and
// share.js (DOMContentLoaded / typeof-guarded wiring, unused on this path).
const SCRIPTS = [
    'utils', 'logic', 'config', 'state', 'leaderboard',
    'sound', 'effects', 'network', 'game', 'controller',
].map((n) => join(PUB, 'js', `${n}.js`));
const HTML = readFileSync(join(PUB, 'index.html'), 'utf8');

const SESSION = '123456';

function makePage() {
    // A real url is required or window.localStorage throws (opaque origin).
    const dom = new JSDOM(HTML, { runScripts: 'outside-only', url: 'https://snake.test/' });
    const ctx = dom.getInternalVMContext();
    // Force offline mode WITHOUT config.js's retry timer: `firebase` is defined, so
    // initializeFirebase() runs once, initializeApp throws, and the catch settles
    // with firebaseReady = false.
    ctx.firebase = { initializeApp() { throw new Error('offline (test stub)'); } };
    for (const f of SCRIPTS) {
        vm.runInContext(readFileSync(f, 'utf8'), ctx, { filename: f });
    }
    // Top-level let/const live in the context's global lexical env — readable only
    // by evaluating code inside the context, not as properties on `ctx`.
    return { dom, run: (code) => vm.runInContext(code, ctx) };
}

// Mirror each window's localStorage writes into the peer and fire a StorageEvent
// there. Patch Storage.prototype (NOT the instance — Storage's spec'd named-property
// setter would turn an instance `setItem` assignment into a stored item), and have
// each side call the peer's saved ORIGINAL to avoid infinite ping-pong.
function bridgeStorage(a, b) {
    const pa = a.dom.window.Storage.prototype;
    const pb = b.dom.window.Storage.prototype;
    const origA = pa.setItem;
    const origB = pb.setItem;
    const deliver = (page, orig, key, value) => {
        const w = page.dom.window;
        const oldValue = w.localStorage.getItem(key);
        orig.call(w.localStorage, key, String(value));
        w.dispatchEvent(new w.StorageEvent('storage', {
            key, oldValue, newValue: String(value), storageArea: w.localStorage,
        }));
    };
    pa.setItem = function (k, v) { origA.call(this, k, v); deliver(b, origB, k, v); };
    pb.setItem = function (k, v) { origB.call(this, k, v); deliver(a, origA, k, v); };
}

describe('desktop ↔ controller protocol (localStorage fallback mode)', () => {
    let desktop, controller;
    const $ = (page, sel) => page.dom.window.document.querySelector(sel);

    beforeAll(() => {
        desktop = makePage();
        controller = makePage();
        bridgeStorage(desktop, controller);

        // Desktop host side (what generateNewSession does, minus QR/Firebase).
        desktop.run(`sessionManager.currentSession = '${SESSION}';`);
        desktop.run(`setupLocalStorageSession('${SESSION}');`);

        // Controller side. firebaseReady is false, so attemptConnection goes straight
        // to connectViaLocalStorage, which reads the mirrored 'currentSession' key.
        controller.run('sessionManager.isDesktop = false;');
        controller.run(`connectToSession('${SESSION}');`);
    });

    afterAll(() => {
        // Clears pending timers (gameOver's 150ms hitstop, name-entry focus) so
        // vitest can exit.
        desktop.dom.window.close();
        controller.dom.window.close();
    });

    it('connects the controller and shows the ready state', () => {
        expect(controller.run('sessionManager.connectedSession')).toBe(SESSION);
        expect(controller.run('sessionManager.connectionType')).toBe('localStorage');
        expect($(controller, '#connection-form').style.display).toBe('none');
        expect($(controller, '#controller-interface').style.display).toBe('block');
        expect($(controller, '#btn-center .center-icon').textContent).toBe('▶');
        expect($(controller, '#btn-center').disabled).toBe(false);
        expect($(controller, '#mobile-game-over').classList.contains('hidden')).toBe(true);
        expect(desktop.run('gameState.currentState')).toBe('waiting_for_start');
    });

    it('ignores joystick input before the game starts', () => {
        controller.run('sendJoystickInput(1, 0);');
        expect(desktop.run('gameState.targetDirection')).toBe(0);
        expect(desktop.run('gameState.currentSpeed')).toBe(desktop.run('gameState.baseSpeed'));
    });

    it('starts the game from the controller center button', () => {
        controller.run('handleCenterButtonPress();');
        expect(desktop.run('gameState.currentState')).toBe('playing');
        // The desktop's state push round-trips back to the controller UI.
        expect($(controller, '#btn-center .center-icon').textContent).toBe('🐍');
        expect($(controller, '#btn-center').disabled).toBe(true);
    });

    it('steers the snake from controller joystick input', () => {
        controller.run('sendJoystickInput(0, -1);');
        const expected = logic.joystickToControl(
            { x: 0, y: -1 },
            desktop.run('gameState.baseSpeed'),
            { maxSpeedBoost: desktop.run('gameConfig.maxSpeedBoost') },
        );
        expect(desktop.run('gameState.targetDirection')).toBeCloseTo(expected.targetDirection);
        expect(desktop.run('gameState.currentSpeed')).toBeCloseTo(expected.speed);

        // Releasing the stick: coast at base speed, heading retained.
        controller.run('sendJoystickInput(0, 0);');
        expect(desktop.run('gameState.currentSpeed')).toBe(desktop.run('gameState.baseSpeed'));
        expect(desktop.run('gameState.targetDirection')).toBeCloseTo(expected.targetDirection);
    });

    it('change-gates a held stick: only the first of N identical sends writes', () => {
        // Count writes to the joystick key by wrapping Storage.prototype.setItem on the
        // controller window (the instance setter would store an item, not override the
        // method — see bridgeStorage's note). Chain through the bridge's existing wrap.
        controller.run(`
            globalThis.__jsWrites = 0;
            const __proto = window.Storage.prototype;
            globalThis.__lsOrig = __proto.setItem;
            __proto.setItem = function (k, v) {
                if (k === 'session_${SESSION}_joystick') globalThis.__jsWrites++;
                return globalThis.__lsOrig.call(this, k, v);
            };
        `);
        // Settle on a fresh vector, then hold it steady across many sends.
        controller.run('sendJoystickInput(0.5, -0.5);'); // first send → 1 write
        for (let i = 0; i < 10; i++) controller.run('sendJoystickInput(0.5, -0.5);'); // held → 0 writes
        expect(controller.run('globalThis.__jsWrites')).toBe(1);

        // A sub-epsilon nudge is still gated; an above-epsilon move writes once more.
        controller.run('sendJoystickInput(0.51, -0.5);'); // Δ ~0.01 < epsilon → dropped
        expect(controller.run('globalThis.__jsWrites')).toBe(1);
        controller.run('sendJoystickInput(0.7, -0.5);');  // Δ 0.2 ≥ epsilon → written
        expect(controller.run('globalThis.__jsWrites')).toBe(2);

        // Restore the bridge's setItem so later tests are unaffected.
        controller.run('window.Storage.prototype.setItem = globalThis.__lsOrig;');
    });

    it('uses a client Date.now() number stamp (no server sentinel) on the joystick packet', () => {
        controller.run('sendJoystickInput(-0.3, 0.6);');
        const raw = controller.run(`localStorage.getItem('session_${SESSION}_joystick')`);
        const pkt = JSON.parse(raw);
        expect(typeof pkt.timestamp).toBe('number');
        expect(Number.isFinite(pkt.timestamp)).toBe(true);
    });

    it('host drops an out-of-order (older-stamp) joystick packet', () => {
        // Apply a fresh packet at stamp T, capture the resulting heading.
        const tNow = Date.now() + 1000;
        controller.run(`localStorage.setItem('session_${SESSION}_joystick', JSON.stringify({ joystick: { x: 1, y: 0 }, timestamp: ${tNow} }));`);
        const headingAfterFresh = desktop.run('gameState.targetDirection');

        // A LATER-arriving but OLDER-stamped packet (different heading) must be ignored.
        controller.run(`localStorage.setItem('session_${SESSION}_joystick', JSON.stringify({ joystick: { x: 0, y: 1 }, timestamp: ${tNow - 500} }));`);
        expect(desktop.run('gameState.targetDirection')).toBeCloseTo(headingAfterFresh);

        // A NEWER-stamped packet is applied normally.
        controller.run(`localStorage.setItem('session_${SESSION}_joystick', JSON.stringify({ joystick: { x: 0, y: 1 }, timestamp: ${tNow + 500} }));`);
        expect(desktop.run('gameState.targetDirection')).toBeCloseTo(Math.PI / 2);
    });

    it('syncs game over to the controller share card', () => {
        // Drive the real collision path: park the head inside the wall margin and step.
        desktop.run('gameState.score = 40;');
        desktop.run('gameState.snake[0] = { x: 5, y: 300 };');
        desktop.run('moveSnake();');

        expect(desktop.run('gameState.currentState')).toBe('game_over');
        expect($(controller, '#btn-center .center-icon').textContent).toBe('↻');
        expect($(controller, '#btn-center').disabled).toBe(false);
        expect($(controller, '#mobile-game-over').classList.contains('hidden')).toBe(false);
        // Score arrives purely through the JSON payload (separate windows, so this
        // is not tautological).
        expect($(controller, '#mobile-final-score').textContent).toBe('40');
    });

    it('restarts from the controller and resets desktop state', () => {
        controller.run('handleCenterButtonPress();');

        expect(desktop.run('gameState.currentState')).toBe('playing');
        expect(desktop.run('gameState.score')).toBe(0);
        expect(desktop.run('gameState.snake.length')).toBe(5);
        expect($(controller, '#btn-center .center-icon').textContent).toBe('🐍');
        expect($(controller, '#mobile-game-over').classList.contains('hidden')).toBe(true);
        // The desktop consumed the one-shot action key after handling it.
        expect(desktop.run(`localStorage.getItem('session_${SESSION}_action')`)).toBe(null);
    });

    it('client-debounces a rapid duplicate action to a single transport write', () => {
        // Reset the in-memory debounce guard so the prior test's 'restart' (sent via
        // handleCenterButtonPress) doesn't bleed into this synchronous, sub-window run.
        controller.run("lastActionSent = { action: null, at: 0 };");
        // Count writes to the action key by wrapping Storage.prototype.setItem on the
        // controller window (same technique as the joystick change-gate test above).
        controller.run(`
            globalThis.__actWrites = 0;
            globalThis.__actOrig = window.Storage.prototype.setItem;
            window.Storage.prototype.setItem = function (k, v) {
                if (k === 'session_${SESSION}_action') globalThis.__actWrites++;
                return globalThis.__actOrig.call(this, k, v);
            };
        `);

        // Two identical actions back-to-back within actionDebounceMs → ONE write.
        controller.run("sendGameAction('restart'); sendGameAction('restart');");
        expect(controller.run('globalThis.__actWrites')).toBe(1);

        // A DIFFERENT action inside the window is keyed separately → it DOES emit.
        controller.run("sendGameAction('start');");
        expect(controller.run('globalThis.__actWrites')).toBe(2);

        // The guard is a WINDOW, not a one-shot lock: with the window collapsed to 0,
        // the same action emits again (proves the time-boundary branch).
        controller.run('gameConfig.actionDebounceMs = 0;');
        controller.run("sendGameAction('start');");
        expect(controller.run('globalThis.__actWrites')).toBe(3);

        // Restore the window + the bridge's setItem so later state is unaffected.
        controller.run('gameConfig.actionDebounceMs = 400;');
        controller.run('window.Storage.prototype.setItem = globalThis.__actOrig;');
    });

    it('host ignore-window collapses a repeated solo action to one handled call', () => {
        // Reset the host idempotency guard so the prior test's handled 'restart' doesn't
        // wrongly suppress this test's first 'restart' (synchronous, sub-window run).
        desktop.run('lastSoloAction = { action: null, at: 0, fired: false };');
        // Drive the desktop into game over so a 'restart' is actionable.
        desktop.run('gameState.currentState = GameState.GAME_OVER;');
        let restarts = 0;
        // Count restartGame invocations via a wrapper on the context's global function.
        desktop.run(`
            globalThis.__restarts = 0;
            globalThis.__restartOrig = restartGame;
            restartGame = function () { globalThis.__restarts++; return globalThis.__restartOrig.apply(this, arguments); };
        `);

        // Repeated identical action inside actionIgnoreMs → handled ONCE.
        desktop.run("handleGameActionFromMobile('restart'); handleGameActionFromMobile('restart');");
        restarts = desktop.run('globalThis.__restarts');
        expect(restarts).toBe(1);
        expect(desktop.run('gameState.currentState')).toBe('playing');

        // Restore restartGame.
        desktop.run('restartGame = globalThis.__restartOrig;');
    });
});
