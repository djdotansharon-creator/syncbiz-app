/**
 * PLAYLIST SHARING — THE DORMANT FOUNDATION (owner 2026-11-22). Guards: the migration is ADDITIVE ONLY (no drop / alter column / data change), creates exactly the agreed objects, the schema matches, the ID helpers
 * behave, and NOTHING in the app reads or writes the new columns / table yet (dormant: no behaviour changes until phase B).
 * Run: npx tsx scripts/verify-sharing-foundation.ts
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { slugifyHandleName, formatHandle, parseHandle, candidateHandles } from "../lib/user-handle";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const root = path.join(__dirname, "..");
const rd = (p: string) => readFileSync(path.join(root, p), "utf-8").replace(/\r\n/g, "\n");

const sql = rd("prisma/migrations/20261122120000_playlist_sharing_foundation/migration.sql");
const stmts = sql.split("\n").filter((l) => /^(CREATE|ALTER|DROP|UPDATE|DELETE|INSERT|TRUNCATE)\b/i.test(l.trim()));
assert("D1 the migration is ADDITIVE ONLY: every statement is CREATE or ALTER TABLE … ADD (no DROP, UPDATE, DELETE, INSERT, TRUNCATE, ALTER COLUMN, RENAME)", stmts.length > 0 && stmts.every((l) => /^CREATE (TYPE|TABLE|INDEX|UNIQUE INDEX)\b/i.test(l) || /^ALTER TABLE "(User|Playlist|PlaylistShare)" ADD (COLUMN|CONSTRAINT)\b/i.test(l)) && !/\b(DROP|RENAME|ALTER COLUMN|SET NOT NULL|UPDATE |DELETE FROM|TRUNCATE)\b/i.test(sql.replace(/ON (DELETE|UPDATE) (CASCADE|SET NULL)/gi, "")), `${stmts.length} statements`);
assert("D2 it creates exactly: the two enums, User.handle (nullable) + its unique index, Playlist.createdByUserId (nullable), the PlaylistShare table with its four indexes and three foreign keys", /CREATE TYPE "PlaylistShareTargetKind" AS ENUM \('BRANCH', 'USER'\)/.test(sql) && /CREATE TYPE "PlaylistShareStatus" AS ENUM \('PENDING', 'ACCEPTED', 'DECLINED', 'REVOKED'\)/.test(sql) && /ALTER TABLE "User" ADD COLUMN\s+"handle" TEXT;/.test(sql) && /CREATE UNIQUE INDEX "User_handle_key"/.test(sql) && /ALTER TABLE "Playlist" ADD COLUMN\s+"createdByUserId" TEXT;/.test(sql) && /CREATE TABLE "PlaylistShare"/.test(sql) && (sql.match(/CREATE INDEX "PlaylistShare_/g) ?? []).length === 4 && (sql.match(/ADD CONSTRAINT "PlaylistShare_/g) ?? []).length === 3 && /Playlist_createdByUserId_fkey[\s\S]*ON DELETE SET NULL/.test(sql));
const migs = readdirSync(path.join(root, "prisma/migrations")).filter((d) => statSync(path.join(root, "prisma/migrations", d)).isDirectory()).sort();
assert("D3 it is the LAST migration (nothing newer exists to reorder against) and sits in its own folder", migs[migs.length - 1] === "20261122120000_playlist_sharing_foundation");

const schema = rd("prisma/schema.prisma");
assert("S1 the schema carries the same: handle String? @unique, createdByUserId String? with its relation, the share model and enums", /handle\s+String\?\s+@unique/.test(schema) && /createdByUserId\s+String\?/.test(schema) && /createdBy\s+User\?\s+@relation\("PlaylistCreator", fields: \[createdByUserId\], references: \[id\], onDelete: SetNull\)/.test(schema) && /model PlaylistShare \{/.test(schema) && /enum PlaylistShareTargetKind/.test(schema) && /enum PlaylistShareStatus/.test(schema));

// dormant: no application code touches the new fields / table
const walk = (dir: string, out: string[] = []): string[] => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".next", ".git", "prisma", "docs", "scripts", ".claude"].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
};
const files = [...walk(path.join(root, "lib")), ...walk(path.join(root, "app")), ...walk(path.join(root, "components")), ...walk(path.join(root, "server"))];
// Phase B (this branch) puts the ID and the creator credit to use — ON PURPOSE. What must STILL be dormant is the sharing itself: nothing may use the PlaylistShare table or its enums yet.
const users = files.filter((f) => /prisma\.playlistShare|PlaylistShareTargetKind|PlaylistShareStatus/.test(readFileSync(f, "utf-8")));
assert("N1 the SHARING itself is still dormant: no application file uses the PlaylistShare table or its enums (phase B only adds the VONO ID and the creator credit)", users.length === 0, users.map((f) => path.relative(root, f)).join(", "));
assert("N2 the ID helpers (lib/user-handle.ts) are pure (no store, no fetch, no prisma)", !/fetch\(|prisma|require\(|import /.test(rd("lib/user-handle.ts").replace(/\/\*[\s\S]*?\*\//g, "")));

// the ID helpers
assert("H1 a name becomes the name part: lowercase Latin letters / digits / . _ -, accents folded, spaces → dots, ≤ 20 chars", slugifyHandleName("Dotan Sharon") === "dotan.sharon" && slugifyHandleName("José Álvarez") === "jose.alvarez" && slugifyHandleName("  DJ__Mike!! ") === "dj.mike" && slugifyHandleName("a".repeat(40)).length === 20);
assert("H2 a Hebrew-only / empty / symbol-only name falls back to 'user' (the person picks their own later)", slugifyHandleName("דותן") === "user" && slugifyHandleName("") === "user" && slugifyHandleName(null) === "user" && slugifyHandleName("!!!") === "user");
assert("H3 formatHandle / parseHandle round-trip; case, spaces and a leading @ are tolerated; a person is found only by the EXACT ID (no tag, a 3-digit or 5-digit tag, a space inside, a partial name → null)", formatHandle("dotan", 4821) === "dotan#4821" && JSON.stringify(parseHandle(" @Dotan#4821 ")) === JSON.stringify({ base: "dotan", tag: 4821, handle: "dotan#4821" }) && parseHandle("dotan") === null && parseHandle("dotan#482") === null && parseHandle("dotan#48211") === null && parseHandle("do tan#4821") === null && parseHandle("dotan#0999") === null && parseHandle("") === null && parseHandle(null) === null);
let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const cand = candidateHandles("Dotan", 8, rnd);
assert("H4 candidate IDs: 8 distinct, all valid, all start with the name part, numbers within 1000–9999 (a retry list for a uniqueness clash)", cand.length === 8 && new Set(cand).size === 8 && cand.every((h) => parseHandle(h)?.base === "dotan"));

console.log(`\n${pass} passed, ${fail} failed`);
