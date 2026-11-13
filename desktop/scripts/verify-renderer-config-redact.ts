/**
 * C5/C6b — unit test for the renderer-facing config redaction (`desktop/src/shared/renderer-config-redact.ts`).
 *
 *  toRendererConfig     — NEVER exposes `wsToken`; exposes `hasWsToken`; preserves every other field.
 *  sanitizeConfigPatch  — remote patch: drops apiBaseUrl/wsUrl/wsToken; local patch: keeps endpoints + a real
 *                         token; a blank wsToken is dropped for BOTH (no accidental token wipe); input unmutated.
 *
 * Run: npx tsx desktop/scripts/verify-renderer-config-redact.ts
 */
import { toRendererConfig, sanitizeConfigPatch } from "../src/shared/renderer-config-redact";
import type { DesktopRuntimeConfig, MvpConfigPatch } from "../src/shared/mvp-types";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}

const FULL: DesktopRuntimeConfig = {
  deviceId: "dsk-abc",
  branchId: "branch-1",
  workspaceLabel: "WS",
  apiBaseUrl: "https://app.example.com",
  wsUrl: "wss://ws.example.com",
  wsToken: "SECRET.signed.token",
  lastAuthEmail: "a@b.com",
  desktopTokenExpiresAtIso: "2026-12-01T00:00:00Z",
  musicFolderPath: "D:/Music",
  additionalMusicFolders: ["E:/More"],
};

// ── toRendererConfig ──
const r = toRendererConfig(FULL);
assert("toRendererConfig REMOVES wsToken", !("wsToken" in r), `keys=${Object.keys(r).join(",")}`);
assert("toRendererConfig hasWsToken=true when token present", r.hasWsToken === true);
assert("toRendererConfig preserves deviceId/branchId/endpoints", r.deviceId === "dsk-abc" && r.branchId === "branch-1" && r.apiBaseUrl === "https://app.example.com" && r.wsUrl === "wss://ws.example.com");
assert("toRendererConfig preserves musicFolderPath/additional/expiry", r.musicFolderPath === "D:/Music" && JSON.stringify(r.additionalMusicFolders) === JSON.stringify(["E:/More"]) && r.desktopTokenExpiresAtIso === "2026-12-01T00:00:00Z");
assert("toRendererConfig hasWsToken=false when token empty", toRendererConfig({ ...FULL, wsToken: "" }).hasWsToken === false);
assert("toRendererConfig hasWsToken=false when token blank/whitespace", toRendererConfig({ ...FULL, wsToken: "   " }).hasWsToken === false);
assert("toRendererConfig does not mutate the input", "wsToken" in FULL && FULL.wsToken === "SECRET.signed.token");

// ── sanitizeConfigPatch — REMOTE (untrusted hosted renderer) ──
const remotePatch: MvpConfigPatch = { musicFolderPath: "X:/m", workspaceLabel: "new", apiBaseUrl: "https://evil.example", wsUrl: "wss://evil.example", wsToken: "ATTACKER.token" };
const rs = sanitizeConfigPatch(remotePatch, true);
assert("REMOTE drops apiBaseUrl", !("apiBaseUrl" in rs));
assert("REMOTE drops wsUrl", !("wsUrl" in rs));
assert("REMOTE drops wsToken (no injection)", !("wsToken" in rs));
assert("REMOTE keeps benign settings (musicFolderPath/workspaceLabel)", rs.musicFolderPath === "X:/m" && rs.workspaceLabel === "new");
assert("REMOTE does not mutate the input", remotePatch.apiBaseUrl === "https://evil.example" && remotePatch.wsToken === "ATTACKER.token");

// ── sanitizeConfigPatch — LOCAL (trusted file:// settings page) ──
const localPatch: MvpConfigPatch = { apiBaseUrl: "http://localhost:3000", wsUrl: "ws://localhost:3001", wsToken: "DEV.token" };
const ls = sanitizeConfigPatch(localPatch, false);
assert("LOCAL keeps apiBaseUrl/wsUrl (dev form retains control)", ls.apiBaseUrl === "http://localhost:3000" && ls.wsUrl === "ws://localhost:3001");
assert("LOCAL keeps a real (non-blank) wsToken", ls.wsToken === "DEV.token");

// ── blank wsToken dropped for BOTH senders (no accidental wipe) ──
assert("LOCAL drops a blank wsToken (no wipe)", !("wsToken" in sanitizeConfigPatch({ wsToken: "" }, false)));
assert("LOCAL drops a whitespace wsToken (no wipe)", !("wsToken" in sanitizeConfigPatch({ wsToken: "   " }, false)));
assert("REMOTE drops a blank wsToken too", !("wsToken" in sanitizeConfigPatch({ wsToken: "" }, true)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(process.exitCode ?? 0);
