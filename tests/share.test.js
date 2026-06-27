// Unit test for shareUrl() — pins the share-attribution UTM tags and guarantees the
// shared link never leaks a session/code. share.js reads the global `location` at call
// time (inside the function), so a stub set before invocation is enough; default Node
// env has no `location`.
import { describe, it, expect, beforeAll } from 'vitest';
import share from '../public/js/share.js';

const { shareUrl } = share;

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
