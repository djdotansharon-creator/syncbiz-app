/**
 * Owner 2026-11-09 ("only the bar should refresh — why the whole player?"). Before: two 250 ms setState ticks in AudioPlayer
 * (desktop MPV playing / CONTROL mirror + MASTER playing) re-rendered the WHOLE player 4× a second just to move the progress bar.
 * Rule: the 4×/s clock lives in small leaves (components/player-surface/live-timeline.tsx — the time text, the played fill + thumb,
 * and the display-screen publish); the player re-renders only when its state changes. The position is the player's own
 * computation (unchanged), handed down as a function. The one render-time clock read the player keeps (`desktopStalePlayingZero`)
 * keeps its own tick, but only while it can matter ("playing" at position 0). Static pins; the mechanics were proven in real
 * Chromium with the real leaves (parent rendered once in 3 s of play while the bar / time / display moved 12 times).
 * Run: npx tsx scripts/verify-player-clock-leaf.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const root = path.join(__dirname, "..");
const ap = readFileSync(path.join(root, "components", "audio-player.tsx"), "utf-8").replace(/\r\n/g, "\n");
const lt = readFileSync(path.join(root, "components", "player-surface", "live-timeline.tsx"), "utf-8").replace(/\r\n/g, "\n");

assert("C1 the CONTROL-mirror whole-player tick is gone", !/setControlMirrorTick/.test(ap));
assert("C2 the desktop whole-player tick runs ONLY in the stale-zero window (playing at position 0), which its render-time 1 s check needs",
  /const desktopZeroWatch =\n\s*isDesktopMode && desktopMpvSnap\?\.status === "playing" && \(desktopMpvSnap\?\.duration \?\? 0\) > 0 && \(desktopMpvSnap\?\.position \?\? 0\) <= 0;/.test(ap)
  && /if \(!desktopZeroWatch\) return;\n\s*const id = setInterval\(\(\) => setDesktopProgressTick\(\(n\) => n \+ 1\), 250\);/.test(ap)
  && /Date\.now\(\) - desktopSnapPositionAtRef\.current > 1000;/.test(ap));
assert("C3 the leaves tick exactly when the old ticks ran (desktop MPV playing, or CONTROL mirror + MASTER playing)",
  /const liveClockRunning =\n\s*\(isDesktopMode && desktopMpvSnap\?\.status === "playing"\) \|\| \(isControlMirror && ms\?\.status === "playing"\);/.test(ap));
assert("C4 the position is the player's own unchanged computation, handed to every leaf as a function",
  /const displayPosition = computeDisplayPosition\(\);/.test(ap) && /computeLivePosition\(ms, controlPendingSeek\) \/\/ SHARED with mobile/.test(ap)
  && (ap.match(/getPosition=\{computeDisplayPosition\}/g) ?? []).length === 4);
assert("C5 the time text, the fill + thumb and the display-screen publish are the leaves (each once)",
  (ap.match(/<LiveTimeText\s+getPosition=/g) ?? []).length === 1 && (ap.match(/<LiveTimelineFill\s+getPosition=/g) ?? []).length === 1 && (ap.match(/<NowPositionPublisher\s+getPosition=/g) ?? []).length === 1);
assert("C6 one shared 250 ms ticker that stops when nobody listens (no timer while paused / idle)",
  /const PLAYER_CLOCK_MS = 250;/.test(lt) && /if \(subscribers\.size === 0 && ticker !== null\) \{\n\s*clearInterval\(ticker\);/.test(lt)
  && /useSyncExternalStore\(running \? subscribeClock : subscribeNothing/.test(lt));
assert("C7 the leaves are display-only: no playback calls, only the display-screen publish",
  !/usePlayback|useDevicePlayer|syncbizDesktop|sendCommand|seekTo|mpv/i.test(lt.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")) && /publishNowPosition\(displayPosition, displayDuration, displayStatus\)/.test(lt));
assert("C8 the station's video clip reads the live position itself (the player no longer re-renders 4×/s to feed it)",
  /mpvStatus=\{ms\.status === "playing" \? "playing" : "paused"\}\n\s*mpvPosition=\{Number\.isFinite\(displayPosition\) \? displayPosition : 0\}\n\s*getPosition=\{computeDisplayPosition\}/.test(ap));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(process.exitCode ?? 0);
