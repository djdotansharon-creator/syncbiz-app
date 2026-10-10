/**
 * Control Room — branch address → exact map location (server only; owner-approved 2026-10-10).
 *
 * Uses OpenStreetMap Nominatim (structured search, no API key). STRICT: a location is accepted only when the result
 * matches the SAME house number (and a street) — a street-level or city-level match is NOT a guess we keep; the
 * caller shows a clear "address not found — please correct it" error instead. Latitude / longitude are internal.
 *
 * Nominatim usage policy: identifying User-Agent, ≤ 1 request per second — branch saves are rare, admin-only actions.
 */

export type BranchAddress = { country: string; city: string; street: string; houseNumber: string };
export type GeocodeResult =
  | { ok: true; latitude: number; longitude: number; displayName: string }
  | { ok: false; reason: "missing_fields" | "not_found" | "not_exact" | "unavailable" };

type NominatimItem = {
  lat?: string;
  lon?: string;
  display_name?: string;
  address?: { house_number?: string; road?: string; pedestrian?: string; footway?: string; [k: string]: string | undefined };
};

const ENDPOINT = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "VONO-ControlRoom/1.0 (branch address geocoding)";
const TIMEOUT_MS = 8000;

/** "12 א", "12-א", "12A" → "12א" / "12a" — comparison only. */
export function normalizeHouseNumber(v: string): string {
  return v.trim().toLowerCase().replace(/[\s\-–־'"״׳]/g, "");
}

/** Comparison form of a place name: lower case, no spaces / hyphens / quotes ("Tel Aviv-Yafo" → "telavivyafo"). */
export function normalizePlace(v: string): string {
  return v.trim().toLowerCase().replace(/[\s\-–־'"״׳.,()]/g, "");
}

/** The result's city must be the requested city — NOT a district / county / state that merely shares the name
 *  (e.g. "חיפה" must not accept a street in Hadera, which is in "מחוז חיפה"). */
export function cityMatches(address: NominatimItem["address"], wantedCity: string): boolean {
  const want = normalizePlace(wantedCity);
  if (want.length < 2) return false;
  const a = address ?? {};
  const places = [a.city, a.town, a.village, a.municipality, a.hamlet].filter((x): x is string => typeof x === "string" && !!x.trim());
  return places.some((p) => {
    const got = normalizePlace(p);
    return got.length >= 2 && (got === want || got.includes(want) || want.includes(got));
  });
}

/** Pure: pick the first result that matches the requested city AND house number exactly (and has a street). */
export function pickExactAddressMatch(items: NominatimItem[], input: BranchAddress): GeocodeResult {
  if (!Array.isArray(items) || items.length === 0) return { ok: false, reason: "not_found" };
  const wanted = normalizeHouseNumber(input.houseNumber);
  for (const it of items) {
    const a = it.address ?? {};
    const street = a.road || a.pedestrian || a.footway || "";
    const house = normalizeHouseNumber(a.house_number ?? "");
    const lat = Number(it.lat);
    const lon = Number(it.lon);
    if (!street || !house || house !== wanted || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (!cityMatches(it.address, input.city)) continue;
    return { ok: true, latitude: lat, longitude: lon, displayName: it.display_name ?? "" };
  }
  return { ok: false, reason: "not_exact" };
}

async function nominatim(params: URLSearchParams, lang: string): Promise<NominatimItem[] | null> {
  try {
    const res = await fetch(`${ENDPOINT}?${params.toString()}`, {
      headers: { "User-Agent": USER_AGENT, "Accept-Language": lang },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const items = (await res.json()) as unknown;
    return Array.isArray(items) ? (items as NominatimItem[]) : [];
  } catch {
    return null;
  }
}

/**
 * Geocode a branch address (server-side). Never throws. Two attempts, both under the SAME strict check (same city,
 * same house number): a structured search, then a free-text search ("<street> <number>, <city>, <country>") — the
 * structured search misses some real addresses. Never a guess: no exact match → an error for the user to fix.
 */
export async function geocodeBranchAddress(input: BranchAddress): Promise<GeocodeResult> {
  const city = input.city.trim();
  const street = input.street.trim();
  const houseNumber = input.houseNumber.trim();
  const country = input.country.trim();
  if (!city || !street || !houseNumber) return { ok: false, reason: "missing_fields" };
  // names come back in the input's language so the city check compares like with like
  const lang = /[\u0590-\u05FF]/.test(city) ? "he" : "en";
  const strict = { country, city, street, houseNumber };

  const structured = new URLSearchParams({ format: "jsonv2", addressdetails: "1", limit: "5", street: `${houseNumber} ${street}`, city });
  if (country) structured.set("country", country);
  const a = await nominatim(structured, lang);
  if (a === null) return { ok: false, reason: "unavailable" };
  const first = pickExactAddressMatch(a, strict);
  if (first.ok) return first;

  await new Promise((r) => setTimeout(r, 1100)); // Nominatim policy: at most 1 request per second
  const freeText = new URLSearchParams({ format: "jsonv2", addressdetails: "1", limit: "5", q: [`${street} ${houseNumber}`, city, country].filter(Boolean).join(", ") });
  const b = await nominatim(freeText, lang);
  if (b === null) return { ok: false, reason: "unavailable" };
  const second = pickExactAddressMatch(b, strict);
  if (second.ok) return second;
  return a.length === 0 && b.length === 0 ? { ok: false, reason: "not_found" } : { ok: false, reason: "not_exact" };
}

/** User-facing message for a failed geocode (the branch is NOT saved / its location is NOT changed). */
export function geocodeErrorMessage(reason: Exclude<GeocodeResult, { ok: true }>["reason"]): string {
  switch (reason) {
    case "missing_fields":
      return "City, street and house number are required.";
    case "not_found":
      return "This address was not found. Please check the city, street and house number.";
    case "not_exact":
      return "The exact house number was not found at this address. Please check the street and house number.";
    case "unavailable":
      return "The address service is not available right now. Please try again in a moment.";
  }
}
