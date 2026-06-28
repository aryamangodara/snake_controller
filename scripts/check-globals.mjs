// ==========================================
// CI GUARD — .eslintrc.json globals  <->  public/js/*.js top-level declarations
// ==========================================
// The no-bundler / single-global-scope design means every cross-file read relies on
// `.eslintrc.json` `globals` declaring the symbol (so ESLint's no-undef doesn't flag it).
// That list is hand-maintained, so it silently drifts: a declared-but-unlisted symbol only
// trips no-undef once SOME OTHER file references it (same-file helpers drift forever); a
// listed-but-removed symbol lingers as dead noise. This script makes both directions of
// drift a hard CI failure (exit 1).
//
// It only ever handles identifier names parsed out of source — NO runtime data, NO session
// codes, NO PII. Safe to log everything it finds.
//
// Run: `node scripts/check-globals.mjs`  (or `npm run check:globals`).

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const jsDir = join(repoRoot, 'public', 'js');

// True externals: symbols that legitimately live in `globals` with NO matching
// declaration in public/js (loaded from a CDN). Adding a CDN global later is a
// one-line, reviewed change here.
const EXTERNALS = new Set(['firebase', 'QRious']);

/**
 * Extract every TOP-LEVEL declaration name from one source file. Declaration regexes
 * are anchored to column 0, so nested/inner declarations are ignored by design.
 * Handles: `function f`, `async function f`, and `let|const|var a, b, c` comma-lists.
 * @param {string} src
 * @returns {string[]}
 */
function declaredNames(src) {
    const names = [];
    for (const line of src.split(/\r?\n/)) {
        // function / async function at column 0
        const fn = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/.exec(line);
        if (fn) {
            names.push(fn[1]);
            continue;
        }
        // let / const / var at column 0 — capture the whole declarator list, then
        // split it so comma-lists (e.g. `let app, database, firestore, analytics;`
        // and `let canvas, ctx, gameLoop;`) expand into every name.
        const decl = /^(?:let|const|var)\s+(.+)$/.exec(line);
        if (decl) {
            // Stop at the first `=` (initializer) or `;` so we only read the
            // declarator names, not values that may themselves contain commas.
            const head = decl[1].split('=')[0].split(';')[0];
            for (const part of head.split(',')) {
                const id = /^\s*([A-Za-z_$][\w$]*)/.exec(part);
                if (id) names.push(id[1]);
            }
        }
    }
    return names;
}

// 1. Collect every top-level declaration across public/js/*.js
const declared = new Set();
for (const file of readdirSync(jsDir).filter((f) => f.endsWith('.js'))) {
    for (const name of declaredNames(readFileSync(join(jsDir, file), 'utf8'))) {
        declared.add(name);
    }
}

// 2. Read the eslintrc globals keys (parse the JSON — no brittle line-slicing).
const eslintrc = JSON.parse(readFileSync(join(repoRoot, '.eslintrc.json'), 'utf8'));
const listed = new Set(Object.keys(eslintrc.globals || {}));

// 3. Two-direction diff against the EXTERNALS allowlist.
//    (a) declared in source but NOT in globals -> would silently fail no-undef
//        the moment a second file references it.
const declaredNotListed = [...declared].filter((n) => !listed.has(n)).sort();
//    (b) in globals but neither declared nor a known external -> dead/stale or a typo.
const listedNotDeclared = [...listed]
    .filter((n) => !declared.has(n) && !EXTERNALS.has(n))
    .sort();

let failed = false;
if (declaredNotListed.length) {
    failed = true;
    console.error(
        `❌ ${declaredNotListed.length} symbol(s) declared in public/js/*.js but missing from .eslintrc.json "globals":`
    );
    for (const n of declaredNotListed) {
        console.error(`   - ${n}  (add it to "globals", or another file referencing it will fail no-undef)`);
    }
}
if (listedNotDeclared.length) {
    failed = true;
    console.error(
        `❌ ${listedNotDeclared.length} key(s) in .eslintrc.json "globals" but not declared in public/js/*.js (and not an external):`
    );
    for (const n of listedNotDeclared) {
        console.error(`   - ${n}  (remove the stale entry, fix the typo, or add it to EXTERNALS if it's a CDN global)`);
    }
}

if (failed) {
    console.error('\n❌ Globals drift detected — see above. Reconcile .eslintrc.json "globals" with the source.');
    process.exit(1);
}

console.log(
    `✅ Globals in sync: ${declared.size} declared symbol(s) + ${EXTERNALS.size} external(s) match ${listed.size} "globals" key(s).`
);
