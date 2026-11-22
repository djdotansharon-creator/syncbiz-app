/**
 * PLAYLIST SHARING — PHASE B: THE VONO ID + THE CREATOR CREDIT (owner 2026-11-22: "a user name + # + a number"; "created by <name> in small text under the playlist's name").
 * Run: npx tsx scripts/verify-sharing-b.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { creatorDisplayName } from "../lib/playlist-credit";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const rd = (p: string) => readFileSync(path.join(__dirname, "..", p), "utf-8").replace(/\r\n/g, "\n");

assert("P1 the credit shows the display name; else first + last name; else nothing — never an email, never an ID", creatorDisplayName({ name: " Dotan Sharon " }) === "Dotan Sharon" && creatorDisplayName({ name: "", firstName: "Dotan", lastName: "S" }) === "Dotan S" && creatorDisplayName({ name: null, firstName: null, lastName: "Sharon" }) === "Sharon" && creatorDisplayName({ name: null }) === undefined && creatorDisplayName(null) === undefined && creatorDisplayName(undefined) === undefined);

const store = rd("lib/playlist-store.ts");
const route = rd("app/api/playlists/route.ts");
assert("P2 the creator is stamped by the SERVER from the signed-in session (route passes user.id), written only at create; an update never writes it, so a body can never change who made a playlist", /createdByUserId: user\.id,/.test(route) && /createdByUserId: input\.createdByUserId \?\? null,/.test(store) && !/createdByUserId/.test(store.slice(store.indexOf("export async function updatePlaylist"))) && !/createdBy/.test(rd("app/api/playlists/[id]/route.ts")));
assert("P3 the creator's NAME rides along as one small join selecting name fields only — never the email — and reaches the playlist as createdByName", /const INCLUDE_ITEMS = \{ items: true, createdBy: \{ select: \{ name: true, firstName: true, lastName: true \} \} \} as const;/.test(store) && /createdByName: creatorDisplayName\(row\.createdBy\)/.test(store) && !/email/.test(store.slice(store.indexOf("const INCLUDE_ITEMS"), store.indexOf("const INCLUDE_ITEMS") + 200)));

const idRoute = rd("app/api/me/vono-id/route.ts");
assert("I1 the ID route answers ONLY about the caller: signed-in required (401), no id / query parameter, no lookup of other people", /getCurrentUserFromCookies\(\)/.test(idRoute) && /status: 401/.test(idRoute) && /getOrAssignUserHandle\(user\.id\)/.test(idRoute) && !/searchParams|req\.|request\./.test(idRoute) && /export async function GET\(\)/.test(idRoute));
const hs = rd("lib/user-handle-store.ts");
assert("I2 the ID is assigned once and never changed: only while the person has none (updateMany where handle null), a clash on the exact ID (P2002) tries the next candidate, other errors are not swallowed", /updateMany\(\{ where: \{ id: userId, handle: null \}/.test(hs) && /e\.code === "P2002"\) continue;/.test(hs) && /throw e;/.test(hs) && /if \(user\.handle\) return user\.handle;/.test(hs));

const card = rd("components/vono-id-card.tsx");
const settings = rd("app/(app)/settings/page.tsx");
assert("I3 Settings → General shows 'Your VONO ID' (the card reads /api/me/vono-id, shows the ID left-to-right with a copy button) and nothing else of Settings was removed", /<VonoIdCard \/>/.test(settings) && /fetch\("\/api\/me\/vono-id"/.test(card) && /dir="ltr"/.test(card) && /navigator\.clipboard\.writeText\(handle\)/.test(card) && /tr\("Playback preferences"\)/.test(settings) && /tr\("Remote player"\)/.test(settings));
const phr = rd("lib/i18n/phrases.ts");
assert("I4 the Hebrew phrases exist (title, line, 'not available', 'created by')", ["Your VONO ID", "Your name and number in VONO — it never changes.", "People find you by this exact ID, to share playlists with you or to add you to a business.", "Your VONO ID is not available right now.", "created by"].every((k) => phr.includes(`"${k}":`)));

const panel = rd("components/playlist-workspace-panel.tsx");
const sm = rd("components/sources-manager.tsx");
assert("C1 the opened playlist shows 'created by <bold name>' under its name — only when the creator was recorded (album look and classic header both); older playlists show nothing", /\{createdBy \? \(\s*<p className="sb-alb-by">\s*\{t\.by\} <b>\{createdBy\}<\/b>/.test(panel) && /createdBy=\{collectionOpenContext\.createdBy\}/.test(sm) && /\{collectionOpenContext\.createdBy \? \(/.test(sm) && /resolvePlaylistShellByEntityKey\(selection\.key, sources\)\?\.playlist\?\.createdByName \?\? null/.test(sm));
const css = rd("app/globals.css") + rd("components/control-screen/settings-screen.css");
const added = css.slice(css.indexOf(".sb-alb-by {"), css.indexOf(".sb-alb-by {") + 400) + css.slice(css.indexOf("/* \"Your VONO ID\""));
assert("C2 the new styles are flat (no blur / filter / backdrop-filter) and have a light-display variant", !/backdrop-filter|filter:|blur\(/.test(added) && /html\[data-sb-display="white"\] \.sb-alb-by/.test(added) && /html\[data-sb-display="white"\] \.sb-vid-id/.test(added));
assert("D1 nothing of the sharing itself exists yet: no application file uses the PlaylistShare table (phase B is the ID and the credit only)", !/prisma\.playlistShare/.test(store + route + hs + idRoute + sm));

console.log(`\n${pass} passed, ${fail} failed`);
