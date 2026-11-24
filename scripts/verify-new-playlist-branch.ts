/**
 * A PLAYLIST MADE IN A WINDOW IS SAVED IN THE BRANCH THAT WINDOW IS VIEWING (owner 2026-11-24: "I made a DJ AI playlist in the branch's remote and it appears nowhere").
 * Since the library draws a real playlist only in its own branch, every client call that CREATES a playlist must say which branch it is for — otherwise the server files it under 'default' and a window of any
 * other branch never sees it. Pure rule + wiring. Run: npx tsx scripts/verify-new-playlist-branch.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { withStationBranch } from "../lib/local-playlist-branch";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const rd = (p: string) => readFileSync(path.join(__dirname, "..", p), "utf-8").replace(/\r\n/g, "\n");
const J = JSON.stringify;

const b = { name: "x", url: "u" };
assert("B1 a window of a real branch adds its branch id to what it sends", J(withStationBranch(b, "branch-7")) === J({ name: "x", url: "u", branchId: "branch-7" }));
assert("B2 a window of the legacy 'default' branch (or one that is not known yet) sends exactly what it always sent", withStationBranch(b, "default") === b && withStationBranch(b, null) === b && withStationBranch(b, "") === b);

const files: Array<[string, number]> = [
  ["components/dj-creator-ai-shell.tsx", 1], ["components/library-input-area.tsx", 3], ["lib/search-playlist-client.ts", 1], ["components/sources-manager.tsx", 1], ["components/url-ingest-zone.tsx", 2],
  ["components/add-source-form-unified.tsx", 1], ["components/add-playlist-form.tsx", 1], ["components/youtube-mix-import-panel-shell.tsx", 1], ["components/m3u-youtube-resolve-modal.tsx", 1], ["components/playlist-manager.tsx", 1], ["components/source-card-unified.tsx", 1],
];
const bad: string[] = [];
for (const [f, n] of files) {
  const s = rd(f);
  const posts = (s.match(/fetch\("\/api\/playlists", \{\s*method: "POST"/g) ?? []).length;
  const wrapped = (s.match(/body: JSON\.stringify\(withStationBranch\(/g) ?? []).length;
  const imports = /import \{ withStationBranch \} from "@\/lib\/local-playlist-branch";/.test(s) && /import \{ stationBranchIdNow \} from "@\/lib\/station-branch";/.test(s);
  if (posts !== n || wrapped < n || !imports) bad.push(`${f}: posts=${posts} wrapped=${wrapped} imports=${imports}`);
}
assert("W1 every call that creates a playlist from a window (the DJ AI, the search save, URL / playlist imports, the new-playlist button, the forms) sends the branch of that window", bad.length === 0, bad.join(" | "));
assert("W2 what the window sends comes from ONE place: the branch the window views (the controlled branch in a browser, MAIN's own in the desktop app)", /stationBranchIdNow\(\)/.test(rd("components/dj-creator-ai-shell.tsx")) && /export function stationBranchIdNow\(\)/.test(rd("lib/station-branch.ts")));
console.log(`\n${pass} passed, ${fail} failed`);
