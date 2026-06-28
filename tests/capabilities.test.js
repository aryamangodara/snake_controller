// Cross-device capability smoke test (M13).
//
// The phone controller leans on a cluster of OPTIONAL browser APIs — Vibration,
// Web Share, async Clipboard, crypto.randomUUID, Web Audio, and touch/pointer
// events — each feature-detected ad hoc and (until now) untested. This suite
// CHARACTERIZES those production guards: for every capability it proves the
// code runs the happy path when the API is PRESENT and degrades to a safe,
// non-throwing no-op / fallback when it is ABSENT. A future edit that drops a
// guard (or assumes an API exists) turns one of these red before it ships.
//
// Harness: the same JSDOM + vm.runInContext bootstrap as tests/protocol.test.js
// — the real classic <script> files are evaluated into one shared lexical
// context, exactly like sequential <script> tags, with `firebase` stubbed to
// force offline mode. We then mutate navigator / window ON THE CONTEXT to toggle
// each capability before invoking the real guard. A fresh context is built per
// describe block so a deleted API never bleeds into a later assertion.
//
// NOTE: production sources are UNMODIFIED — every helper is reached through the
// shared context via `run()`, not an import, so no module.exports footer is
// required on controller.js / sound.js / leaderboard.js.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const PUB = join(__dirname, '..', 'public');
const HTML = readFileSync(join(PUB, 'index.html'), 'utf8');

// Build a JSDOM page with the given index.html script subset evaluated in
// order. Always load `utils` first (the guards call safeParse / debugLog), then
// the minimal prefix a capability needs. Mirrors protocol.test.js:makePage.
function makePage(scripts) {
    const dom = new JSDOM(HTML, { runScripts: 'outside-only', url: 'https://snake.test/' });
    const ctx = dom.getInternalVMContext();
    // Force offline mode (no retry timer): initializeApp throws, the catch in
    // config.js settles with firebaseReady = false.
    ctx.firebase = { initializeApp() { throw new Error('offline (test stub)'); } };
    for (const name of scripts) {
        const f = join(PUB, 'js', `${name}.js`);
        vm.runInContext(readFileSync(f, 'utf8'), ctx, { filename: f });
    }
    return {
        dom,
        // Run code inside the context and return its value.
        run: (code) => vm.runInContext(code, ctx),
        // Define a value on the context's `navigator` (configurable so a later
        // delete in the same context works).
        win: dom.window,
    };
}

