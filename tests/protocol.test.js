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
});
