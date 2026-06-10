import { describe, it, expect } from 'vitest';
import utils from '../public/js/utils.js';

const { safeParse, sanitizeName } = utils;

describe('safeParse', () => {
    it('parses valid JSON', () => {
        expect(safeParse('{"a":1}')).toEqual({ a: 1 });
        expect(safeParse('[1,2,3]')).toEqual([1, 2, 3]);
    });

    it('returns the fallback for empty input', () => {
        expect(safeParse('')).toEqual({});
        expect(safeParse(null, [])).toEqual([]);
        expect(safeParse(undefined, 'x')).toBe('x');
    });

    it('returns the fallback for malformed JSON', () => {
        expect(safeParse('{nope', { ok: true })).toEqual({ ok: true });
        expect(safeParse('[1,2,', [])).toEqual([]);
    });
});

describe('sanitizeName', () => {
    it('rejects non-strings', () => {
        expect(sanitizeName(null)).toBeNull();
        expect(sanitizeName(undefined)).toBeNull();
        expect(sanitizeName(42)).toBeNull();
        expect(sanitizeName({})).toBeNull();
    });

    it('rejects blank / whitespace-only input', () => {
        expect(sanitizeName('')).toBeNull();
        expect(sanitizeName('   ')).toBeNull();
        expect(sanitizeName('\t\n')).toBeNull();
    });

    it('trims surrounding whitespace', () => {
        expect(sanitizeName('  Bob  ')).toBe('Bob');
    });

    it('collapses internal whitespace (tabs/newlines included) to single spaces', () => {
        expect(sanitizeName('Snake\t\tMaster')).toBe('Snake Master');
        expect(sanitizeName('a  b\n c')).toBe('a b c');
    });

    it('clamps to 16 characters at the boundary', () => {
        expect(sanitizeName('a'.repeat(16))).toBe('a'.repeat(16));
        expect(sanitizeName('a'.repeat(17))).toBe('a'.repeat(16));
        expect(sanitizeName('a'.repeat(40)).length).toBe(16);
    });

    it('keeps a 1-char name', () => {
        expect(sanitizeName('x')).toBe('x');
    });
});
