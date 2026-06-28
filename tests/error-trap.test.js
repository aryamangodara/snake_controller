// Unit tests for reportError (utils.js) — the hardened error-reporting helper behind the
// Q7 global error trap. Asserts it NEVER throws (it sits on the error path), clamps the
// error name, and — critically — leaks NO raw message/stack into the GA4 params.
//
// reportError → trackEvent → analytics.logEvent. trackEvent reads the free global
// `analytics` at call time, so we stub a global analytics with a logEvent spy to inspect
// exactly what params are emitted, and clear it to exercise the offline/no-consent no-op.
import { describe, it, expect, afterEach, vi } from 'vitest';
import utils from '../public/js/utils.js';

const { reportError } = utils;

afterEach(() => {
    // Remove any analytics stub so the next test starts from the offline (no-op) state.
    delete globalThis.analytics;
    vi.restoreAllMocks();
});

describe('reportError — hardening (never throws)', () => {
    it('does not throw when analytics is undefined (offline / ad-block / no consent)', () => {
        expect(globalThis.analytics).toBeUndefined();
        expect(() => reportError('window_error', new TypeError('boom'))).not.toThrow();
    });

    it('does not throw on non-Error inputs', () => {
        expect(() => reportError('x', undefined)).not.toThrow();
        expect(() => reportError('x', null)).not.toThrow();
        expect(() => reportError('x', 'a string')).not.toThrow();
        expect(() => reportError('x', {})).not.toThrow();
        expect(() => reportError('x', 42)).not.toThrow();
    });

    it('does not throw even when the analytics.logEvent handle itself throws', () => {
        globalThis.analytics = { logEvent: () => { throw new Error('analytics blew up'); } };
        expect(() => reportError('raf_loop', new Error('y'), { mode: 1 })).not.toThrow();
    });
});

describe('reportError — bounded, low-cardinality params', () => {
    it('emits a js_error event with reason + clamped error_name and NO raw message/stack', () => {
        const logEvent = vi.fn();
        globalThis.analytics = { logEvent };
        // A long error name + a sensitive message that must NOT appear in params.
        const err = new TypeError('user@example.com session 123456 secret-stack');
        err.name = 'X'.repeat(100); // overlong name to test the 40-char clamp

        reportError('window_error', err, { source_line: 7 });

        expect(logEvent).toHaveBeenCalledTimes(1);
        const [name, params] = logEvent.mock.calls[0];
        expect(name).toBe('js_error');
        expect(params.reason).toBe('window_error');
        expect(params.source_line).toBe(7);

        // error_name is the clamped constructor name, never the message.
        expect(params.error_name.length).toBeLessThanOrEqual(40);

        // No unbounded / PII-bearing keys leaked.
        expect(params).not.toHaveProperty('message');
        expect(params).not.toHaveProperty('stack');

        // No param value carries the raw message text or the 6-digit code.
        const serialized = JSON.stringify(params);
        expect(serialized).not.toContain('user@example.com');
        expect(serialized).not.toContain('123456');
        expect(serialized).not.toContain('secret-stack');
    });

    it('falls back to the "Error" name when the value has no name', () => {
        const logEvent = vi.fn();
        globalThis.analytics = { logEvent };
        reportError('unhandled_rejection', 'just a string reason');
        const [, params] = logEvent.mock.calls[0];
        expect(params.error_name).toBe('Error');
    });

    it('no-ops (no logEvent) when analytics is absent', () => {
        // No analytics stub set → trackEvent returns early; nothing to assert beyond no-throw.
        expect(() => reportError('firestore_listener', new Error('z'))).not.toThrow();
    });
});
