/**
 * YT-DLP FAILURE REASON (read-only diagnostic, 2026-11-21). PROD logged 97 × "[youtube-resolver] fetch failed" and 0 successes, each in 0–4 s, and
 * the reason was swallowed by a bare `catch`. The lookup now says WHY in one short line — behaviour is otherwise unchanged (still returns undefined).
 * Run: npx tsx scripts/verify-ytdlp-failure-log.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describeYtDlpFailure } from "../lib/yt-dlp-search";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const src = readFileSync(path.join(__dirname, "..", "lib/yt-dlp-search.ts"), "utf-8").replace(/\r\n/g, "\n");

const botCheck = new Error("Error code: 1\n\nStderr:\nERROR: [youtube] abc123: Sign in to confirm you’re not a bot. Use --cookies-from-browser or --cookies for the authentication.");
assert("Y1 yt-dlp's own ERROR line is picked (not the 'Error code' header)", describeYtDlpFailure(botCheck).startsWith("ERROR: [youtube] abc123: Sign in to confirm"), describeYtDlpFailure(botCheck));
assert("Y2 a spawn failure gives its message", describeYtDlpFailure(new Error("spawn /usr/bin/yt-dlp ENOENT")) === "spawn /usr/bin/yt-dlp ENOENT");
assert("Y3 a plain string, an empty message and a non-error never throw", describeYtDlpFailure("boom") === "boom" && describeYtDlpFailure(new Error("")) === "(no message)" && describeYtDlpFailure(undefined) === "undefined" && describeYtDlpFailure(null) === "null");
const long = describeYtDlpFailure(new Error("ERROR: " + "x".repeat(1000)));
assert("Y4 the line is cut to 240 characters (+ an ellipsis) — no log flood", long.length === 241 && long.endsWith("…"), String(long.length));
assert("Y5 it is ONE line", !/\n/.test(describeYtDlpFailure(new Error("a\nb\nc"))));

const fn = src.slice(src.indexOf("export async function fetchYouTubeMetadataByYtDlp"), src.indexOf("/** Stage 5.9"));
assert("Y6 the lookup still returns undefined on every failure path (behaviour unchanged — diagnostic only)", (fn.match(/return undefined;/g) ?? []).length === 4 && !/throw /.test(fn));
assert("Y7 the failure line says timeout-or-error and whether a YouTube API key is configured, as a yes/no — never the key", /apiKeyConfigured=\$\{apiKeyConfigured\}/.test(fn) && /Boolean\(process\.env\.YOUTUBE_API_KEY/.test(fn) && !/\$\{process\.env\.YOUTUBE_API_KEY/.test(fn) && /controller\.signal\.aborted \? "timeout" : "error"/.test(fn));
assert("Y8 NOTHING playback-related is touched: this file imports no player / provider / MPV / orchestrator / watchdog code", !/playback-provider|device-player|audio-player|orchestrator|watchdog|from "[^"]*mpv/i.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
