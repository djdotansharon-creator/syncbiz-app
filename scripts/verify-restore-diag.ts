/**
 * Restart-restore diagnostic (2026-11-03), source guards — no browser. The desktop's main.log keeps only the renderer's warn / error lines, so the
 * restore decisions of lib/playback-provider.tsx (console.info / log) never reached it. This guard proves the diagnostic is READ-ONLY: a gated warn helper,
 * called only as plain statements at the decision points (never inside a condition, never returning or assigning its result), and the restore code
 * around them is the existing code.
 * Run: npx tsx scripts/verify-restore-diag.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";

let pass = 0;
let fail = 0;
function assert(name: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (ok) pass++;
  else fail++;
}
const src = readFileSync(path.join(__dirname, "..", "lib", "playback-provider.tsx"), "utf-8");

const helper = /function restoreDiag\([^)]*\): void \{[\s\S]*?\n\}\n/.exec(src)?.[0] ?? "";
assert("R1 the helper exists, returns nothing, does nothing outside the desktop shell and writes with console.warn (the only level main.log keeps besides errors)", /if \(!isDesktopStationShell\(\)\) return;/.test(helper) && /console\.warn\("\[VONO restore-diag\] "/.test(helper) && !/setState|localStorage|sessionStorage|return [^;]/.test(helper.replace("return;", "")));

const calls = src.split("\n").filter((l) => /restoreDiag\(/.test(l) && !/^function restoreDiag/.test(l.trim()));
assert("R2 every call is a plain statement — never inside a condition, never returned or assigned", calls.length >= 10 && calls.every((l) => /^\s*(?:if \(localStorage\.getItem\(RECOVERY_STORAGE_KEY\)\) )?restoreDiag\(/.test(l)));

const steps = [
  "skip: already restored or a source is set", "wait: MAIN decision", "hold: MAIN restores the remembered URL source", "url source unavailable",
  "nothing to restore: no recovery snapshot", "wait: local permission", "restoring", "blocked: not permitted to play here",
  "gave up: the saved source cannot be rebuilt", "autoplay decision", "restore failed (exception)", "snapshot cleared",
];
assert("R3 every decision point of the restart restore is logged (" + steps.length + " steps)", steps.every((s) => src.includes(`restoreDiag("${s}"`)));

const autoplayRule = /const shouldAutoplay =[\s\S]*?RECOVERY_AUTOPLAY_WINDOW_MS\);/.exec(src)?.[0] ?? "";
assert("R4 the existing restore decisions are untouched: the autoplay rule (all four conditions) and the not-permitted guard (done + return right after the log)", /mainBootSource\.current !== "url"/.test(autoplayRule) && /autoresume !== "0"/.test(autoplayRule) && /persistedV2\.status === "playing"/.test(autoplayRule) && /isDesktopStation \|\|/.test(autoplayRule) && !/restoreDiag/.test(autoplayRule) && /if \(!deviceModeAllowsLocalPlayback\.current && !\(localSourceExecAllowed\.current && restoringLocal\)\) \{\s*restoreDiag\([^\n]*\n\s*done\(\);\s*return;\s*\}/.test(src));

const blocks = src.match(/restoreDiag\("[^"]*"(?:, \{[\s\S]*?\})?\);/g) ?? [];
const dataOnly = blocks.map((b) => b.replace(/^restoreDiag\("[^"]*"/, ""));
assert("R5 the diagnostic never carries a file path or a title — only ids, flags and counts (" + blocks.length + " calls)", blocks.length >= 12 && !dataOnly.some((d) => /title|url|path|cover/i.test(d)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
