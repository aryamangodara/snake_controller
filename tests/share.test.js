// Unit test for shareUrl() — pins the share-attribution UTM tags and guarantees the
// shared link never leaks a session/code. share.js reads the global `location` at call
// time (inside the function), so a stub set before invocation is enough; default Node
// env has no `location`.
import { describe, it, expect, beforeAll } from 'vitest';
import share from '../public/js/share.js';

const { shareUrl, buildShareText } = share;

beforeAll(() => {
    // Match the protocol test's url shape (origin + root path, no query).
    globalThis.location = { origin: 'https://snake.test', pathname: '/' };
});

describe('shareUrl', () => {
    it('tags the shared URL with share attribution UTM params', () => {
        const url = new URL(shareUrl());
        expect(url.searchParams.get('utm_source')).toBe('share');
        expect(url.searchParams.get('utm_medium')).toBe('social');
    });

    it('preserves the origin + path of the live page', () => {
        const url = new URL(shareUrl());
        expect(`${url.origin}${url.pathname}`).toBe(
            `${location.origin}${location.pathname}`,
        );
    });

    it('never leaks a session or the 6-digit code', () => {
        const url = new URL(shareUrl());
        expect(url.searchParams.has('session')).toBe(false);
        // No 6-digit numeric code anywhere in the query string.
        expect(/\d{6}/.test(url.search)).toBe(false);
    });
});

describe('buildShareText', () => {
    it('solo (no context) → the classic "I scored N" caption', () => {
        const text = buildShareText(120);
        expect(text).toContain('I scored 120');
        expect(text).not.toMatch(/defeated|got me|crashed/);
    });

    it("winner with named victims → 'I defeated A & B'", () => {
        const text = buildShareText(200, { outcome: 'winner', defeated: ['Ann', 'Bo'] });
        expect(text).toContain('I defeated Ann & Bo');
        expect(text).toContain('200');
    });

    it("winner with an empty defeated list → 'I defeated everyone'", () => {
        const text = buildShareText(200, { outcome: 'winner', defeated: [] });
        expect(text).toContain('I defeated everyone');
    });

    it("eliminated by a named rival → '<name> got me this time'", () => {
        const text = buildShareText(80, { outcome: 'eliminated', by: 'Cy' });
        expect(text).toContain('Cy got me this time');
        expect(text).toContain('80');
    });

    it("eliminated with no attributed rival (by:null) → 'I crashed out'", () => {
        const text = buildShareText(80, { outcome: 'eliminated', by: null });
        expect(text).toContain('I crashed out at 80');
    });
});
