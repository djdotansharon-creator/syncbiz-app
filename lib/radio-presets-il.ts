/**
 * Default Israeli radio stations offered to workspaces located in Israel (Radio screen →
 * "Israeli stations"). Stream URLs are NOT hard-coded: broadcasters move their streams, so
 * `/api/radio/presets` resolves each preset against the Radio Browser directory (Israel only)
 * and returns the current URL. A preset matches a directory entry when the entry name contains
 * at least one alternative from EVERY `match` group (case-insensitive).
 *
 * Nothing here writes to the database: a station is stored in a workspace only when a user
 * adds or plays it (same POST /api/radio path as the radio search bar).
 */
export type IsraeliRadioPreset = {
  key: string;
  /** Display name (Hebrew + Latin so it reads well in both UI languages). */
  name: string;
  genre: string;
  match: readonly (readonly string[])[];
};

export const ISRAELI_RADIO_PRESETS: readonly IsraeliRadioPreset[] = [
  { key: "kan-88", name: "כאן 88 · Kan 88", genre: "Music", match: [["kan", "כאן"], ["88"]] },
  { key: "kan-gimel", name: "כאן גימל · Kan Gimel", genre: "Israeli music", match: [["gimel", "גימל"]] },
  { key: "kan-bet", name: "כאן ב · Kan Bet", genre: "News", match: [["kan", "כאן"], ["bet", "reshet b", "רשת ב", " ב"]] },
  { key: "galgalatz", name: "גלגלצ · Galgalatz", genre: "Hits", match: [["galgalatz", "glglz", "גלגלצ"]] },
  { key: "galei-tzahal", name: 'גלי צה"ל · Galei Tzahal', genre: "Talk & Music", match: [["galei tzahal", "galatz", "glz", "גלי צה", 'גל"צ', "גלצ"]] },
  { key: "103fm", name: "103FM", genre: "Talk & Music", match: [["103"]] },
  { key: "102fm", name: "102FM רדיו תל אביב · Radio Tel Aviv", genre: "Music", match: [["102"], ["tel aviv", "תל אביב", "tlv", "fm"]] },
  { key: "eco99", name: "eco99fm", genre: "Music", match: [["eco", "אקו"]] },
  { key: "100fm", name: "100FM רדיוס · Radius", genre: "Hits", match: [["100fm", "100 fm", "radius", "רדיוס"]] },
  { key: "104-5", name: "רדיו צפון 104.5 · North", genre: "Music", match: [["104.5", "1045", "צפון", "north"]] },
  { key: "radio-darom", name: "רדיו דרום · Darom", genre: "Music", match: [["darom", "דרום"]] },
  { key: "radio-haifa", name: "רדיו חיפה 107.5 · Haifa", genre: "Music", match: [["haifa", "חיפה", "107.5"]] },
];

const ISRAEL_COUNTRY_VALUES = new Set(["IL", "ISR", "ISRAEL", "ישראל"]);

/** True when a stored country value (business profile `countryCode` or `Branch.country`) means Israel. */
export function isIsraelCountry(value: string | null | undefined): boolean {
  return ISRAEL_COUNTRY_VALUES.has((value ?? "").trim().toUpperCase());
}

type DirectoryStation = {
  name?: string;
  url?: string;
  url_resolved?: string;
  favicon?: string;
  votes?: number;
  lastcheckok?: number;
};

/** Pick the best directory entry for a preset: every match group satisfied, working, most voted, https first. */
export function matchPreset(preset: IsraeliRadioPreset, directory: readonly DirectoryStation[]): DirectoryStation | null {
  const candidates = directory.filter((s) => {
    const name = ` ${(s.name ?? "").toLowerCase()} `;
    if (!(s.url_resolved || s.url)) return false;
    if (s.lastcheckok === 0) return false;
    return preset.match.every((group) => group.some((alt) => name.includes(alt.toLowerCase())));
  });
  candidates.sort((a, b) => {
    const httpsA = (a.url_resolved || a.url || "").startsWith("https:") ? 1 : 0;
    const httpsB = (b.url_resolved || b.url || "").startsWith("https:") ? 1 : 0;
    if (httpsA !== httpsB) return httpsB - httpsA;
    return (b.votes ?? 0) - (a.votes ?? 0);
  });
  return candidates[0] ?? null;
}
