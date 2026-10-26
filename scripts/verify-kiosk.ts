/**
 * The display screen (kiosk): the lock + the owner's settings (first password 123, his own password kept only as a salted hash, what staff may do) and the
 * guarantees that keep the music safe — it is a cover over the running app, reads playback state and sends only the controller's own commands. No browser.
 * Run: npx tsx scripts/verify-kiosk.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const store = new Map<string, string>();
const g = globalThis as unknown as Record<string, unknown>;
const events: string[] = [];
g.window = { localStorage: { getItem: (k: string) => (store.has(k) ? store.get(k)! : null), setItem: (k: string, v: string) => void store.set(k, String(v)), removeItem: (k: string) => void store.delete(k) }, dispatchEvent: (e: { type: string }) => (events.push(e.type), true), addEventListener: () => {} };

let pass = 0;
let fail = 0;
function assert(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === undefined ? "" : `   -> ${JSON.stringify(detail)}`}`);
  if (ok) pass++;
  else fail++;
}
const root = path.join(__dirname, "..");
const read = (...p: string[]) => readFileSync(path.join(root, ...p), "utf8");

async function main() {
  const k = await import("../lib/kiosk");

  // ── the lock + the password ─────────────────────────────────────────────────────────────────────────────────────────
  assert("K1 the first password is 123 and no custom one is set", k.DEFAULT_KIOSK_PIN === "123" && k.hasCustomKioskPin() === false && (await k.verifyKioskPin("123")) === true);
  assert("K2 a fresh device is NOT locked", k.readKioskLocked() === false);
  k.lockKiosk();
  assert("K3 locking is remembered on the device (a screen that reboots comes back locked)", k.readKioskLocked() === true && store.get("syncbiz-kiosk-locked") === "1");
  assert("K4 a wrong or empty password does not open it", (await k.tryUnlockKiosk("999")) === false && (await k.tryUnlockKiosk("")) === false && k.readKioskLocked() === true);
  assert("K5 the right password opens it (stray spaces ignored)", (await k.tryUnlockKiosk(" 123 ")) === true && k.readKioskLocked() === false);
  await k.setKioskPin("4455");
  assert("K6 the owner's own password replaces 123", k.hasCustomKioskPin() === true && (await k.verifyKioskPin("123")) === false && (await k.verifyKioskPin("4455")) === true);
  const raw = store.get("syncbiz-kiosk-settings") ?? "";
  assert("K7 the password is stored only as a salted hash — never as typed", !raw.includes("4455") && raw.includes("pinHash") && raw.includes("pinSalt"));
  k.lockKiosk();
  assert("K8 the new password opens the lock, 123 no longer does", (await k.tryUnlockKiosk("123")) === false && (await k.tryUnlockKiosk("4455")) === true);
  await k.setKioskPin("4455");
  const salt1 = JSON.parse(store.get("syncbiz-kiosk-settings")!).pinSalt;
  await k.setKioskPin("4455");
  assert("K9 each save uses a fresh salt", JSON.parse(store.get("syncbiz-kiosk-settings")!).pinSalt !== salt1);
  await k.setKioskPin("");
  assert("K10 clearing it brings 123 back", k.hasCustomKioskPin() === false && (await k.verifyKioskPin("123")) === true);
  assert("K11 changes are announced so the screen reacts at once", events.includes("syncbiz-kiosk-changed"));

  // ── what staff may do ───────────────────────────────────────────────────────────────────────────────────────────────
  const all = k.getKioskPermissions();
  assert("P1 before the owner chooses, everything is allowed and the volume stops at 80 %", all.skip && all.pause && all.search && all.reorder && all.jingles && all.volume && all.volumeMax === 80);
  k.setKioskPermissions({ search: false, reorder: false });
  const p = k.getKioskPermissions();
  assert("P2 switching things off keeps the rest on", p.search === false && p.reorder === false && p.skip === true && p.pause === true && p.jingles === true);
  await k.setKioskPin("777");
  assert("P3 changing the password does not touch the permissions (and the other way round)", k.getKioskPermissions().search === false && (await k.verifyKioskPin("777")) === true);
  await k.setKioskPin("");
  assert("P4 resetting the password keeps the permissions", k.getKioskPermissions().reorder === false);
  k.setKioskPermissions({ volumeMax: 5 });
  assert("P4b the volume limit never goes below 20 % (a silent screen is not a setting)", k.getKioskPermissions().volumeMax === 20);
  k.setKioskPermissions({ volumeMax: 500 });
  assert("P4c … nor above 100 %", k.getKioskPermissions().volumeMax === 100);
  k.setKioskPermissions({ volumeMax: 70, search: true, reorder: false });
  store.set("syncbiz-kiosk-settings", "{not json");
  assert("P5 a damaged settings value falls back to the safe defaults (123, everything allowed)", k.getKioskPermissions().skip === true && (await k.verifyKioskPin("123")) === true);

  // ── the music must be safe ──────────────────────────────────────────────────────────────────────────────────────────
  const kd = read("components", "kiosk-display.tsx");
  const code = kd.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const forbidden = ["playback.stop(", "stopForControlHandoff", "playback.setQueue", "setQueue(", "replaceSource", "registerStopAllPlayers", "reportPosition", "sendCommandToMaster"];
  const hit = forbidden.filter((f) => code.includes(f));
  assert("S1 the display screen never calls a provider mutator that could stop / replace playback", hit.length === 0, hit);
  assert("S2 it sends only the controller's own commands (next / prev / play / pause / queue next, jingles on air)", ["nextOrSend", "prevOrSend", "playOrSend", "pauseOrSend", "queueNextOrSend", "fireJingleOnAir"].every((c) => code.includes(c)));
  assert("S3 the ONLY thing it changes on the provider is the order of Up next — the controller's own two calls", ["reorderPlayNextItem", "reorderSessionTrack"].every((c) => code.includes(c)) && !/playback\.(addPlayNextFrom|removePlayNextItem|updatePlayNextItem)/.test(code));
  assert("S4 it is a portal over the app, not a route or a replacement of the shell", code.includes("createPortal(") && !code.includes("<AudioPlayer") && !code.includes("router.push"));
  assert("S5 while up, everything underneath is made inert — never hidden or unmounted", code.includes('setAttribute("inert"') && !/display\s*:\s*none|\.remove\(\)|unmount/.test(code));
  const shell = read("components", "app-shell.tsx");
  assert("S6 the shell mounts it exactly once and still has exactly three <AudioPlayer /> mounts (no new instance)", (shell.match(/<KioskDisplay \/>/g) ?? []).length === 1 && (shell.match(/<AudioPlayer \/>/g) ?? []).length === 3);
  const player = read("components", "audio-player.tsx");
  const css = read("app", "kiosk-display.css");
  const cssNoScrim = css.replace(/html:not\(\[data-sb-fx="lite"\]\) \.sb-kiosk-scrim\s*\{[^}]*\}/, "").replace(/html:not\(\[data-sb-fx="lite"\]\) \.sb-kiosk-sheet\s*\{[^}]*\}/, "");
  assert("S8 no blur layers on the display screen (light on a simple computer) — the only exceptions are the veil behind the OPEN password bar and the glass sheet of a search result, never in light-graphics mode", !/backdrop-filter\s*:\s*(?!none)/.test(cssNoScrim) && !/filter\s*:\s*blur/.test(cssNoScrim) && /html:not\(\[data-sb-fx="lite"\]\) \.sb-kiosk-scrim\s*\{[^}]*backdrop-filter:\s*blur/.test(css) && /html:not\(\[data-sb-fx="lite"\]\) \.sb-kiosk-sheet\s*\{[^}]*backdrop-filter:\s*blur/.test(css));

  // ── permissions really remove things from the screen ───────────────────────────────────────────────────────────────
  assert("D1 each permission gates its part of the screen", ["perms.skip", "perms.pause", "perms.search", "perms.reorder", "perms.jingles", "perms.volume", "perms.volumeMax"].every((x) => code.includes(x)));
  assert("D2 the volume cannot go past the owner's limit (pointer, keys and the shown value are all clamped to it)", /Math\.min\(cap, Math\.round\(/.test(code) && /Math\.min\(cap, Math\.max\(0, Math\.round\(value\)\)\)/.test(code) && /Math\.min\(cap, v \+ 5\)/.test(code));
  assert("D3 the password is a slim bar (lock → grey tick → red lock / green tick), not a dialog", code.includes("function PinBar") && !code.includes("PinDialog") && code.includes('data-state={state}') && code.includes("verifyKioskPin(pin)") && code.includes("tryUnlockKiosk(pin)"));

  assert("D4 the side panel shows ONE page at a time (cards), switched by icons; search / jingles have an icon only when the owner allows them", code.includes("sb-kiosk-rail") && code.includes("perms.search") && code.includes("perms.jingles") && /TABS\.filter/.test(code) && code.includes("function PanelCard") && code.includes('id === "jingles"'));
  assert("D5 minimal: no row of permission chips, no bottom day strip, and the volume shows no numbers or text", !code.includes("sb-kiosk-can") && !code.includes("<Can") && !code.includes("sb-kiosk-day-track") && !/<small>\{t\.vol/.test(code));
  assert("D6 an open panel nobody touches for a minute closes (the player goes back to the middle)", code.includes("setTab(null)") && code.includes("60_000"));

  assert("D7 the lock is only a lock; a click opens ONE bar in the middle (scrim + bar), Escape / outside click / 20 s put it away", code.includes("sb-kiosk-lock") && code.includes("setPinOpen(true)") && code.includes("sb-kiosk-scrim") && code.includes('e.key === "Escape"') && code.includes("20_000") && /\.sb-kiosk-scrim\s*\{[^}]*place-items:\s*center/.test(css));
  assert("D8 the layout is flipped between the languages (Hebrew: song left; English: song right) while every text keeps its own direction", code.includes('dir={he ? "rtl" : "ltr"}') && code.includes('["--k-layout-dir" as string]: he ? "ltr" : "rtl"') && code.includes('data-song={he ? "left" : "right"}') && /\.sb-kiosk-stage\s*\{[^}]*direction:\s*var\(--k-layout-dir/.test(css));
  const pal = read("lib", "cover-palette.ts");
  assert("D9 the background is BUILT from the cover's main colours (cover info → palette → glows), not a blurred picture", code.includes("coverInfo(cover, seed)") && code.includes("paletteFor(info, theme)") && css.includes(".sb-kiosk-glow") && pal.includes("getImageData") && !/ctx\.filter|blur\(/.test(pal + code));
  assert("D10 the drifting glows use transform only and stand still for reduced motion / light graphics", /@keyframes sb-kiosk-drift-a\s*\{[^}]*transform/.test(css) && css.includes("prefers-reduced-motion") && css.includes('html[data-sb-fx="lite"] .sb-kiosk-glow'));

  const layout = read("app", "layout.tsx");
  assert("D11 the password bar shows no word — a blinking line says \"type here\" (and typing still works)", !code.includes("t.lockBar") && code.includes("sb-kiosk-caret") && /@keyframes sb-kiosk-blink/.test(css) && /\.sb-kiosk-pinbar:not\(\[data-typed\]\) input\s*\{\s*caret-color:\s*transparent/.test(css));
  assert("D12 the display is set in Rubik (Hebrew + Latin), loaded only when used (preload off)", css.includes("var(--font-rubik)") && layout.includes("Rubik({") && layout.includes("preload: false") && layout.includes("rubik.variable"));
  assert("D13 song, panel and icons are centred on the middle of the screen height (clock + lock float on top; symmetrical vertical padding)", /\.sb-kiosk-top\s*\{[^}]*position:\s*absolute/.test(css) && /\.sb-kiosk-stage\s*\{[^}]*align-items:\s*center/.test(css) && /\.sb-kiosk-stage\s*\{[^}]*padding:\s*(\d+(?:\.\d+)?em) [^ ]+ \1 /.test(css) && /\.sb-kiosk-side\s*\{[^}]*align-items:\s*center/.test(css));


  assert("D14 no start / end times under the bar — the bar swells on hover and shows only the current minute (left end, under the bar)", !code.includes("sb-kiosk-times") && code.includes("sb-kiosk-at") && /\.sb-kiosk-seek:hover \.sb-kiosk-prog/.test(css) && /\.sb-kiosk-seek:hover \.sb-kiosk-at[^{]*\{[^}]*opacity:\s*1/.test(css));
  assert("D14b the bar is thin (2 px) and swells only slightly (4 px); the current minute sits under the LEFT end", /\.sb-kiosk-prog\s*\{[^}]*height:\s*max\(2px/.test(css) && /\.sb-kiosk-seek:hover \.sb-kiosk-prog[^{]*\{[^}]*height:\s*max\(4px/.test(css) && /\.sb-kiosk-at\s*\{[^}]*left:\s*0/.test(css));
  assert("D15 the lock and the sun / moon have no circle around them", /\.sb-kiosk-lock, \.sb-kiosk-theme\s*\{[^}]*background:\s*transparent/.test(css) && !/\.sb-kiosk-(lock|theme):hover[^{]*\{[^}]*background/.test(css));
  assert("D16 the song sits on one EDGE of the screen and the panel group on the other (and Hebrew / English are exact opposites)", /\.sb-kiosk-stage\s*\{[^}]*justify-content:\s*space-between/.test(css));
  assert("D17 the palette counts AREA and keeps only main colours (a small detail such as a yellow guitar does not become a glow); a one-colour cover gets close neighbours", pal.includes("MIN_SHARE") && pal.includes("share < MIN_SHARE") && pal.includes("AREA first") && /drift\(base\.hue, 14\)/.test(pal)); // (2026-10-26: the neighbour hues go through drift() — same close neighbours, but a yellow's drift to amber instead of green)
  const launch = read("components", "kiosk-launch-button.tsx");
  assert("D18 the controller has a button that opens the display screen — placed by the shell on the player cell, NOT inside the playback chain", shell.includes("<KioskLaunchButton />") && (shell.match(/<KioskLaunchButton \/>/g) ?? []).length === 1 && launch.includes("lockKiosk()") && !player.includes("KioskLaunchButton") && !player.includes("lockKiosk"));

  assert("D19 the lock and the sun / moon sit in the two top corners at the SAME distance from the top and from the side (one variable for both)", /\.sb-kiosk-lock, \.sb-kiosk-theme\s*\{[^}]*top:\s*var\(--k-edge\)/.test(css) && /\[data-song="left"\] \.sb-kiosk-lock[^{]*\{\s*left:\s*var\(--k-edge\)/.test(css) && /\[data-song="right"\] \.sb-kiosk-lock[^{]*\{\s*right:\s*var\(--k-edge\)/.test(css) && !/<header className="sb-kiosk-top">[\s\S]*?<\/header>/.exec(code)?.[0].includes("sb-kiosk-lock"));
  assert("D20 the current-minute label is small and in its own light monospace face (not the big thin one)", /\.sb-kiosk-at\s*\{[^}]*font-family:\s*var\(--font-geist-mono\)[^}]*font-size:\s*1em[^}]*font-weight:\s*300/.test(css));

  assert("D21 the password bar is near-solid (not see-through) and the open bar blurs what is behind it", /\.sb-kiosk-pinbar\s*\{[^}]*background:\s*#141a36/.test(css) && !/\.sb-kiosk-pinbar\s*\{[^}]*background:\s*rgba\(255, 255, 255, 0\.16\)/.test(css) && css.includes('.sb-kiosk[data-pin="1"] .sb-kiosk-glow i'));

  // ── 2026-10-25 round: light / dark, scaling, entrance, gentle pause, buttons, volume ──
  assert("T1 the display has a dark and a light look; a sun / moon on the screen switches it (kept per device; follows the app's white mode until a choice is made)", code.includes("useKioskTheme") && code.includes("data-theme={theme}") && code.includes("sb-kiosk-theme") && /\.sb-kiosk\[data-theme="light"\]\s*\{[^}]*--k-w:/.test(css));
  assert("T2 the theme store works (default: by the song; the sun / moon pins light or dark; back to auto)", (() => {
    store.clear();
    const a = k.readKioskTheme();
    k.setKioskTheme("light");
    const b = k.readKioskTheme();
    k.setKioskTheme("dark");
    const c = k.readKioskTheme();
    k.setKioskTheme("auto");
    return a === "auto" && b === "light" && c === "dark" && k.readKioskTheme() === "auto" && store.get("syncbiz-kiosk-theme") === "auto";
  })());
  const displayCss = css.slice(0, css.indexOf("/* the controller's button for the display screen"));
  assert("T3 everything is sized from ONE number (em from --k-fs) so the screen adapts to any display — no vh / vw / px font sizes outside it", /\.sb-kiosk\s*\{[^}]*--k-fs:\s*clamp\(/.test(css) && /font-size:\s*var\(--k-fs\)/.test(css) && !/\d\s*(vh|vw)\b/.test(displayCss.replace(/--k-fs:[^;]*;/, "").replace(/\(50vw - [\d.]+em\)/g, "")) && !/font-size:\s*[\d.]+px/.test(displayCss));
  assert("T4 the screen comes up calmly: the song's colours first, then everything rises into place one after another (and the leftover boot cover is removed)", /\.sb-kiosk\[data-intro="1"\]/.test(css) && css.includes("@keyframes sb-kiosk-rise-in") && code.includes("data-intro={intro") && code.includes('removeAttribute("data-sb-kiosk-boot")'));
  const fade = await import("../lib/kiosk-fade");
  const run = async (toPlay: boolean, v0: number, boom = false) => {
    const log: string[] = [];
    let at = 0;
    await fade.gentleToggle(toPlay, v0, {
      volume: (v) => log.push(`v${v}`),
      play: () => {
        log.push("play");
        if (boom) throw new Error("boom");
      },
      pause: () => log.push("pause"),
      sleep: async (ms) => void (at += ms),
    }).catch(() => {});
    return { log, at };
  };
  const down = await run(false, 80);
  const downV = down.log.filter((x) => x.startsWith("v")).map((x) => Number(x.slice(1)));
  assert("T5 gentle pause: the volume steps DOWN smoothly to 0, THEN pauses, then the volume is put back exactly", downV[0]! < 80 && downV.slice(0, -1).every((v, i, a) => i === 0 || v <= a[i - 1]!) && downV[downV.length - 2] === 0 && downV[downV.length - 1] === 80 && down.log.indexOf("pause") === down.log.length - 2 && down.at >= 800 && down.at <= 1100, down.log.join(","));
  const up = await run(true, 60);
  const upV = up.log.filter((x) => x.startsWith("v")).map((x) => Number(x.slice(1)));
  assert("T5b gentle play: starts silent, plays, climbs up to the old level and ends exactly there", up.log[0] === "v0" && up.log[1] === "play" && upV[upV.length - 1] === 60 && upV.slice(1, -1).every((v, i, a) => i === 0 || v >= a[i - 1]!), up.log.join(","));
  const boom = await run(true, 50, true);
  assert("T5c if anything fails mid-way the volume is STILL put back", boom.log[boom.log.length - 1] === "v50", boom.log.join(","));
  const mute = await run(false, 0);
  assert("T5d a silent player is just paused (nothing to fade)", mute.log.join(",") === "pause");
  assert("T5e the display uses the interruptible fader, and the button changes at once", code.includes("createGentle(") && code.includes("want ??") && !code.includes("fading.current"));
  assert("T6 the three buttons have no circle behind them: they grow on hover, squeeze on press, nudge their icon and send one ring", /\.sb-kiosk-ctl button:hover\s*\{\s*transform:\s*scale\(1\.\d+\)\s*;?\s*\}/.test(css) && css.includes(".sb-kiosk-pulse") && css.includes("sb-kiosk-nudge-prev") && code.includes("function CtlButton"));
  assert("T7 the volume is the controller's own style (speaker + thin capsule with a fill and no knob), not a browser slider", !/<input type="range"/.test(code) && css.includes(".sb-kiosk-vol-track") && /\.sb-kiosk-vol-line:hover \.sb-kiosk-vol-track/.test(css));
  assert("T8 a grey / black-and-white cover gets calm greys (dark look) or silver (light look) instead of an invented blue", pal.includes("function neutral(lum: number, light: boolean)") && pal.includes("neutral(info.lum, light)"));
  const boot = read("lib", "fx-boot.ts");
  assert("T9 a screen that boots locked in the light look starts on the light colour (no dark flash)", boot.includes("syncbiz-kiosk-theme") && css.includes('html[data-sb-kiosk-boot="locked"][data-sb-kiosk-theme="light"]::before'));

  assert("D22 search results are de-duplicated by video (the same video twice would be a duplicate React key)", code.includes('!out.some((o) => o.kind === "song" && o.vid === vid)'));

  // ── 2026-10-25 round 3: white songs give a white screen, no frame on the bar, seek permission, more results, no scrolling, one-line title ──
  const con = read("components", "management", "display-settings-console.tsx");
  const pf = await import("../lib/cover-palette");
  const lightness = (c: string) => Number(/(\d+)%\)$/.exec(c)?.[1]);
  const sat = (c: string) => Number(/\d+ (\d+)%/.exec(c)?.[1]);
  const gold = { main: [{ hue: 52, sat: 0.9, share: 1 }], none: false, grey: false, lum: 0.3, light: false, seed: null };
  const darkGold = pf.paletteFor(gold, "dark");
  const lightGold = pf.paletteFor({ ...gold, light: true }, "light");
  assert("A1 the dark look keeps a yellow GOLD (never darkened into olive mud); the light look is bright and fresh", lightness(darkGold[0]!) >= 42 && lightness(lightGold[0]!) >= 56 && lightness(lightGold[0]!) > lightness(darkGold[0]!), { darkGold, lightGold });
  const greyDark = pf.paletteFor({ main: [], none: false, grey: true, lum: 0.2, light: false, seed: null }, "dark");
  const greyLight = pf.paletteFor({ main: [], none: false, grey: true, lum: 0.8, light: true, seed: null }, "light");
  assert("A2 grey covers: low-saturation graphite (dark) / silver (light) — no invented colour", greyDark.every((c) => sat(c) <= 10) && greyLight.every((c) => sat(c) <= 10) && lightness(greyLight[0]!) > lightness(greyDark[0]!), { greyDark, greyLight });
  assert("A3 a WHITE cover turns the screen white by itself (with a hysteresis band so it never flickers; the sun / moon can pin it), and the ink + base + veil fade together", code.includes("info.lum >= 0.52") && code.includes("info.lum < 0.4") && code.includes('themePref === "auto" ? (autoLight ? "light" : "dark") : themePref') && /@property --k-w\s*\{[^}]*"<number>\+"/.test(css) && /\.sb-kiosk\s*\{[^}]*transition:[^;]*--k-w var\(--k-fade\)/.test(css) && /--k-fade:\s*1800ms/.test(css));
  assert("A4 the password bar has no frame (no hairline ring) and no colour of its own when right; its icon is on the corner lock's side; the ✓ draws into a ring and back", !/\.sb-kiosk-pinbar\s*\{[^}]*inset 0 0 0 1px/.test(css) && !/\.sb-kiosk-pinbar\[data-state="(ok|bad)"\]\s*\{[^}]*background/.test(css) && /\.sb-kiosk-pinbar\s*\{[^}]*direction:\s*var\(--k-layout-dir/.test(css) && code.includes("const OkMark") && css.includes("sb-kiosk-ring-draw") && css.includes("sb-kiosk-ring-undraw"));
  assert("A5 coming back to the display always shows the plain screen (the password bar state is reset and the panel closed when the screen comes up)", /setPinOpen\(false\);[^\n]*\n\s*setTab\(null\)/.test(kd));
  k.setKioskPermissions({ seek: false });
  assert("A6 'move within the song' is ON by default (the owner can switch it off); the bar is a slider that jumps with the transport's own seek", k.DEFAULT_KIOSK_PERMISSIONS.seek === true && (k.setKioskPermissions({ seek: false }), k.getKioskPermissions().seek === false) && (k.setKioskPermissions({ seek: true }), k.getKioskPermissions().seek === true) && code.includes("perms.seek") && code.includes("seekOrSend") && code.includes("onSeek(f * duration)") && con.includes("seek:"));
  assert("A7 the search shows the FIRST 4 results with a More button that shows 4 more (the search itself brings at most 15); the list is bounded and only scrolls after More", code.includes("const HITS_FIRST = 4;") && code.includes("const HITS_STEP = 4;") && code.includes("shown.slice(0, limit)") && code.includes("sb-kiosk-more") && code.includes("setLimit(from + HITS_STEP)") && code.includes("out.length >= 15") && /\.sb-kiosk-hits-wrap\s*\{[^}]*max-height[^}]*overflow-y:\s*auto/.test(css) && /\.sb-kiosk-hits-wrap\[data-long="1"\]\s*\{[^}]*mask-image/.test(css) && !/\.sb-kiosk-hits-wrap\s*\{[^}]*mask-image/.test(css));
  assert("A8 nothing scrolls: the page behind is locked while the display is up, the display itself clips, only the result list scrolls", /html\[data-sb-kiosk="locked"\][^{]*\{[^}]*overflow:\s*hidden/.test(css) && /\.sb-kiosk-root\s*\{[^}]*overflow:\s*hidden/.test(css) && /\.sb-kiosk-stage\s*\{[^}]*overflow:\s*hidden/.test(css));
  assert("A9 the song title is ONE line with three dots when it goes on", /\.sb-kiosk-title\s*\{[^}]*white-space:\s*nowrap[^}]*\}/.test(css) && !/\.sb-kiosk-title\s*\{[^}]*line-clamp/.test(css));
  assert("A10 a new cover comes up slowly with a soft zoom while the old one sinks away underneath", code.includes("function CoverArt") && /sb-kiosk-art-in\s+1900ms/.test(css) && /sb-kiosk-art-out\s+1900ms/.test(css));
  assert("A11 the panel's icons have no circle: the one that is on is white and a little bigger, the others grey, with a slow transition", /\.sb-kiosk-rail button\s*\{[^}]*background:\s*transparent[^}]*color:\s*rgb\(var\(--k-w\) \/ 0\.4\)/.test(css) && /\.sb-kiosk-rail button\[data-active="1"\]\s*\{[^}]*scale\(1\.22\)/.test(css) && !/\.sb-kiosk-rail button\[data-active="1"\]\s*\{[^}]*background/.test(css));
  assert("A12 placement: the song 15em in from its edge when a panel is open, the panel and its icons symmetric on the other side (gap 4.35em), icons 2.2em from the corner", /padding-inline:\s*15em 2\.2em/.test(css) && /\.sb-kiosk-side\s*\{[^}]*gap:\s*4\.35em/.test(css));

  assert("D23 the controller's button for the display screen is ONLY the icon (no text, no circle, no background)", !/<span>\{label\}<\/span>/.test(launch) && /\.sb-kiosk-launch\s*\{[^}]*background:\s*transparent/.test(css) && !/\.sb-kiosk-launch:hover\s*\{[^}]*background/.test(css));

  assert("T10 nothing open → the player stands in the MIDDLE and the next song is a notice in the corner; one icon open → the player slides aside and the panel comes in; the same icon closes it", code.includes("useState<TabId | null>(null)") && code.includes("choose(x.id)") && /\.sb-kiosk-now\s*\{[^}]*transform:\s*translateX\(calc\(var\(--k-sign, 1\) \* \(50vw - 25\.75em\)\)\)/.test(css) && /\[data-panel="1"\] \.sb-kiosk-now\s*\{\s*transform:\s*none/.test(css) && code.includes("sb-kiosk-notice") && /\[data-song="left"\] \.sb-kiosk-notice\s*\{\s*right:/.test(css) && /\[data-song="right"\] \.sb-kiosk-notice\s*\{\s*left:/.test(css) && /\[data-panel="1"\] \.sb-kiosk-notice\s*\{[^}]*opacity:\s*0/.test(css));
  assert("T11 the controller's display icon sits at the same distance from the shell's right (left) edge and bottom edge", /\.sb-kiosk-launch\s*\{[^}]*bottom:\s*6px/.test(css) && /html\[dir="ltr"\] \.sb-kiosk-launch\s*\{[^}]*bottom:\s*6px/.test(css));

  assert("F1 no colour flicker: the last cover info stays through the gap between songs (idle colours only after 2.5 s), and an invisible palette change does not crossfade", code.includes("setTimeout(() => !off && setInfo(NO_COVER), 2500)") && code.includes("function similar(") && code.includes("!similar(now, palette)"));
  assert("F2 the cover has NO shadow (nothing can be left behind at its old place), the sliding player is its own layer, and light graphics mode turns the per-frame colour animation off", !/\.sb-kiosk-art\s*\{[^}]*box-shadow/.test(css) && /\.sb-kiosk-now\s*\{[^}]*will-change:\s*transform/.test(css) && css.includes('html[data-sb-fx="lite"] .sb-kiosk { transition: opacity 420ms ease; }'));
  assert("F3 the panel's pages are cards that always move UP, exactly as accepted before the last change: the old page leaves upward, the new one follows 170 ms later from further below, pages centred in the box; the soft edges exist only while moving", code.includes("dir: 1, epoch: c.epoch, n: c.n + 1") && /\.sb-kiosk-card\[data-state="in"\]\s*\{[^}]*sb-kiosk-card-in 900ms[^}]*170ms/.test(css) && /\.sb-kiosk-card\[data-state="out"\]\s*\{[^}]*sb-kiosk-card-out 560ms/.test(css) && /\.sb-kiosk-card\s*\{[^}]*justify-content:\s*center/.test(css) && /\.sb-kiosk-card\[data-id="search"\]\s*\{[^}]*justify-content:\s*flex-start/.test(css) && /\.sb-kiosk-panel-box\[data-moving="1"\]\s*\{[^}]*mask-image/.test(css) && !/\.sb-kiosk-panel-box\s*\{[^}]*mask-image/.test(css) && /translateY\(13em\)/.test(css) && /translateY\(-13em\)/.test(css));
  assert("F4 the transport icons are rounded (rounded bars, rounded triangles), the notice says only 'Next' and has no frame, the default colours are TWO (yellow + orange), the password dots keep their distance from the rounded end", (kd.match(/rx="1\.[49]"/g) ?? []).length >= 3 && code.includes("t.nextShort") && !/\.sb-kiosk-notice\s*\{[^}]*background:/.test(css) && pal.includes("hsl(40 96% 46%)") && pal.includes("hsl(12 88% 42%)") && /padding:\s*0 1\.3em 0 1\.7em/.test(css));

  assert("F5 the slow background drift is drawn in a few steps a second (looks the same, keeps a computer without a graphics card from redrawing the screen 60 times a second)", /\.sb-kiosk-glow i\s*\{[^}]*animation:[^;]*steps\(\d+, end\)/.test(css));

  assert("G1 the search is only a bar: no heading, no placeholder text; the magnifier waits in the middle and glides to where reading starts ONLY when the bar is clicked (focus) or something is typed — resting the pointer on it does nothing, and the bar is not focused by itself", code.includes('id !== "search" ? <h3>') && !/placeholder=\{t\.search\}/.test(code) && !/autoFocus/.test(code.slice(code.indexOf("function Search("), code.indexOf("function useLibraryLists"))) && /\.sb-kiosk-search-ico\s*\{[^}]*inset-inline-start:\s*50%/.test(css) && /\.sb-kiosk-search:focus-within \.sb-kiosk-search-ico\s*\{[^}]*inset-inline-start:\s*1\.5em/.test(css) && !/\.sb-kiosk-search:hover/.test(css));
  assert("G2 rows in the queue no longer jitter while a page slides: the row-slide effect measures layout positions, not positions on the screen", code.includes("li.offsetTop") && !/const top = li\.getBoundingClientRect/.test(code));
  const tips = read("components", "no-native-tooltips.tsx");
  assert("G3 no hover tooltips anywhere: every title attribute is taken off (kept as aria-label when the element has no other name), mounted once in the root layout", tips.includes('removeAttribute("title")') && tips.includes("MutationObserver") && read("app", "layout.tsx").includes("<NoNativeTooltips />"));
  const surf = read("components", "player-surface", "player-deck-transport-surface.tsx");
  assert("G4 the controller's shuffle / loop icons grow on hover instead of showing a circle; the stop square is quieter", !surf.includes("text-white hover:bg-white/[0.2]") && !surf.includes("text-[#8e8e93] hover:bg-white/[0.06]") && (surf.match(/hover:scale-\[1\.14\]/g) ?? []).length >= 2 && read("app", "globals.css").includes(".deck-transport-btn--stop { color: rgba(255, 255, 255, 0.5) !important; }"));
  assert("G5 the last screen comes up first: the last song + its colours are kept and shown until the player says what is playing (at most 8 s), a window that comes back to the front looks at the cover / the clock again, and a stuck cover read gives up after 9 s", code.includes('SNAP_KEY = "syncbiz-kiosk-last"') && code.includes("cold && snap && !live.title") && code.includes('document.addEventListener("visibilitychange"') && pal.includes("setTimeout(() => done(failed(seed, url), false), 9000)") && pal.includes("export function forgetPending"));

  assert("H1 the lock is the same distance from the top as from the side (its drawn shape measured 46.3 / 46.3 px at 1600×900) — only a ~1 px nudge, no raise", /\.sb-kiosk-lock\s*\{\s*top:\s*calc\(var\(--k-edge\) \+ 0\.0625em\)/.test(css) && !/0\.65em/.test(css.slice(css.indexOf(".sb-kiosk-lock"), css.indexOf(".sb-kiosk-lock:hover"))));

  assert("J1 the queue rows have a drag handle (three bars, the middle one shorter) instead of the arrows: the row follows the pointer, the others make room, the drop reorders with the provider\'s own two calls", code.includes("sb-kiosk-grip") && code.includes("M5 7.5h14M7.5 12h9M5 16.5h14") && !code.includes("sb-kiosk-move") && code.includes("onMoveTo(r, target.index)") && code.includes("moveTo: (r: Row, to: number)") && /\.sb-kiosk-next li, \.sb-kiosk-hits li\s*\{[^}]*backwards/.test(css));
  assert("J2 every search result has a three-dots button that opens a glass sheet beside the list (toward the middle) with Play now · Play next · Add to playlist · Schedule, each with an icon; transparent + blurred", code.includes("function ResultSheet") && ["playNow", "playNext", "addToList", "scheduleIt"].every((k) => code.includes(`t.${k}`)) && /\[data-song="left"\] \.sb-kiosk-sheet\s*\{\s*right:\s*calc\(100% \+ 1\.3em\)/.test(css) && /\[data-song="right"\] \.sb-kiosk-sheet\s*\{\s*left:\s*calc\(100% \+ 1\.3em\)/.test(css) && /\.sb-kiosk-sheet\s*\{[^}]*rgb\(var\(--k-w\) \/ 0\.08\)/.test(css) && code.includes("createPortal(") && code.includes("tr.playNow(src)") && code.includes("tr.queueNext(src)"));
  assert("J3 'Play now' is the ONLY place the display replaces what is playing (through the transport's own play), 'Add to playlist' and 'Schedule' need the owner's library switch (on by default)", (code.match(/playback\.playSource\(/g) ?? []).length === 1 && code.includes("playNow: (s: UnifiedSource)") && code.includes("playSourceOrSend") && code.includes("canLibrary = perms.library") && k.DEFAULT_KIOSK_PERMISSIONS.library === true && con.includes("library:"));
  assert("J4 the library\'s playlists (not single songs) are searched too and shown first, marked \"Playlist\"", code.includes('fetchUnifiedSourcesWithFallback') && code.includes('entityKind === "collection"') && code.includes('kind: "list"') && code.includes("t.listWord"));
  assert("J5 nothing fills in late while a page slides: the jingles are loaded once when the display comes up (the search page is anchored at the top so its growing results never re-centre it)", code.includes("function useJingles") && code.includes("useJingles(shown && perms.jingles, jingleVer)") && /\.sb-kiosk-card\[data-id="search"\]\s*\{[^}]*justify-content:\s*flex-start/.test(css));

  // ── the owner's settings page ───────────────────────────────────────────────────────────────────────────────────────
  const page = read("app", "(app)", "access-control", "display", "page.tsx");
  assert("O1 the settings page is a management page (manager-only gate, under /access-control so the player row is hidden)", page.includes("ManagementGate") && page.includes('from="/access-control/display"'));
  const tabs = read("components", "management", "management-tabs.tsx");
  assert("O2 it is a tab of the management tabs", tabs.includes('"/access-control/display"') && tabs.includes('"nav.display"'));
  const mgmt = read("lib", "i18n", "management.ts");
  assert("O3 the tab has its English and Hebrew names", (mgmt.match(/"nav\.display"/g) ?? []).length === 2);
  assert("O4 the console edits the password, every permission and the volume limit", con.includes("setKioskPin") && ["skip", "pause", "search", "reorder", "jingles", "volume"].every((x) => con.includes(`${x}:`)) && con.includes("volumeMax"));

  // ── 2026-10-26 phase 16: smooth by default (pause / play, bars), fast clicks, calendar, notice, light colours ──
  const mk = () => {
    const log: string[] = [];
    const waiters: Array<() => void> = [];
    const io = { volume: (v: number) => log.push(`v${v}`), play: () => log.push("play"), pause: () => log.push("pause"), sleep: () => new Promise<void>((r) => void waiters.push(r)) };
    const tick = async (n = 1) => {
      for (let i = 0; i < n; i++) {
        waiters.shift()?.();
        for (let j = 0; j < 6; j++) await Promise.resolve();
      }
    };
    const drain = async () => {
      for (let i = 0; i < 80 && waiters.length; i++) await tick();
    };
    return { log, io, tick, drain };
  };
  const nums = (log: string[]) => log.filter((x) => /^v\d+$/.test(x)).map((x) => Number(x.slice(1)));
  {
    // play, then pause while the song is still coming up: the LAST click wins, from where the song is (no jump up, no second play, ends paused with the volume restored)
    const a = mk();
    const g = fade.createGentle(a.io);
    const p1 = g.toggle(true, 80);
    await a.tick(4); // 160 ms silence, then a few steps up
    const before = nums(a.log).length;
    const p2 = g.toggle(false, 80);
    await a.drain();
    await Promise.all([p1, p2]);
    const after = nums(a.log).slice(before);
    assert("L1 fast clicks: play then pause (before the song has come up) → the pause is NOT swallowed: one play, one pause, ends paused with the volume put back exactly", a.log.filter((x) => x === "play").length === 1 && a.log.filter((x) => x === "pause").length === 1 && a.log.indexOf("pause") > a.log.indexOf("play") && a.log[a.log.length - 1] === "v80" && g.busy() === false, a.log.join(","));
    const lastUp = nums(a.log)[before - 1]!;
    assert("L2 …and the pause carries on from the volume the song has RIGHT NOW (no jump up, no blip)", after[0]! <= lastUp && after.slice(0, -1).every((v, i, arr) => i === 0 || v <= arr[i - 1]!), { lastUp, after });
    // pause, then play again while it is still easing down: the song never paused, so no pause and no second play — it simply comes back up
    const b = mk();
    const g2 = fade.createGentle(b.io);
    const q1 = g2.toggle(false, 80);
    await b.tick(4);
    const q2 = g2.toggle(true, 80);
    await b.drain();
    await Promise.all([q1, q2]);
    assert("L3 fast clicks: pause then play (while it is still easing down) → never paused, never re-played, comes back to the exact volume", !b.log.includes("pause") && !b.log.includes("play") && b.log[b.log.length - 1] === "v80" && g2.busy() === false, b.log.join(","));
    // four clicks in a row end where the last click says
    const c = mk();
    const g3 = fade.createGentle(c.io);
    const r = [g3.toggle(true, 70)];
    for (const to of [false, true, false]) {
      await c.tick(2);
      r.push(g3.toggle(to, 70));
    }
    await c.drain();
    await Promise.all(r);
    const last = c.log.filter((x) => x === "play" || x === "pause").pop();
    assert("L4 four quick clicks (play, pause, play, pause) end PAUSED and the volume is exactly the owner's", last === "pause" && c.log[c.log.length - 1] === "v70" && g3.busy() === false, c.log.join(","));
  }
  assert("L5 the button follows the click at once and keeps showing it until the player confirms (a song that is still loading does not flip it back); after 6 s it shows the truth", code.includes("const settled = want !== null && shield === null") && code.includes("setWant(null), 6000") && code.includes("setShield(null), 450") && code.includes("gentleRef.current ??= createGentle("));
  assert("L6 play / pause is ONE icon pair melting into each other (CSS transitions, nothing re-mounts → no pop, no flicker)", code.includes("function PlayPauseIcon") && code.includes("<PlayPauseIcon playing={playing} />") && /\.sb-kiosk-swap svg\s*\{[^}]*transition:[^}]*opacity[^}]*transform/.test(css) && /\.sb-kiosk-swap svg\[data-on="0"\]\s*\{[^}]*opacity:\s*0[^}]*scale\(0\.55\)/.test(css) && !css.includes("@keyframes sb-kiosk-pop") && code.includes('key={kind === "play" ? "play" : hit}'));
  assert("L7 the progress bar GLIDES to a pressed spot, follows the pointer smoothly while dragged, and after letting go stays where it was put until the player's position has arrived (no jump back)", code.includes("data-glide={glide") && code.includes("setHold(f)") && code.includes("scrub ?? hold ??") && /\.sb-kiosk-seek\[data-glide="1"\] \.sb-kiosk-prog span\s*\{[^}]*transition:\s*width 4\d\dms cubic-bezier/.test(css) && /\.sb-kiosk-seek\[data-scrub="1"\] \.sb-kiosk-prog span\s*\{[^}]*transition:\s*width \d+ms cubic-bezier/.test(css) && !/\.sb-kiosk-seek\[data-scrub="1"\] \.sb-kiosk-prog span\s*\{\s*transition:\s*none/.test(css));
  assert("L8 the volume bar does the same: glides to a pressed spot, follows the pointer (every move, only the commands are throttled), holds until the player reports the level, eases for every other change", code.includes("const shown = drag ?? hold ?? v;") && code.includes("data-glide={glide") && code.includes("setHold(next)") && /\.sb-kiosk-vol-track b\s*\{[^}]*transition:\s*width 3\d\dms cubic-bezier/.test(css) && /\.sb-kiosk-vol\[data-glide="1"\] \.sb-kiosk-vol-track b\s*\{[^}]*transition:\s*width/.test(css) && /\.sb-kiosk-vol\[data-drag="1"\] \.sb-kiosk-vol-track b\s*\{[^}]*transition:\s*width \d+ms/.test(css));
  const lightRed = pf.paletteFor({ main: [{ hue: 350, sat: 0.9, share: 1 }], none: false, grey: false, lum: 0.6, light: true, seed: null }, "light");
  assert("M1 the light look's colours are STRONG (mid lightness, high saturation — not pastel), the glows are nearly opaque and the veil is light", lightRed.every((c) => lightness(c) <= 66 && sat(c) >= 78) && /\.sb-kiosk\[data-theme="light"\]\s*\{[^}]*--k-va:\s*0\.5;[^}]*--k-vb:\s*0\.22/.test(css) && /\[data-theme="light"\] \.sb-kiosk-glow i\s*\{\s*opacity:\s*0\.95/.test(css), lightRed);
  assert("M2 the schedule sheet has no Today / Tomorrow pair: 'Today' is a date button that opens a calendar (days before today cannot be picked, week starts Sunday, month arrows), and the schedule uses the picked date", code.includes("function CalendarPicker") && !code.includes("dayTomorrow") && code.includes("pickDate") && code.includes("t.dayToday") && code.includes("oneOffDateLocal: ymdOf(date)") && /disabled=\{d < today\}/.test(code) && /\.sb-kiosk-sheet\[data-view="cal"\]\s*\{[^}]*max-height/.test(css) && css.includes(".sb-kiosk-cal-day[data-on=\"1\"]") && !css.includes(".sb-kiosk-when-days"));
  assert("M3 the default schedule time is half an hour from now rounded UP to five minutes — and a time past midnight also moves the default DATE (no more 'hh:00 of the same hour' at the end of an hour)", code.includes("Math.ceil((Date.now() + 30 * 60_000) / 300_000) * 300_000") && code.includes("useState(() => startOfDay(soon))") && !code.includes("=== 60 ? 0"));
  assert("M4 the next-song notice is no wider than the three buttons (20.2em) and leaves quickly when a panel opens: it slides toward its edge, shrinks a hair and fades (and returns the same way)", /\.sb-kiosk-notice\s*\{[^}]*max-width:\s*20\.2em/.test(css) && /\.sb-kiosk\[data-panel="1"\] \.sb-kiosk-notice\s*\{[^}]*opacity:\s*0[^}]*translateX\(calc\(var\(--k-sign, 1\) \* 3\.2em\)\) scale\(0\.92\)[^}]*transition:[^}]*opacity 3\d\dms[^}]*transform 4\d\dms/.test(css));

  // ── 2026-10-26 phase 17: "My playlists" page, click-only search, the writing line on the side where the language starts ──
  const kd2 = read("components", "kiosk-display.tsx");
  assert("N1 the side panel has a 'My playlists' page (its own icon after the search, heading, rows with the library's playlists, ▶ that puts one on through the transport's own play, the same ⋯ sheet as a search result)", kd2.includes('{ id: "lists"') && kd2.includes("function Playlists(") && kd2.includes("<Playlists t={t} he={he} lists={lists} />") && kd2.includes("tr.playNow(h.src)") && kd2.includes("t.songsCount(count(h))") && /lists: "הפליילסטים שלי"/.test(kd2) && /lists: "My playlists"/.test(kd2) && /\.sb-kiosk-plist-play\s*\{/.test(css));
  assert("N2 the playlists come from ONE loader shared by the search and the page: loaded when the display comes up, refreshed quietly when the search / playlists page opens or the library changes (the old list stays on screen — nothing fills in late)", kd2.includes("function useLibraryLists(") && kd2.includes('addEventListener("library-updated"') && kd2.includes("useLibraryLists(shown && (perms.search || perms.playlists)") && !/function Search[\s\S]*fetchUnifiedSourcesWithFallback[\s\S]*function useLibraryLists/.test(kd2));
  const kk = await import("../lib/kiosk");
  store.delete("syncbiz-kiosk-settings");
  const defaultsOn = kk.getKioskPermissions().playlists === true && kk.DEFAULT_KIOSK_PERMISSIONS.playlists === true;
  kk.setKioskPermissions({ playlists: false });
  const off = kk.getKioskPermissions().playlists === false;
  kk.setKioskPermissions({ playlists: true });
  store.delete("syncbiz-kiosk-settings");
  assert("N3 the owner controls the page: a 'playlists' switch (on by default) in Display screen settings; switched off → the icon and the page are gone", defaultsOn && off && kd2.includes('x.id === "lists" ? perms.playlists') && con.includes("playlists:") && con.includes('"playlists"'));
  assert("N4 the search field's direction follows the language while it is EMPTY (so the writing line blinks at the side where Hebrew / English starts, next to the magnifier) and goes automatic once something is typed", kd2.includes('dir={q ? "auto" : he ? "rtl" : "ltr"}'));

  // ── 2026-10-26 phase 18: Jingles tab + Lock screen design ──
  const kd3 = read("components", "kiosk-display.tsx");
  const dz = await import("../lib/kiosk-design");
  store.delete("syncbiz-kiosk-design");
  const def = dz.getKioskDesign();
  assert("R1 until the owner designs it the screen is exactly the screen the pilot has had: full player, every icon, clock, next-song notice", def.layout === "full" && def.icons.join() === "next,search,lists,jingles,day" && def.clock === true && def.notice === true);
  store.set("syncbiz-kiosk-design", JSON.stringify({ layout: "weird", icons: ["day", "nope", "jingles", "jingles"], clock: "yes" }));
  const messy = dz.getKioskDesign();
  assert("R2 a damaged / odd stored design never breaks the screen: unknown values fall back, icons are kept in their fixed order, unknown ids dropped", messy.layout === "full" && messy.icons.join() === "jingles,day" && messy.clock === true && messy.notice === true, messy);
  store.set("syncbiz-kiosk-design", "{not json");
  assert("R3 unreadable data = the default design", dz.getKioskDesign().layout === "full" && dz.getKioskDesign().icons.length === 5);
  store.delete("syncbiz-kiosk-design");
  const sup = dz.KIOSK_PRESETS.find((x) => x.id === "supermarket")!.design;
  const song = dz.KIOSK_PRESETS.find((x) => x.id === "song")!.design;
  assert("R4 the presets: Café = full + everything; Supermarket = small square + ONLY the Jingles icon + clock, no notice; Just the song = small square, no icons", dz.KIOSK_PRESETS.length === 3 && sup.layout === "mini" && sup.icons.join() === "jingles" && sup.clock && !sup.notice && song.layout === "mini" && song.icons.length === 0 && dz.KIOSK_PRESETS[0]!.design.layout === "full" && dz.KIOSK_PRESETS[0]!.design.icons.length === 5);
  dz.applyKioskPreset("supermarket");
  const afterPreset = dz.getKioskDesign();
  const savedRaw = store.get("syncbiz-kiosk-design") ?? "";
  dz.setKioskDesign({ icons: ["jingles", "search"] });
  const custom = dz.getKioskDesign();
  assert("R5 a preset is saved at once; changing one thing makes it 'custom' (no preset matches); icons stay in their fixed order", afterPreset.layout === "mini" && savedRaw.includes('"layout":"mini"') && dz.matchingPreset(afterPreset) === "supermarket" && custom.icons.join() === "search,jingles" && dz.matchingPreset(custom) === null);
  store.delete("syncbiz-kiosk-design");
  assert("R6 the screen follows the design: an icon is shown only when the DESIGN includes it AND staff are allowed to use it; no icons = no side section; the clock and the notice can be switched off", kd3.includes("design.icons.includes(x.id) && (x.id === \"search\" ? perms.search") && kd3.includes("{tabs.length > 0 ? (") && kd3.includes("{design.clock ? (") && kd3.includes("design.notice && view.rows[0]") && kd3.includes("data-layout={design.layout}"));
  assert("R7 the small square (corner bar): only the picture; the two pause bars on it while the pointer rests on it, a press pauses / resumes through the same gentle fade, paused keeps the play triangle on it; without the pause permission it is only a picture", kd3.includes("function MiniBar(") && kd3.includes("<MiniBar t={t} view={view} has={has} playing={playing} canPause={perms.pause} onToggle={() => gentle(!playing)} position={pos.position} duration={pos.duration} />") && /\.sb-kiosk-mini:hover :is\(\.sb-kiosk-mini-veil, \.sb-kiosk-mini-ico\)/.test(css) && /\.sb-kiosk-mini\[data-paused="1"\] :is\(\.sb-kiosk-mini-veil, \.sb-kiosk-mini-ico\)/.test(css) && /\.sb-kiosk-mini\s*\{[^}]*width:\s*4\.8em/.test(css) && kd3.includes('<div className="sb-kiosk-mini">{inner}</div>') && !kd3.includes("sb-kiosk-mini-info"));
  const icons = read("components", "kiosk-tab-icons.tsx");
  const consoleDz = read("components", "management", "display-design-console.tsx");
  assert("R8 the icons are drawn ONE place (the screen's rail and the design page use the same component)", icons.includes("export function KioskTabIcon") && kd3.includes("<KioskTabIcon id=\"lists\" />") && consoleDz.includes("<KioskTabIcon"));
  const shell3 = read("components", "app-shell.tsx");
  const locale3 = read("lib", "locale-context.tsx");
  const pins3 = read("lib", "use-top-nav-pins.ts");
  const mw = read("middleware.ts");
  const queue3 = read("components", "live-queue-panel.tsx");
  assert("S9 Jingles is a tab of the top bar of its own (always on the bar, named in both languages, protected like every other page) and the lock-screen design is a manager-only tab", shell3.includes('"jingles",\n  "display-design",\n] as const;') && /NAV_ORDER = \["library", "schedules", "radio", "jingles", "display-design", "controlRoom"/.test(shell3) && locale3.includes('jingles: { en: "Jingles", he: "ג\'ינגלים" }') && locale3.includes('"display-design": { en: "Lock screen design", he: "עיצוב מסך נעילה" }') && pins3.includes('new Set<string>(["library", "radio", "jingles", "display-design"])') && mw.includes('"/jingles"') && mw.includes('"/display-design"') && shell3.includes('"owner", "display-design"]'));
  const jpage = read("app", "(app)", "(workspace)", "jingles", "page.tsx");
  assert("S10 the Jingles page shows the console that used to open from the '+' (create / library / schedule) with the player closed (management-mode mechanism: UI only, nothing re-mounts); the player's queue panel has no Jingles tab or pane any more", jpage.includes("JinglesWorkspacePanel") && shell3.includes("jingles|display-design") && !queue3.includes("QueueJinglesPane") && !queue3.includes('setQueueTab("jingles")') && !queue3.includes("setJinglesOpenTab"));
  const dpage = read("app", "(app)", "display-design", "page.tsx");
  assert("S11 the Lock screen design page is a management page (manager gate), ONE screen without scrolling: the preview with the three looks under it and 'Show on the screen' (puts the screen up through the lock) + a link to the password / permissions page, and a short list of settings — one line, one control each: how the song is shown, the icons, the clock, the notice", dpage.includes("ManagementGate") && dpage.includes("DisplayDesignConsole") && consoleDz.includes("KIOSK_PRESETS.map") && consoleDz.includes("DESIGN_ICONS.map") && consoleDz.includes("lockKiosk()") && consoleDz.includes('href="/access-control/display"') && consoleDz.includes("setKioskDesign({ clock: !design.clock })") && consoleDz.includes("setKioskDesign({ notice: !design.notice })") && consoleDz.includes("function Preview(") && consoleDz.includes("function Seg<T extends string>") && consoleDz.includes("function Row(") && (consoleDz.match(/<Row /g) ?? []).length === 4 && /\.sb-kdes-screen\s*\{[^}]*font-size:\s*1cqw/.test(css) && /\.sb-kdes-grid\s*\{[^}]*grid-template-columns/.test(css));

  // ── 2026-10-26 phase 19: making a new jingle ON the display screen ──
  const jq = await import("../lib/kiosk-jingle");
  assert("U1 the language is detected from the words (any Hebrew letter → Hebrew, otherwise English); the button name is the first three words, at most 20 characters, never empty", jq.detectJingleLanguage("מבצע על לחם") === "he" && jq.detectJingleLanguage("Fresh bread today") === "en" && jq.detectJingleLanguage("Sale על לחם") === "he" && jq.jingleButtonLabel("  Weekend sale on fresh bread  ") === "Weekend sale on" && jq.jingleButtonLabel("a".repeat(40)).length === 20 && jq.jingleButtonLabel("   ") === "Jingle");
  const padsFor = (urls: string[]) => urls.map((u, i) => ({ id: `pad-${i}`, label: `P${i}`, url: u, color: "sky" as const }));
  assert("U2 the new jingle goes to the FIRST free one of the eight buttons (none free → null, and the owner picks which to replace); lengths like 0:07 become seconds", jq.firstFreePad(padsFor(["/a", "", "/c"]))?.id === "pad-1" && jq.firstFreePad(padsFor(["/a", "/b"])) === null && jq.durationLabelToSec("0:07") === 7 && jq.durationLabelToSec("1:05") === 65 && jq.durationLabelToSec("—") === null && jq.durationLabelToSec(undefined) === null);
  const jc = read("components", "kiosk-jingle-create.tsx");
  assert("U3 the flow is four calm steps on the Jingles page: write one sentence → spoken (the console's own /api/jingles/generate) → hear it (a local preview, not on air) → 'Add as a button' on the first free pad (the console's own pads call) + the shared library; nothing else is asked (voice = first of the detected language, speed normal, bell ding)", jc.includes("generateJingle(script, language, voiceId)") && jc.includes("VOICE_PRESETS_BY_LANG[language][0]") && jc.includes("firstFreePad(current)") && jc.includes('bellStyle: "ding", preRoll: true') && jc.includes("savePadToCloud(") && jc.includes('"/api/jingles/library"') && jc.includes("new Audio(made.url)") && !jc.includes("fireJingleOnAir") && jc.includes('step === "pick"') && jc.includes("w.failed(") && read("lib", "kiosk-jingle.ts").includes('speed: "normal"'));
  assert("U4 the '+ New jingle' chip is on the display's Jingles page and only where the owner allows it (switch 'createJingles', on by default); a jingle that is already a button is not listed a second time (pad + library)", kd3.includes("canCreate ? (") && kd3.includes("canCreate={canCreateJingle}") && kd3.includes("canCreateJingle={perms.createJingles}") && kd3.includes("<JingleCreate he={he}") && kd3.includes("const onScreen = new Set(out.map((o) => o.url));") && kk.getKioskPermissions().createJingles === true && con.includes("createJingles:") && con.includes('"createJingles"'));
  assert("U5 after a jingle is added the buttons reload quietly (the old ones stay on screen meanwhile)", kd3.includes("useJingles(shown && perms.jingles, jingleVer)") && kd3.includes("onJingleAdded={() => setJingleVer((n) => n + 1)}") && /function useJingles\(active: boolean, version: number\)/.test(kd3));

  // ── 2026-10-26 phase 20: a mostly dark / grey cover = calm graphite in its own tint + only a faint touch of its accent (no more olive-green from a yellow title) ──
  const hueOf = (c: string) => Number(/hsl\((\d+)/.exec(c)?.[1]);
  const charcoal = { main: [{ hue: 53, sat: 0.73, share: 1 }], none: false, grey: false, lum: 0.05, light: false, seed: null, tint: { hue: 240, sat: 0.22 } };
  const gp = pf.paletteFor(charcoal, "dark");
  assert("V1 a charcoal cover with a yellow title: three graphite glows in the cover's own cool tint (≤ 14 % saturation, dark) and ONE faint gold touch (hue 40–55, dark, never green)", gp.slice(0, 3).every((c) => sat(c) <= 14 && lightness(c) <= 30) && hueOf(gp[0]!) === 240 && hueOf(gp[3]!) >= 40 && hueOf(gp[3]!) <= 55 && lightness(gp[3]!) <= 28 && sat(gp[3]!) >= 42, gp);
  const gl = pf.paletteFor({ ...charcoal, light: true }, "light");
  assert("V2 the same cover in the light look: soft silver glows with a gentle warm touch (still never green)", gl.slice(0, 3).every((c) => sat(c) <= 12 && lightness(c) >= 70) && hueOf(gl[3]!) >= 40 && hueOf(gl[3]!) <= 55, gl);
  const yellowOnly = pf.paletteFor({ main: [{ hue: 53, sat: 0.7, share: 1 }], none: false, grey: false, lum: 0.3, light: false, seed: null }, "dark");
  assert("V3 a one-colour YELLOW cover whose colour is a real part of the picture keeps its colours but its neighbouring hues drift toward amber, never toward lime / green (hue 61–110)", yellowOnly.every((c) => !(hueOf(c) > 60 && hueOf(c) < 110)), yellowOnly);
  const red = pf.paletteFor({ main: [{ hue: 356, sat: 0.83, share: 0.76 }, { hue: 203, sat: 0.38, share: 0.18 }], none: false, grey: false, lum: 0.06, light: false, seed: null, tint: null }, "dark");
  const redOld = pf.paletteFor({ main: [{ hue: 356, sat: 0.83, share: 0.76 }, { hue: 203, sat: 0.38, share: 0.18 }], none: false, grey: false, lum: 0.06, light: false, seed: null }, "dark");
  assert("V4 a colourful cover is NOT touched by the rule (no tint → the same strong colours as before); a perfectly neutral tint falls back to a calm blue-graphite", JSON.stringify(red) === JSON.stringify(redOld) && hueOf(red[0]!) <= 360 && sat(red[0]!) >= 60 && hueOf(pf.paletteFor({ ...charcoal, tint: { hue: 0, sat: 0.01 } }, "dark")[0]!) === 228);
  assert("V5 the rule only applies to a cover whose colourful pixels are under 12 % of the picture (measured on the library: the charcoal cover 4 %, real coloured subjects 15 % and more), with the tint taken from the average of the neutral pixels", pal.includes("const NEUTRAL_SHARE = 0.12;") && pal.includes("colourPx / n < NEUTRAL_SHARE") && pal.includes("if (info.tint) return touchy(info.tint, info.main[0], light);"));

  // ── 2026-10-26 phase 21: the small square in the corner next to the colour button, its name beside it, every page on the FULL screen ──
  assert("W1 the small square sits in the TOP CORNER next to the colour (sun / moon) button — right in Hebrew, left in English — vertically centred on it, with the song's name beside it (to the square's left in Hebrew, right in English)", /\.sb-kiosk-minibar\s*\{[^}]*top:\s*calc\(var\(--k-edge\) - 0\.8em\)/.test(css) && /\.sb-kiosk\[data-song="left"\] \.sb-kiosk-minibar\s*\{[^}]*right:\s*calc\(var\(--k-edge\) \+ 3\.4em\)[^}]*row-reverse/.test(css) && /\.sb-kiosk\[data-song="right"\] \.sb-kiosk-minibar\s*\{[^}]*left:\s*calc\(var\(--k-edge\) \+ 3\.4em\)/.test(css) && /\.sb-kiosk\[data-song="left"\] \.sb-kiosk-mini-text\s*\{\s*text-align:\s*right/.test(css) && kd3.includes('<span className="sb-kiosk-mini-text" key={view.title}>'));
  assert("W2 the small-square layout has NO player column; every page (jingles, search, playlists, up next, today) opens on the FULL screen: one big centred page, the icons stay on the edge, the glass sheet opens beside the list, the jingle buttons are bigger, there is a ✕", kd3.includes('{design.layout === "full" ? (\n          <section className="sb-kiosk-now"') && /\.sb-kiosk\[data-layout="mini"\] \.sb-kiosk-panel\s*\{[^}]*position:\s*absolute[^}]*left:\s*50%[^}]*width:\s*min\(62em/.test(css) && /\.sb-kiosk\[data-layout="mini"\]\[data-panel="1"\] \.sb-kiosk-panel\s*\{[^}]*translateX\(-50%\)/.test(css) && /\.sb-kiosk\[data-layout="mini"\] \.sb-kiosk-stage\s*\{\s*justify-content:\s*flex-end/.test(css) && /\.sb-kiosk\[data-song="left"\]\[data-layout="mini"\] \.sb-kiosk-sheet\s*\{[^}]*right:\s*calc\(50% \+ 24em\)/.test(css) && /\.sb-kiosk\[data-layout="mini"\] \.sb-kiosk-card\[data-id="jingles"\] \.sb-kiosk-chip\s*\{[^}]*height:\s*4\.4em/.test(css) && kd3.includes('className="sb-kiosk-panel-close"') && css.includes("calc(46em / 1.5)"));
  const dz2 = await import("../lib/kiosk-design");
  store.delete("syncbiz-kiosk-design");
  assert("W3 the small square: the song's name (and artist) slides out from behind it ONLY while the pointer rests on the square (a screen with no pointer shows it), hovering the empty place beside it does nothing; under the square a thin progress bar ALWAYS shows how far the song has got (same position / length as the player's own bar); there is no longer a name option in the design (the design page only hints how it works)", /\.sb-kiosk-mini-text\s*\{\s*opacity:\s*0;/.test(css) && css.includes(".sb-kiosk-mini-wrap:hover ~ .sb-kiosk-mini-text") && /@media \(hover: none\) \{ \.sb-kiosk-mini-text \{ opacity: 1/.test(css) && /\.sb-kiosk-mini-prog\s*\{[^}]*top:\s*calc\(100% \+ 0\.55em\)/.test(css) && /\.sb-kiosk-mini-prog span\s*\{[^}]*transition:\s*width 400ms linear/.test(css) && kd3.includes('<div className="sb-kiosk-mini-prog" aria-hidden>') && kd3.includes("position / duration") && !JSON.stringify(dz2.DEFAULT_KIOSK_DESIGN).includes("miniName") && !consoleDz.includes("miniName") && consoleDz.includes("t.miniH") && /\.sb-kdes-prog\s*\{/.test(css));

  // ── 2026-10-26: the dark boot cover can never trap a page (owner: "a dark blue screen that never loads") ──
  const bootMod = await import("../lib/fx-boot");
  const runBoot = (path: string, locked: boolean, displayUp: boolean) => {
    const attrs: Record<string, string> = {};
    let timer: { f: () => void; ms: number } | null = null;
    const doc = { documentElement: { setAttribute: (k: string, v: string) => void (attrs[k] = v), removeAttribute: (k: string) => void delete attrs[k] }, querySelector: () => (displayUp ? {} : null) };
    new Function("location", "localStorage", "document", "setTimeout", bootMod.KIOSK_BOOT_SCRIPT)({ pathname: path }, { getItem: (key: string) => (key === "syncbiz-kiosk-locked" && locked ? "1" : null) }, doc, (f: () => void, ms: number) => void (timer = { f, ms }));
    const start = attrs["data-sb-kiosk-boot"] ?? null;
    const t = timer as { f: () => void; ms: number } | null;
    t?.f();
    return { start, end: attrs["data-sb-kiosk-boot"] ?? null, ms: t?.ms ?? 0 };
  };
  const onLogin = runBoot("/login", true, false);
  const onApp = runBoot("/sources", true, false);
  const onAppUp = runBoot("/sources", true, true);
  assert("X1 the dark cover of a device left locked is NEVER put over the sign-in / sign-up / reset pages (a browser whose sign-in expired used to show only the cover over the login page), still comes up on the app's own pages, removes itself after 10 s if the display screen did not come up, and leaves it to the display when it did", onLogin.start === null && runBoot("/signup", true, false).start === null && runBoot("/", true, false).start === null && onApp.start === "locked" && onApp.end === null && onApp.ms === 10000 && onAppUp.start === "locked" && onAppUp.end === "locked", { onLogin, onApp, onAppUp });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main();
