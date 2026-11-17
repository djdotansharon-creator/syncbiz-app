/**
 * 2026-11-09 (owner: "places like Shufersal need no video — there must be an option to turn video mode off").
 * PROVEN BY RUNTIME (CDP on the live Dev-PC station): with the per-device background set to "artwork", the station's
 * CONTROL-mirror YouTube clip stayed mounted and streaming — only the MPV-video path obeyed the Artwork ⇄ Video button.
 * Rule: on the desktop app "artwork" mounts NO YouTube clip in the station slot; "video" behaves as before; a plain browser
 * (no such button) is unchanged. Display-only — the audio path is not touched.
 * Run: npx tsx scripts/verify-artwork-mode-station-video.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const root = path.join(__dirname, "..");
const player = readFileSync(path.join(root, "components", "audio-player.tsx"), "utf-8").replace(/\r\n/g, "\n");
const mode = readFileSync(path.join(root, "lib", "desktop-background-mode.ts"), "utf-8").replace(/\r\n/g, "\n");

const at = player.indexOf("isControlMirror && mirrorVid && (ms?.status");
const cond = player.slice(at, player.indexOf("<DesktopVideoDock", at));
// 2026-11-16 (phone app): the condition gained `&& !pathname?.startsWith("/mobile")` — the phone is a remote with no deck on screen, so no muted clip streams there. The desktop button gate is unchanged.
assert("A1 the station YouTube clip is mounted only when the desktop's button says Video (a browser: unchanged) — and never on the phone app's routes",
  at > 0 && /\(!isDesktopMode \|\| desktopBgMode === "video"\) &&[\s\S]{0,260}?!pathname\?\.startsWith\("\/mobile"\) \? \(/.test(cond));
assert("A2 the MPV-video path still obeys the same button", /isControlMirror && mpvVideo\.active \? \(\n\s*desktopBgMode === "video" &&/.test(player));
assert("A3 the setting is per device and a new install starts on Artwork (lowest load)",
  /const DEFAULT_MODE: DesktopBackgroundMode = "artwork";/.test(mode) && /const STORAGE_KEY = "syncbiz:desktopBgMode";/.test(mode));
assert("A4 exactly one station clip slot (no second YouTube dock was added)", (player.match(/className="sb-deck-video-bg /g) ?? []).length === 1);

console.log(`\n${pass} passed, ${fail} failed`);
