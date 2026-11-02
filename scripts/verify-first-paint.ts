/**
 * Static checks for the first paint (owner 2026-11-01: "when it loads I see the old design before mine, and the song list is open and then closes").
 * Run: npx tsx scripts/verify-first-paint.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { FIRST_PAINT_BOOT_SCRIPT } from "../lib/fx-boot";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const read = (p: string) => readFileSync(path.join(__dirname, "..", p), "utf-8");

/** run the boot script against a fake page: a path, the saved storage, and a recording <html> */
function run(pathname: string, storage: Record<string, string>): Record<string, string> {
  const attrs: Record<string, string> = {};
  const ctx = {
    location: { pathname },
    document: { documentElement: { setAttribute: (k: string, v: string) => { attrs[k] = v; }, removeAttribute: (k: string) => { delete attrs[k]; } } },
    localStorage: { getItem: (k: string) => (k in storage ? storage[k] : null) },
  };
  vm.runInNewContext(FIRST_PAINT_BOOT_SCRIPT, ctx);
  return attrs;
}

const layout = read("app/layout.tsx");
const theme = read("lib/library-theme-context.tsx");
const css = read("app/globals.css");
const sm = read("components/sources-manager.tsx");
const ambient = read("components/player-surface/ambient-video-background.tsx");

assert("F1 on a player page with nothing saved: the display mode is 'song' (the app's own default) and no rail is closed",
  JSON.stringify(run("/sources", {})) === JSON.stringify({ "data-sb-display": "song" }));
assert("F2 what the browser saved is applied before the first paint: display mode black / white, and only a rail saved as CLOSED is marked (open or missing is never marked)",
  run("/sources", { "syncbiz:displayMode": "white" })["data-sb-display"] === "white"
  && run("/library", { "syncbiz:displayMode": "black", "syncbiz-rail-right": "collapsed" })["data-sb-boot-rail-right"] === "collapsed"
  && !("data-sb-boot-rail-left" in run("/library", { "syncbiz-rail-right": "collapsed" }))
  && !("data-sb-boot-rail-right" in run("/sources", { "syncbiz-rail-right": "open" }))
  && run("/sources", { "syncbiz-rail-left": "collapsed", "syncbiz-rail-right": "collapsed" })["data-sb-boot-rail-left"] === "collapsed");
assert("F3 a stored value that is not one of the three modes falls back to 'song' (never an invented value)", run("/sources", { "syncbiz:displayMode": "banana" })["data-sb-display"] === "song");
assert("F4 it does nothing on the pages that have no player: home, sign-in, sign-up, reset / forgot password, suspended, guest, admin, the API and the phone shell",
  ["/", "/login", "/signup", "/reset-password", "/forgot-password", "/suspended", "/guest", "/guest/x", "/admin", "/admin/users", "/api/health", "/mobile", "/mobile/library"].every((p) => Object.keys(run(p, { "syncbiz:displayMode": "white", "syncbiz-rail-right": "collapsed" })).length === 0)
  && Object.keys(run("/settings", {})).length === 1 && Object.keys(run("/owner/control-room", {})).length === 1);
assert("F5 a storage that throws changes nothing (private window): no attribute, no error", (() => {
  const attrs: Record<string, string> = {};
  vm.runInNewContext(FIRST_PAINT_BOOT_SCRIPT, { location: { pathname: "/sources" }, document: { documentElement: { setAttribute: (k: string, v: string) => { attrs[k] = v; } } }, localStorage: { getItem: () => { throw new Error("denied"); } } });
  return Object.keys(attrs).length === 0;
})());
assert("F6 the script is in <head> of the root layout, next to the graphics and kiosk scripts, and <html> keeps suppressHydrationWarning (React never owns the attributes it writes)", /<script dangerouslySetInnerHTML=\{\{ __html: FIRST_PAINT_BOOT_SCRIPT \}\} \/>/.test(layout) && /<html lang=\{lang\} dir=\{dir\} suppressHydrationWarning>/.test(layout));
assert("F7 the first-paint attribute is the same one the player sets later, with the same default", /setAttribute\("data-sb-display", mode\)/.test(ambient) && /DEFAULT_MODE: DisplayMode = "song"/.test(ambient));
assert("F8 the server HTML is drawn in the owner's look, not the old deep-blue one: the default theme is graphite-black everywhere (the provider, the stored-value fallback, the no-provider fallback); a theme someone chose stays honoured",
  /DEFAULT_LIBRARY_THEME: LibraryVisualTheme = "graphite-black"/.test(theme) && /useState<LibraryVisualTheme>\(DEFAULT_LIBRARY_THEME\)/.test(theme) && /return DEFAULT_LIBRARY_THEME;\n\}/.test(theme) && /libraryTheme: DEFAULT_LIBRARY_THEME,/.test(theme) && /if \(raw === "deep-blue"\) return "deep-blue";/.test(theme) && !/useState<LibraryVisualTheme>\("deep-blue"\)/.test(theme));
assert("F9 a rail saved as closed is drawn closed from the first frame: the same variables the closed state uses, more specific than the open rules (so they win at every width), the arrows turned too",
  /html\[data-sb-boot-rail-left="collapsed"\] \.workspace-rail-grid\[data-left-rail="open"\] \{ --rail-left: 40px; --rp-l: 0; \}/.test(css) && /html\[data-sb-boot-rail-right="collapsed"\] \.workspace-rail-grid\[data-right-rail="open"\] \{ --rail-right: 40px; --rp-r: 0; \}/.test(css)
  && /\.workspace-rail-grid\[data-left-rail="collapsed"\] \{ --rail-left: 40px; \}/.test(css) && /\.sb-rail-toggle--left svg \{ transform: rotate\(180deg\); \}/.test(css));
assert("F10 the hint can never fight a later toggle: the sources manager removes each one only after its own grid attribute says the same (no frame where the rail is drawn open in between)",
  /getAttribute\("data-left-rail"\) === "collapsed"\) html\.removeAttribute\("data-sb-boot-rail-left"\)/.test(sm) && /getAttribute\("data-right-rail"\) === "collapsed"\) html\.removeAttribute\("data-sb-boot-rail-right"\)/.test(sm) && /\}, \[leftRailOpen, rightRailOpen\]\);/.test(sm));
assert("F11 nothing in playback is touched: no playback / device / socket code appears in what this change added", !/usePlayback|useDevicePlayer|WebSocket|sendCommand/.test(FIRST_PAINT_BOOT_SCRIPT));
assert("F12 the box that stands where the library will be (on screen in the very first frame) is neutral grey, not the blue-tinted slate palette", /border-white\/\[0\.07\] bg-white\/\[0\.03\] p-12 text-center text-white\/40" aria-busy="true">\{t\.loadingSources\}/.test(read("components/sources-manager-client.tsx")) && !/slate-950\/60 p-12 text-center text-slate-500" aria-busy/.test(read("components/sources-manager-client.tsx")));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
