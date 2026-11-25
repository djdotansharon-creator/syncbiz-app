/**
 * A VIDEO THAT IS NOT A FULL-FRAME PICTURE SITS AT THE DECK'S EDGE, AS TALL AS THE DECK (owner 2026-11-25). Pure measurement of the thumbnail + the wiring (display only: no playback code). Run: npx tsx scripts/verify-deck-clip-fit.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { pictureBox } from "../components/deck-clip-fit";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const rd = (p: string) => readFileSync(path.join(__dirname, "..", p), "utf-8").replace(/\r\n/g, "\n");

const W = 64, H = 36;
const grid = (fill: (x: number, y: number) => [number, number, number]) => { const d: number[] = []; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) d.push(...fill(x, y), 255); return d; };
const WHITE: [number, number, number] = [255, 255, 255], PIC: [number, number, number] = [30, 90, 110];

// a square cover on a white frame: 24 columns wide (x 20–43), 24 rows tall (y 6–29)
const square = grid((x, y) => (x >= 20 && x < 44 && y >= 6 && y < 30 ? PIC : WHITE));
const bx = pictureBox(square, W, H);
assert("M1 a square cover on a white frame is found: about 38 % of the frame wide, about 67 % tall, in the middle", !!bx && Math.abs(bx.x0 - 20 / W) < 0.02 && Math.abs(bx.x1 - 44 / W) < 0.02 && Math.abs(bx.y0 - 6 / H) < 0.03 && Math.abs(bx.y1 - 30 / H) < 0.03, JSON.stringify(bx));
// the same with a TITLE in the frame's top-left corner (a few pixels per column) — it must not widen the box
const withTitle = grid((x, y) => (x >= 20 && x < 44 && y >= 6 && y < 30 ? PIC : x >= 2 && x < 14 && y >= 3 && y < 5 ? [0, 0, 0] : WHITE));
const bt = pictureBox(withTitle, W, H);
assert("M2 a title or logo in the corner of the frame does not widen the box", !!bt && Math.abs(bt.x0 - 20 / W) < 0.02, JSON.stringify(bt));
// a normal full-frame video (varied colours edge to edge)
const full = grid((x, y) => [(x * 7 + y * 3) % 256, (x * 3 + y * 11) % 256, (x * 5 + y * 13) % 256]);
assert("M3 a normal full-frame video is left alone (null)", pictureBox(full, W, H) === null);
// an old 4:3 clip: black bars left and right (each 8 columns), picture 48 columns
const fourThree = grid((x, y) => (x >= 8 && x < 56 ? [(x * 7 + y * 3) % 200 + 40, (x * 3 + y * 11) % 200 + 40, 120] : [0, 0, 0]));
const b43 = pictureBox(fourThree, W, H);
assert("M4 a 4:3 clip with black side bars (75 % of the frame wide) is found, so it is pulled to the edge too", !!b43 && Math.abs(b43.x1 - b43.x0 - 0.75) < 0.05, JSON.stringify(b43));
assert("M5 an empty / uniform frame gives nothing (null)", pictureBox(grid(() => WHITE), W, H) === null);

const comp = rd("components/deck-clip-fit.tsx");
assert("W1 DISPLAY ONLY: the component imports nothing from the player, the playback state, the device or the WebSocket code, and never touches the iframe's own style — it only writes five variables / one attribute on the deck", !/from "@\/(lib|components)\/(playback|audio-player|device|remote|ws)/.test(comp) && !/\.style\.transform/.test(comp) && /data-sb-clip-fit/.test(comp) && /--sb-clip-tx/.test(comp));
assert("W2 it measures the thumbnail ONCE per video (cached), only when a clip is really shown, and reads a canvas that cannot be read as 'no change'", /const cache = new Map<string, Box \| null>\(\)/.test(comp) && /f\.dataset\.sbShown !== "1"/.test(comp) && /catch \{\s*done\(null\);/.test(comp));
const prov = rd("app/(app)/providers.tsx");
assert("W3 it is mounted once next to the other renders-null helpers", /import \{ DeckClipFit \} from "@\/components\/deck-clip-fit";/.test(prov) && (prov.match(/<DeckClipFit \/>/g) ?? []).length === 1);
const css = rd("app/globals.css");
assert("W4 the CSS moves the iframe only while the attribute is on (!important — the deck's own script writes `transform: none` every second) and anchors the edge-fade on the moved frame", /\.audio-player-library-deck\[data-sb-clip-fit\] \.sb-deck-video-bg iframe \{ transform: translate\(var\(--sb-clip-tx, 0px\), var\(--sb-clip-ty, 0px\)\) scale\(var\(--sb-clip-z, 1\)\) !important; transform-origin: 50% 50% !important; \}/.test(css) && /\.audio-player-library-deck\[data-sb-clip-fit\] \.sb-deck-video-bg \{ --sb-video-w: var\(--sb-clip-w, 60%\); \}/.test(css));
assert("W5 the white look: the drop overlay (+) blurs what is behind it again (not in the light graphics), and the share button gets a faint disc only while a fitted picture is under it", /html\[data-sb-display="white"\]:not\(\[data-sb-fx="lite"\]\) \.sb-player-drop\[data-on\] \{ -webkit-backdrop-filter: blur\(18px\) !important; backdrop-filter: blur\(18px\) !important; \}/.test(css) && /html\[data-sb-display="white"\] \.audio-player-library-deck\[data-sb-clip-fit\] \.sb-transport-wing--end \.player-transport-secondary button \{ background: rgba\(255, 255, 255, 0\.6\); border-radius: 999px; \}/.test(css));
assert("W6 the white look's drop-overlay blur carries !important — app/lite-fx.css rule 1 removes every backdrop-filter in the white look with !important, so without it the blur stays \"none\" (measured 2026-11-25); the light graphics keep that rule", /html\[data-sb-display="white"\]:not\(\[data-sb-fx="lite"\]\) \.sb-player-drop\[data-on\] \{[^}]*backdrop-filter: blur\(18px\) !important/.test(css) && /:is\(html\[data-sb-fx="lite"\], html\[data-sb-display="white"\]\) \*,[\s\S]{0,400}backdrop-filter: none !important/.test(rd("app/lite-fx.css")));
console.log(`\n${pass} passed, ${fail} failed`);
