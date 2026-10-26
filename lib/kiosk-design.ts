/**
 * Lock-screen design (owner 2026-10-26; small-square layout reshaped the same day: the square sits in the top corner next to the colour (sun / moon) button with the song's name beside it,
 * and every page — jingles, search, playlists, up next, today — opens on the FULL screen): what the business's display screen SHOWS — the owner arranges it at "Lock screen design" (a tab of the top bar), separately from
 * what staff may DO on it (lib/kiosk.ts: password + permissions). A supermarket that only wants a small square of what is playing and a Jingles icon picks the "Supermarket"
 * look; a café that wants the full player picks "Café". The screen shows an icon only when the design includes it AND staff are allowed to use it.
 *
 * Saved on this device for now (localStorage, like the password and permissions); the whole design is ONE small JSON value (`KioskDesign`) so moving it to the server
 * later (per branch / zone, edited from the owner's own computer) is a single column — see docs/CLOUD_ROLLOUT_PLAN.md.
 */
import { useSyncExternalStore } from "react";

const DESIGN_KEY = "syncbiz-kiosk-design";
const CHANGE_EVENT = "syncbiz-kiosk-design-changed";

/** the pages the display's side icons open (same ids as the display's side panel) */
export type DesignIcon = "next" | "search" | "lists" | "jingles" | "day";
export const DESIGN_ICONS: readonly DesignIcon[] = ["next", "search", "lists", "jingles", "day"];

export type KioskDesign = {
  /** "full": the song with its controls and the side panel; "mini": only a small square of what is playing — hover shows the name, a press pauses / resumes */
  layout: "full" | "mini";
  /** the icons on the edge of the screen, each opening its page (empty = no icons at all) */
  icons: DesignIcon[];
  /** the clock and the date at the top */
  clock: boolean;
  /** the next song as a small notice in the corner */
  notice: boolean;
};

/** what a display screen looks like until the owner designs it: exactly the screen the pilot has had so far */
export const DEFAULT_KIOSK_DESIGN: KioskDesign = { layout: "full", icons: [...DESIGN_ICONS], clock: true, notice: true };

/** ready-made starting points on the design page — one press, then the owner can still change anything */
export const KIOSK_PRESETS: ReadonlyArray<{ id: "cafe" | "supermarket" | "song"; design: KioskDesign }> = [
  { id: "cafe", design: { layout: "full", icons: [...DESIGN_ICONS], clock: true, notice: true } },
  { id: "supermarket", design: { layout: "mini", icons: ["jingles"], clock: true, notice: false } },
  { id: "song", design: { layout: "mini", icons: [], clock: true, notice: false } },
];

/** Reads whatever is stored and returns a complete, valid design (anything missing or wrong falls back to the default for that part). */
export function parseKioskDesign(raw: string | null | undefined): KioskDesign {
  if (!raw) return DEFAULT_KIOSK_DESIGN;
  try {
    const v = JSON.parse(raw) as Partial<KioskDesign> | null;
    if (!v || typeof v !== "object") return DEFAULT_KIOSK_DESIGN;
    return {
      layout: v.layout === "mini" ? "mini" : "full",
      icons: Array.isArray(v.icons) ? DESIGN_ICONS.filter((id) => (v.icons as unknown[]).includes(id)) : DEFAULT_KIOSK_DESIGN.icons,
      clock: typeof v.clock === "boolean" ? v.clock : DEFAULT_KIOSK_DESIGN.clock,
      notice: typeof v.notice === "boolean" ? v.notice : DEFAULT_KIOSK_DESIGN.notice,
    };
  } catch {
    return DEFAULT_KIOSK_DESIGN;
  }
}

function readRaw(): string {
  try {
    return window.localStorage.getItem(DESIGN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function getKioskDesign(): KioskDesign {
  if (typeof window === "undefined") return DEFAULT_KIOSK_DESIGN;
  return parseKioskDesign(readRaw());
}

/** Saves the design at once (the display screen follows immediately — there is no "save" button). Icons are kept in their fixed order. */
export function setKioskDesign(patch: Partial<KioskDesign>): void {
  const next = parseKioskDesign(JSON.stringify({ ...getKioskDesign(), ...patch }));
  try {
    window.localStorage.setItem(DESIGN_KEY, JSON.stringify(next));
  } catch {
    /* private mode — still works for this session */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** a whole look at once (one of the presets) */
export function applyKioskPreset(id: (typeof KIOSK_PRESETS)[number]["id"]): void {
  const p = KIOSK_PRESETS.find((x) => x.id === id);
  if (p) setKioskDesign({ ...p.design, icons: [...p.design.icons] });
}

/** which preset the current design equals (null = the owner changed something, i.e. "custom") */
export function matchingPreset(d: KioskDesign): (typeof KIOSK_PRESETS)[number]["id"] | null {
  const same = (a: KioskDesign, b: KioskDesign) => a.layout === b.layout && a.clock === b.clock && a.notice === b.notice && a.icons.join() === b.icons.join();
  return KIOSK_PRESETS.find((p) => same(p.design, d))?.id ?? null;
}

function subscribe(cb: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(CHANGE_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

let designRaw = "\u0000";
let designCache: KioskDesign = DEFAULT_KIOSK_DESIGN;
function designSnapshot(): KioskDesign {
  const raw = readRaw();
  if (raw !== designRaw) {
    designRaw = raw;
    designCache = parseKioskDesign(raw);
  }
  return designCache;
}

export function useKioskDesign(): KioskDesign {
  return useSyncExternalStore(subscribe, designSnapshot, () => DEFAULT_KIOSK_DESIGN);
}