// ---------------------------------------------------------------------------
// Vibration / haptics — controller.js triggerHaptic()
// ---------------------------------------------------------------------------
describe('Vibration / haptics (navigator.vibrate, with the iOS <input switch> fallback)', () => {
    let page;
    const SCRIPTS = ['utils', 'logic', 'config', 'state', 'leaderboard',
        'sound', 'effects', 'network', 'game', 'controller'];

    beforeEach(() => { page = makePage(SCRIPTS); });
    afterEach(() => { page.dom.window.close(); });

    it('guards the call site: triggerHaptic is wrapped in a typeof guard + try/catch', () => {
        // Source-level assertion of the guard's existence (defends against a
        // future edit that calls navigator.vibrate bare).
        const src = readFileSync(join(PUB, 'js', 'controller.js'), 'utf8');
        expect(src).toMatch(/typeof\s+navigator\.vibrate\s*===\s*['"]function['"]/);
        expect(src).toMatch(/try\s*\{[\s\S]*navigator\.vibrate[\s\S]*\}\s*catch/);
    });

    it('PRESENT: calls navigator.vibrate(pattern) and appends no <input switch>', () => {
        // index.html already ships its own <label>s, so the meaningful tell that
        // the native path was taken is that NO <input switch> was created and the
        // label count is unchanged from baseline.
        const baseLabels = page.run("document.querySelectorAll('label').length");
        page.run(`
            globalThis.__vibeArgs = [];
            navigator.vibrate = (p) => { globalThis.__vibeArgs.push(p); return true; };
            triggerHaptic(40);
        `);
        expect(page.run('globalThis.__vibeArgs')).toEqual([40]);
        // The native API path must NOT fall through to the DOM switch trick.
        expect(page.run("document.querySelectorAll('label').length")).toBe(baseLabels);
        expect(page.run("document.querySelectorAll('input[switch]').length")).toBe(0);
    });

    it('ABSENT (iOS path): no vibrate → creates+clicks a hidden <input switch>, then removes the label', () => {
        // index.html ships a few <label>s of its own; assert the count returns to
        // THAT baseline, not absolute 0 (the switch label must leave no residue).
        const baseLabels = page.run("document.querySelectorAll('label').length");
        page.run(`
            try { delete navigator.vibrate; } catch (e) { /* ignore */ }
            globalThis.__clicks = 0;
            // Observe the transient switch label by spying on appendChild.
            globalThis.__appended = [];
            const __origAppend = document.body.appendChild.bind(document.body);
            document.body.appendChild = function (node) {
                globalThis.__appended.push(node.tagName + (node.querySelector && node.querySelector('input[switch]') ? ':switch' : ''));
                return __origAppend(node);
            };
            // Count the synthetic click on the switch label.
            const __origClick = HTMLElement.prototype.click;
            HTMLElement.prototype.click = function () { globalThis.__clicks++; return __origClick.call(this); };
            globalThis.__threw = false;
            try { triggerHaptic([120, 60, 120]); } catch (e) { globalThis.__threw = true; }
        `);
        expect(page.run('typeof navigator.vibrate')).toBe('undefined');
        expect(page.run('globalThis.__threw')).toBe(false);
        // A hidden <label> wrapping an <input switch> was appended...
        expect(page.run('globalThis.__appended')).toContain('LABEL:switch');
        // ...the label was clicked...
        expect(page.run('globalThis.__clicks')).toBeGreaterThanOrEqual(1);
        // ...and removed in the finally block (no leaked switch DOM nodes).
        expect(page.run("document.querySelectorAll('label').length")).toBe(baseLabels);
        expect(page.run("document.querySelectorAll('input[switch]').length")).toBe(0);
    });

    it('THROWS: a vibrate that throws is swallowed — never throws into gameplay', () => {
        page.run(`
            navigator.vibrate = () => { throw new Error('boom'); };
            globalThis.__threw = false;
            try { triggerHaptic(40); } catch (e) { globalThis.__threw = true; }
        `);
        expect(page.run('globalThis.__threw')).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Web Share + async Clipboard — share.js shareToInstagram()
// ---------------------------------------------------------------------------
describe('Web Share + Clipboard (navigator.share, navigator.clipboard.writeText)', () => {
    let page;
    // share.js needs utils (trackEvent) + a minimal prefix; it reads location /
    // gameState lazily, so the protocol prefix is enough.
    const SCRIPTS = ['utils', 'logic', 'config', 'state', 'leaderboard',
        'sound', 'effects', 'network', 'game', 'controller', 'share'];

    beforeEach(() => { page = makePage(SCRIPTS); });
    afterEach(() => { page.dom.window.close(); });

    it('guards the call sites: share.js feature-detects navigator.share and navigator.clipboard.writeText', () => {
        const src = readFileSync(join(PUB, 'js', 'share.js'), 'utf8');
        expect(src).toMatch(/if\s*\(\s*navigator\.share\s*\)/);
        expect(src).toMatch(/navigator\.clipboard\s*&&\s*navigator\.clipboard\.writeText/);
    });

    it('PRESENT (Web Share): uses navigator.share({text,url}) and does NOT call window.open', () => {
        page.run(`
            globalThis.__shareArg = null;
            globalThis.__openCalls = 0;
            navigator.share = (arg) => { globalThis.__shareArg = arg; return Promise.resolve(); };
            window.open = () => { globalThis.__openCalls++; return {}; };
            shareToInstagram('hello', 'https://snake.test/');
        `);
        expect(page.run('globalThis.__shareArg')).toEqual({ text: 'hello', url: 'https://snake.test/' });
        expect(page.run('globalThis.__openCalls')).toBe(0);
    });

    it('ABSENT share + PRESENT clipboard: writes "text url" to the clipboard and opens instagram.com', () => {
        page.run(`
            try { delete navigator.share; } catch (e) { /* ignore */ }
            globalThis.__clip = null;
            globalThis.__openUrl = null;
            Object.defineProperty(navigator, 'clipboard', {
                configurable: true,
                value: { writeText: (s) => { globalThis.__clip = s; return Promise.resolve(); } },
            });
            window.open = (u) => { globalThis.__openUrl = u; return {}; };
            globalThis.__threw = false;
            try { shareToInstagram('hello', 'https://snake.test/'); } catch (e) { globalThis.__threw = true; }
        `);
        expect(page.run('globalThis.__threw')).toBe(false);
        expect(page.run('globalThis.__clip')).toBe('hello https://snake.test/');
        expect(page.run('globalThis.__openUrl')).toBe('https://www.instagram.com/');
    });

    it('ABSENT share + ABSENT clipboard: does not throw and still opens instagram.com (toast branch)', () => {
        page.run(`
            try { delete navigator.share; } catch (e) { /* ignore */ }
            Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
            globalThis.__openUrl = null;
            window.open = (u) => { globalThis.__openUrl = u; return {}; };
            globalThis.__threw = false;
            try { shareToInstagram('hello', 'https://snake.test/'); } catch (e) { globalThis.__threw = true; }
        `);
        expect(page.run('globalThis.__threw')).toBe(false);
        expect(page.run('globalThis.__openUrl')).toBe('https://www.instagram.com/');
    });
});

// ---------------------------------------------------------------------------
// Web Audio — sound.js getAudioContext() / playTone()
// ---------------------------------------------------------------------------
describe('Web Audio (AudioContext / webkitAudioContext)', () => {
    let page;
    const SCRIPTS = ['utils', 'logic', 'config', 'state', 'leaderboard', 'sound'];

    beforeEach(() => { page = makePage(SCRIPTS); });
    afterEach(() => { page.dom.window.close(); });

    it('guards the call site: sound.js reads AudioContext||webkitAudioContext behind an if (AC)', () => {
        const src = readFileSync(join(PUB, 'js', 'sound.js'), 'utf8');
        expect(src).toMatch(/window\.AudioContext\s*\|\|\s*window\.webkitAudioContext/);
        expect(src).toMatch(/if\s*\(\s*AC\s*\)/);
    });

    it('PRESENT: getAudioContext() constructs once and memoizes the instance', () => {
        page.run(`
            globalThis.__ctorCount = 0;
            window.AudioContext = function () { globalThis.__ctorCount++; this.state = 'running'; };
            globalThis.__a = getAudioContext();
            globalThis.__b = getAudioContext();
        `);
        expect(page.run('globalThis.__ctorCount')).toBe(1);
        expect(page.run('globalThis.__a === globalThis.__b')).toBe(true);
        expect(page.run('globalThis.__a != null')).toBe(true);
    });

    it('ABSENT: no constructor → getAudioContext() is falsy and playTone() is a non-throwing no-op', () => {
        page.run(`
            try { delete window.AudioContext; } catch (e) { window.AudioContext = undefined; }
            try { delete window.webkitAudioContext; } catch (e) { window.webkitAudioContext = undefined; }
            globalThis.__ctx = getAudioContext();
            globalThis.__threw = false;
            try { playTone(660, 100); } catch (e) { globalThis.__threw = true; }
        `);
        expect(page.run('globalThis.__ctx')).toBeFalsy();
        expect(page.run('globalThis.__threw')).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// crypto.randomUUID — leaderboard.js getPlayerId()
// ---------------------------------------------------------------------------
describe('crypto.randomUUID (per-device id, with a Date.now()/Math.random() fallback)', () => {
    let page;
    const SCRIPTS = ['utils', 'logic', 'config', 'state', 'leaderboard'];

    beforeEach(() => { page = makePage(SCRIPTS); });
    afterEach(() => { page.dom.window.close(); });

    it('guards the call site: leaderboard.js gates crypto.randomUUID and has a non-UUID fallback', () => {
        const src = readFileSync(join(PUB, 'js', 'leaderboard.js'), 'utf8');
        expect(src).toMatch(/window\.crypto\s*&&\s*crypto\.randomUUID/);
        expect(src).toMatch(/'p-'/);
    });

    it('PRESENT: getPlayerId() returns the UUID and persists it under PLAYER_ID_KEY', () => {
        page.run(`
            localStorage.removeItem(PLAYER_ID_KEY);
            // jsdom defines window.crypto as a non-writable accessor, so a plain
            // assignment is ignored — redefine the property instead.
            Object.defineProperty(window, 'crypto', {
                configurable: true,
                value: { randomUUID: () => 'uuid-1234-5678' },
            });
            globalThis.__id = getPlayerId();
            globalThis.__stored = localStorage.getItem(PLAYER_ID_KEY);
        `);
        expect(page.run('globalThis.__id')).toBe('uuid-1234-5678');
        expect(page.run('globalThis.__stored')).toBe('uuid-1234-5678');
    });

    it('ABSENT: no crypto.randomUUID → returns a non-empty "p-…" fallback id and still persists', () => {
        page.run(`
            localStorage.removeItem(PLAYER_ID_KEY);
            // jsdom's crypto.randomUUID is non-configurable, so a delete is a no-op;
            // redefine window.crypto to an object WITHOUT randomUUID instead. crypto
            // stays truthy, so (window.crypto && crypto.randomUUID) falls to its else.
            Object.defineProperty(window, 'crypto', { configurable: true, value: {} });
            globalThis.__id = getPlayerId();
            globalThis.__stored = localStorage.getItem(PLAYER_ID_KEY);
        `);
        const id = page.run('globalThis.__id');
        expect(typeof id).toBe('string');
        expect(id.startsWith('p-')).toBe(true);
        expect(id.length).toBeGreaterThan(2);
        expect(page.run('globalThis.__stored')).toBe(id);
    });
});

// ---------------------------------------------------------------------------
// Touch / pointer normalization — controller.js getPointerPosition()
// ---------------------------------------------------------------------------
describe('Touch / pointer normalization (getPointerPosition)', () => {
    let page;
    const SCRIPTS = ['utils', 'logic', 'config', 'state', 'leaderboard',
        'sound', 'effects', 'network', 'game', 'controller'];

    beforeEach(() => { page = makePage(SCRIPTS); });
    afterEach(() => { page.dom.window.close(); });

    it('guards both shapes: reads clientX/Y for mouse, touches[0] for touch, else null', () => {
        const src = readFileSync(join(PUB, 'js', 'controller.js'), 'utf8');
        // typeof guard for the mouse branch + a touches length check for the touch branch.
        expect(src).toMatch(/typeof\s+e\.clientX\s*===\s*['"]number['"]/);
        expect(src).toMatch(/e\.touches\s*&&\s*e\.touches\.length/);
    });

    it('mouse event → {x,y} from clientX/clientY', () => {
        page.run('globalThis.__p = getPointerPosition({ clientX: 12, clientY: 34 });');
        expect(page.run('globalThis.__p')).toEqual({ x: 12, y: 34 });
    });

    it('touch event → {x,y} from touches[0]', () => {
        page.run('globalThis.__p = getPointerPosition({ touches: [{ clientX: 56, clientY: 78 }] });');
        expect(page.run('globalThis.__p')).toEqual({ x: 56, y: 78 });
    });

    it('neither clientX/Y nor touches → null (no throw)', () => {
        page.run('globalThis.__p = getPointerPosition({});');
        expect(page.run('globalThis.__p')).toBe(null);
        // An empty touch list also degrades to null, not touches[0] of undefined.
        page.run('globalThis.__p2 = getPointerPosition({ touches: [] });');
        expect(page.run('globalThis.__p2')).toBe(null);
    });
});
