import { defineConfig } from 'vitest/config';

// Default test config used by `npm test` (plain `vitest run`).
//
// `tests/rules.test.js` is the ONLY emulator-backed suite: it talks to the
// Firestore + Realtime Database emulators, which need a JRE the fast unit job
// (and Java-less local machines) do not have. Excluding it here keeps `npm test`
// hermetic — it runs exactly the pure-logic / protocol / DOM suites and never
// tries to open an emulator socket.
//
// The rules suite runs ONLY via `npm run test:rules`, which loads
// `vitest.rules.config.js` (an include-only-the-rules-file config) under
// `firebase emulators:exec`. See tests/rules.test.js header for the contract.
export default defineConfig({
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'tests/rules.test.js',
    ],
  },
});
