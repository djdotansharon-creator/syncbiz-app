/**
 * Control Room — branch location from a Google place (owner-approved 2026-10-10). Server only.
 *
 * The owner picks a place in the browser (Places Autocomplete — a mall / commercial centre without a street number is a
 * valid location). The browser sends ONLY the Place ID; the server fetches the place from Google Places API (New) with
 * the SERVER key (GOOGLE_MAPS_API_KEY — never sent to the browser, never logged) and takes the authoritative formatted
 * address, city and coordinates from Google. A Place ID Google cannot resolve is an error — never a guessed location.
 */

export type ResolvedPlace = {
  placeId: string;
  formattedAddress: string;
  city: string;
  country: string;
  street: string;
  houseNumber: string;
  latitude: number;
  longitude: number;
};
export type PlaceResult = { ok: true; place: ResolvedPlace } | { ok: false; reason: "invalid_id" | "not_found" | "unavailable" | "not_configured" };

type PlaceComponent = { longText?: string; shortText?: string; types?: string[] };
type PlaceDetails = {
  id?: string;
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  addressComponents?: PlaceComponent[];
};

export function isPlausiblePlaceId(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9_-]{10,300}$/.test(v);
}

/** Pure: Google place details → the fields we store (city falls back through the usual administrative levels). */
export function parsePlaceDetails(requestedId: string, d: PlaceDetails): PlaceResult {
  const lat = d.location?.latitude;
  const lng = d.location?.longitude;
  const formattedAddress = (d.formattedAddress ?? "").trim();
  if (!d.id || d.id !== requestedId || typeof lat !== "number" || typeof lng !== "number" || !formattedAddress) return { ok: false, reason: "not_found" };
  const comp = (...types: string[]) => {
    for (const t of types) {
      const c = (d.addressComponents ?? []).find((x) => (x.types ?? []).includes(t));
      if (c?.longText) return c.longText;
    }
    return "";
  };
  return {
    ok: true,
    place: {
      placeId: d.id,
      formattedAddress: formattedAddress.slice(0, 300),
      city: comp("locality", "postal_town", "administrative_area_level_2", "administrative_area_level_1").slice(0, 80),
      country: comp("country").slice(0, 60),
      street: comp("route").slice(0, 120),
      houseNumber: comp("street_number").slice(0, 12),
      latitude: lat,
      longitude: lng,
    },
  };
}

/** Resolve a Place ID with Google Places API (New). Never throws. */
export async function resolveGooglePlace(placeId: unknown, language: "he" | "en" = "he"): Promise<PlaceResult> {
  if (!isPlausiblePlaceId(placeId)) return { ok: false, reason: "invalid_id" };
  const key = (process.env.GOOGLE_MAPS_API_KEY ?? "").trim();
  if (!key) return { ok: false, reason: "not_configured" };
  try {
    const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=${language}`, {
      headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": "id,formattedAddress,location,addressComponents" },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 404 || res.status === 400) return { ok: false, reason: "not_found" };
    if (!res.ok) {
      console.warn("[branch-place] Google Places status", res.status); // never the key
      return { ok: false, reason: "unavailable" };
    }
    return parsePlaceDetails(placeId, (await res.json()) as PlaceDetails);
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export function placeErrorMessage(reason: Exclude<PlaceResult, { ok: true }>["reason"]): string {
  switch (reason) {
    case "invalid_id":
      return "Choose the location from the Google suggestions.";
    case "not_found":
      return "Google could not confirm this location. Please search again and choose a suggestion.";
    case "unavailable":
      return "The location service is not available right now. Please try again in a moment.";
    case "not_configured":
      return "The location service is not configured yet (Google key missing on the server).";
  }
}
