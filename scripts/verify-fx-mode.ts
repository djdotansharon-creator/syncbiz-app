/**
 * Graphics mode (full / lite) — the boot script's decision table and the scoping of the lite stylesheet. No browser.
 * Run: npx tsx scripts/verify-fx-mode.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { FX_BOOT_SCRIPT, FX_STORAGE_KEY, FX_MIRROR_KEY, FX_MIRROR_OWNED_KEY } from "../lib/fx-boot";

let pass = 0;
let fail = 0;
function assert(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === undefined ? "" : `   -> ${JSON.stringify(detail)}`}`);
  if (ok) pass++;
  else fail++;
}

type Env = { cores?: number; memory?: number; renderer?: string | null; ua?: string; search?: string; store?: Record<string, string> };
/** Runs the boot script in a throw-away "browser" and returns what it did. */
function boot(env: Env) {
  const store = new Map<string, string>(Object.entries(env.store ?? {}));
  const attrs = new Map<string, string>();
  const ctx = {
    document: {
      documentElement: { setAttribute: (k: string, v: string) => void attrs.set(k, v), removeAttribute: (k: string) => void attrs.delete(k) },
      createElement: () => ({
        getContext: () =>
          env.renderer === null
            ? null
            : { getExtension: () => ({ UNMASKED_RENDERER_WEBGL: 1 }), getParameter: () => env.renderer ?? "ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)" },
      }),
    },
    localStorage: { getItem: (k: string) => (store.has(k) ? store.get(k)! : null), setItem: (k: string, v: string) => void store.set(k, String(v)), removeItem: (k: string) => void store.delete(k) },
    navigator: { hardwareConcurrency: env.cores ?? 10, deviceMemory: env.memory, userAgent: env.ua ?? "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130" },
    location: { search: env.search ?? "" },
  };
  vm.runInNewContext(FX_BOOT_SCRIPT, ctx);
  return { lite: attrs.get("data-sb-fx") === "lite", store };
}
const WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130";

// ── the decision ────────────────────────────────────────────────────────────────────────────────────────────────────
assert("B1 a MacBook (many cores, Apple GPU) keeps the full look", boot({}).lite === false);
assert("B2 a normal Windows PC (8 cores, NVIDIA) keeps the full look", boot({ cores: 8, ua: WIN, renderer: "ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 Direct3D11)" }).lite === false);
assert("B3 4 CPU cores or fewer -> lite", boot({ cores: 4 }).lite === true);
assert("B4 4 GB of memory or less -> lite", boot({ memory: 4 }).lite === true);
assert("B5 software rendering (SwiftShader) -> lite", boot({ renderer: "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)" }).lite === true);
assert("B6 Windows + Intel UHD Graphics -> lite", boot({ ua: WIN, renderer: "ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)" }).lite === true);
assert("B7 Intel integrated on a Mac is NOT treated as weak (Windows rule only)", boot({ renderer: "ANGLE (Intel Inc., Intel(R) UHD Graphics 630, OpenGL 4.1)" }).lite === false);
assert("B8 no WebGL at all -> lite", boot({ renderer: null }).lite === true);

// ── an explicit choice always wins ──────────────────────────────────────────────────────────────────────────────────
assert("C1 stored 'full' beats a weak computer", boot({ cores: 2, store: { [FX_STORAGE_KEY]: "full" } }).lite === false);
assert("C2 stored 'lite' beats a strong computer", boot({ store: { [FX_STORAGE_KEY]: "lite" } }).lite === true);
const q = boot({ cores: 2, search: "?x=1&fx=full" });
assert("C3 ?fx=full in the address wins and is remembered", q.lite === false && q.store.get(FX_STORAGE_KEY) === "full");
const q2 = boot({ search: "?fx=lite" });
assert("C4 ?fx=lite in the address wins and is remembered", q2.lite === true && q2.store.get(FX_STORAGE_KEY) === "lite");

// ── the heavy second video ("mirror") is switched off by lite and given back only if lite switched it off ───────────
const l1 = boot({ cores: 2 });
assert("M1 lite turns the mirror video off (the player's own switch) and notes that it did", l1.store.get(FX_MIRROR_KEY) === "off" && l1.store.get(FX_MIRROR_OWNED_KEY) === "1");
const f1 = boot({ store: { [FX_STORAGE_KEY]: "full", [FX_MIRROR_KEY]: "off", [FX_MIRROR_OWNED_KEY]: "1" } });
assert("M2 back to full gives the mirror back (lite had switched it off)", f1.store.get(FX_MIRROR_KEY) === undefined && f1.store.get(FX_MIRROR_OWNED_KEY) === undefined);
const f2 = boot({ store: { [FX_STORAGE_KEY]: "full", [FX_MIRROR_KEY]: "off" } });
assert("M3 a mirror the OPERATOR switched off stays off in full", f2.store.get(FX_MIRROR_KEY) === "off");

