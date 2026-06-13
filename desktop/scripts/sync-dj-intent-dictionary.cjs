/**
 * Copy canonical DJ Intent Dictionary from lib/ into desktop/src/shared/
 * so desktop tsc (rootDir=src) can compile local search without cross-root imports.
 */
const fs = require("fs");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const src = path.join(repoRoot, "lib", "dj-intent-dictionary.ts");
const dest = path.join(repoRoot, "desktop", "src", "shared", "dj-intent-dictionary.ts");

const banner = `/**
 * Desktop copy of canonical DJ Intent Dictionary.
 * Source of truth: lib/dj-intent-dictionary.ts
 * Regenerate: node desktop/scripts/sync-dj-intent-dictionary.cjs
 */
`;

const body = fs.readFileSync(src, "utf-8").replace(/^\/\*\*[\s\S]*?\*\/\s*/m, "");
fs.writeFileSync(dest, banner + body, "utf-8");
console.log("[sync-dj-intent-dictionary]", path.relative(repoRoot, dest));
