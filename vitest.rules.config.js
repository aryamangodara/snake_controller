import { defineConfig } from 'vitest/config';

// Emulator-only test config, invoked exclusively by `npm run test:rules`
// (which wraps it in `firebase emulators:exec --only firestore,database`).
//
// It runs ONLY tests/rules.test.js — the security-rules contract suite — so the
// emulator boot cost is paid for that file alone and the default `npm test`
// run (vitest.config.js) never picks it up. Keeping the include list to the one
// file also means a stray `vitest run --config vitest.rules.config.js` outside
// the emulator wrapper fails fast (no emulator socket) instead of running the
// fast suites under the wrong config.
export default defineConfig({
  test: {
    include: ['tests/rules.test.js'],
    // The rules suite seeds + asserts serially against shared emulator state;
    // keep it single-file/single-thread to avoid cross-test interference.
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 30000,
  },
});