const DISPLAY = "syncbiz:displayMode";
const b1 = boot({ store: { [DISPLAY]: "black" } });
assert("M4 the BLACK display switches the mirror video off even in the full look", b1.lite === false && b1.store.get(FX_MIRROR_KEY) === "off" && b1.store.get(FX_MIRROR_OWNED_KEY) === "1");
const b2 = boot({ store: { [DISPLAY]: "white" } });
assert("M5 the WHITE display switches the mirror video off too", b2.store.get(FX_MIRROR_KEY) === "off");
const b3 = boot({ store: { [DISPLAY]: "song" } });
assert("M6 the transparent display of the full look keeps the mirror video (nothing touched)", b3.store.get(FX_MIRROR_KEY) === undefined);
const b4 = boot({ store: { [DISPLAY]: "song", [FX_MIRROR_KEY]: "off", [FX_MIRROR_OWNED_KEY]: "1" } });
assert("M7 back in the transparent display (full) the mirror comes back", b4.store.get(FX_MIRROR_KEY) === undefined);
const b5 = boot({ store: { [DISPLAY]: "song", [FX_MIRROR_KEY]: "off" } });
assert("M8 a mirror the operator switched off stays off in the transparent display", b5.store.get(FX_MIRROR_KEY) === "off");

// ── the stylesheet: nothing outside the switch row may apply unless data-sb-fx="lite" is set ────────────────────────
const css = readFileSync(path.join(__dirname, "..", "app", "lite-fx.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const SCOPE = ':is(html[data-sb-fx="lite"], html[data-sb-display="white"])'; // the flat rules apply in Light graphics AND in the white display (owner 2026-11-02: the white look carries no glass)
const liteStart = css.indexOf(SCOPE);
const body = css.slice(liteStart);
const flat: string[] = [];
let depth = 0;
let cur = "";
for (const ch of body) {
  if (ch === "{") {
    if (depth === 0) flat.push(cur.trim());
    depth++;
    cur = "";
  } else if (ch === "}") {
    depth--;
    cur = "";
  } else if (depth === 0) cur += ch;
}
/** split a selector list on the commas that are NOT inside parentheses (`:is(a, b)` stays whole) */
const splitSelectors = (sel: string): string[] => {
  const out: string[] = [];
  let d = 0;
  let c = "";
  for (const ch of sel) {
    if (ch === "(") d++;
    if (ch === ")") d--;
    if (ch === "," && d === 0) {
      out.push(c.trim());
      c = "";
    } else c += ch;
  }
  out.push(c.trim());
  return out;
};
const unscoped = flat.filter((sel) => !sel.startsWith("@media") && !splitSelectors(sel).every((p) => p.startsWith(SCOPE)));
assert("S1 every rule of the lite part is scoped to Light graphics or the white display (:is(html[data-sb-fx=\"lite\"], html[data-sb-display=\"white\"])) — nothing applies in the black or transparent look with Full graphics", unscoped.length === 0, unscoped.slice(0, 3));
assert("S2 the lite part has real content (more than 10 rules)", flat.length > 10, flat.length);
const before = css.slice(0, liteStart);
const outside = [...before.matchAll(/([^{}]+)\{/g)].map((m) => m[1]!.trim()).filter((s) => s && !/^\.sb-fx-/.test(s.replace(/^html\[data-sb-display="white"\]\s*/, "")));
assert("S3 outside the lite scope only the Graphics-switch row styles exist", outside.length === 0, outside.slice(0, 3));

// ── the same rule at RUNTIME (display / graphics changed while the page is open) ─────────────────────────────────────
async function runtime() {
  const store = new Map<string, string>();
  const events: string[] = [];
  let fxAttr: string | null = null;
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = { localStorage: { getItem: (k: string) => (store.has(k) ? store.get(k)! : null), setItem: (k: string, v: string) => void store.set(k, String(v)), removeItem: (k: string) => void store.delete(k) }, dispatchEvent: (e: { type: string }) => (events.push(e.type), true), addEventListener: () => {} };
  g.document = { documentElement: { getAttribute: () => fxAttr, setAttribute: (_k: string, v: string) => (fxAttr = v), removeAttribute: () => (fxAttr = null) } };
  const { applyMirrorPolicy, writeFxMode } = await import("../lib/fx-mode");
  const mirror = () => store.get(FX_MIRROR_KEY);
  store.set(DISPLAY, "black");
  applyMirrorPolicy();
  assert("R1 switching to the BLACK display turns the mirror off and tells the player", mirror() === "off" && events.includes("syncbiz:deck-mirror-change"));
  store.set(DISPLAY, "song");
  applyMirrorPolicy();
  assert("R2 switching back to the transparent display gives it back", mirror() === undefined && store.get(FX_MIRROR_OWNED_KEY) === undefined);
  writeFxMode("lite");
  assert("R3 Light graphics turns it off in any display", mirror() === "off" && fxAttr === "lite");
  writeFxMode("full");
  assert("R4 back to Full (transparent display) gives it back", mirror() === undefined && fxAttr === null);
  store.set(FX_MIRROR_KEY, "off"); // the operator's own choice
  store.set(DISPLAY, "black");
  applyMirrorPolicy();
  store.set(DISPLAY, "song");
  applyMirrorPolicy();
  assert("R5 a mirror the operator switched off is never switched back on", mirror() === "off");
}

runtime().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
});
