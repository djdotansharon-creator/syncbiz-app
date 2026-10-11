/**
 * AUTOMIX natural-EOF re-arm. Deterministic guards proving the desktop pre-EOF mix-advance latch
 * (mpvDesktopMixStartedRef) re-arms exactly ONCE per NEW MPV attempt (desktopMpvSnap.attemptId), and NOT on
 * currentPlayUrl / every render — so every LOCAL track gets a pre-EOF crossfade, with no stale-snapshot cascade.
 * Run (from desktop/): npx tsx scripts/verify-automix-rearm.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const read = (...p: string[]) => readFileSync(path.join(__dirname, "..", "..", ...p), "utf-8");
const ap = read("components", "audio-player.tsx");
const dp = read("lib", "device-player-context.tsx");

// Isolate the re-arm effect (from its ref decl to its dependency array).
const reArmStart = ap.indexOf("const mixArmAttemptRef");
const reArm = reArmStart >= 0 ? ap.slice(reArmStart, ap.indexOf("}, [desktopMpvSnap?.attemptId]);", reArmStart) + 40) : "";

// 1 — re-arm keyed on a NEW attemptId sets the latch false.
assert("re-arm effect exists and clears mpvDesktopMixStartedRef on a new attemptId",
  /const mixArmAttemptRef = useRef<number \| null>\(null\);/.test(ap) &&
  /mixArmAttemptRef\.current = id;\s*mpvDesktopMixStartedRef\.current = false;/.test(reArm));
// 1b — dependency is attemptId ONLY.
assert("re-arm effect dependency is [desktopMpvSnap?.attemptId] ONLY",
  /\}, \[desktopMpvSnap\?\.attemptId\]\);/.test(reArm));

// 2 — same attemptId does NOT re-arm repeatedly (one-shot guard).
assert("same attemptId is a no-op (one-shot guard)", /if \(id === mixArmAttemptRef\.current\) return;/.test(reArm));
assert("non-number attemptId is ignored (fail-safe)", /if \(typeof id !== "number"\) return;/.test(reArm));

// 3 — a bare currentPlayUrl change does NOT re-arm the latch (the reverted f2dc229 pattern must be absent).
assert("NO standalone currentPlayUrl-keyed reset of the latch (f2dc229 cascade pattern is gone)",
  !/mpvDesktopMixStartedRef\.current = false;\s*\}, \[currentPlayUrl\]\);/.test(ap));

// 4 / 5 — the re-arm is reset-ONLY: it never calls next() (so it cannot itself advance / cascade).
assert("re-arm effect never calls next() (reset-only; scheduler decides when to fire)",
  reArm.length > 0 && !/next\s*\(/.test(reArm) && !/nextRef/.test(reArm));

// 4 — the pre-EOF scheduler is unchanged: still gated by the latch + position, and fires once (sets latch true).
assert("pre-EOF scheduler still gates on (pos < mixAt || latch) and sets the latch on fire",
  /if \(pos < mixAt \|\| mpvDesktopMixStartedRef\.current\) return;\s*\n\s*mpvDesktopMixStartedRef\.current = true;/.test(ap));
assert("pre-EOF scheduler still advances via next({ skipPlay: true }) at the mix point",
  /nextRef\.current\(\{ skipPlay: true, auditTransportCase: "ended_auto" \}\);\s*\n\s*\}, \[desktopMpvSnap, status, currentPlayUrl, getNextStreamUrl\]\);/.test(ap));

// 6 — manual NEXT path is unchanged (local-exec → provider next(); never touches the mix latch).
assert("manual NEXT still routes local-exec through provider next() (unchanged)",
  /const nextOrSend = useCallback\(\(\) => \{\s*if \(useLocalDeviceTransport \|\| localExecCurrent\) next\(\);/.test(dp));

console.log(`\n${pass} passed, ${fail} failed`);
