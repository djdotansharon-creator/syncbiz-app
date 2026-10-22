/**
 * CONTROL ROOM — map geography (display only). Branch dots are placed by the branch's CITY (English or Hebrew name)
 * from this built-in table — no coordinates are stored in the database. Unknown city → the branch is listed but has no
 * dot. The country outline is a simplified display shape (not a survey-accurate border).
 */

export type LngLat = [number, number];

/** Simplified Israel outline, [longitude, latitude], clockwise from Rosh HaNikra. Display only. */
export const ISRAEL_OUTLINE: LngLat[] = [
  [35.1, 33.09], [35.5, 33.1], [35.62, 33.25], [35.83, 33.29], [35.9, 32.95], [35.63, 32.68], [35.57, 32.4],
  [35.55, 32.0], [35.55, 31.75], [35.48, 31.5], [35.4, 31.1], [35.3, 30.8], [35.15, 30.4], [35.0, 29.9],
  [34.95, 29.55], [34.9, 29.49], [34.87, 29.55], [34.73, 30.2], [34.55, 30.55], [34.27, 31.22], [34.49, 31.59],
  [34.65, 31.8], [34.75, 32.05], [34.85, 32.33], [34.92, 32.55], [34.97, 32.82], [35.07, 32.92], [35.1, 33.09],
];

const CITIES: Array<{ names: string[]; at: LngLat }> = [
  { names: ["haifa", "חיפה"], at: [34.989, 32.794] },
  { names: ["nahariya", "נהריה"], at: [35.094, 33.006] },
  { names: ["karmiel", "כרמיאל"], at: [35.304, 32.919] },
  { names: ["tiberias", "טבריה"], at: [35.531, 32.795] },
  { names: ["afula", "עפולה"], at: [35.289, 32.607] },
  { names: ["nazareth", "נצרת"], at: [35.303, 32.699] },
  { names: ["safed", "tsfat", "zefat", "צפת"], at: [35.496, 32.966] },
  { names: ["kiryat shmona", "קרית שמונה", "קריית שמונה"], at: [35.57, 33.207] },
  { names: ["akko", "acre", "עכו"], at: [35.076, 32.927] },
  { names: ["hadera", "חדרה"], at: [34.919, 32.434] },
  { names: ["netanya", "נתניה"], at: [34.853, 32.321] },
  { names: ["herzliya", "הרצליה"], at: [34.843, 32.166] },
  { names: ["raanana", "ra'anana", "רעננה"], at: [34.871, 32.184] },
  { names: ["kfar saba", "כפר סבא"], at: [34.907, 32.178] },
  { names: ["tel aviv", "tel aviv-yafo", "tel aviv yafo", "תל אביב", "תל אביב-יפו", "תל אביב יפו"], at: [34.781, 32.085] },
  { names: ["ramat gan", "רמת גן"], at: [34.824, 32.068] },
  { names: ["petah tikva", "petah tiqva", "פתח תקווה", "פתח תקוה"], at: [34.887, 32.087] },
  { names: ["holon", "חולון"], at: [34.774, 32.011] },
  { names: ["bat yam", "בת ים"], at: [34.745, 32.017] },
  { names: ["rishon lezion", "rishon le zion", "rishon letzion", "ראשון לציון"], at: [34.804, 31.964] },
  { names: ["rehovot", "רחובות"], at: [34.811, 31.894] },
  { names: ["modiin", "modi'in", "מודיעין"], at: [35.01, 31.899] },
  { names: ["jerusalem", "ירושלים"], at: [35.214, 31.768] },
  { names: ["ashdod", "אשדוד"], at: [34.655, 31.804] },
  { names: ["ashkelon", "אשקלון"], at: [34.571, 31.668] },
  { names: ["beer sheva", "be'er sheva", "beersheba", "באר שבע"], at: [34.791, 31.252] },
  { names: ["dimona", "דימונה"], at: [35.033, 31.069] },
  { names: ["eilat", "אילת"], at: [34.952, 29.558] },
];

const norm = (s: string) => s.trim().toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, " ");
const BY_NAME = new Map<string, LngLat>();
for (const c of CITIES) for (const n of c.names) BY_NAME.set(norm(n), c.at);

/** Coordinates for a city name (English / Hebrew), or null when unknown. */
export function cityLngLat(city: string | null | undefined): LngLat | null {
  if (!city) return null;
  return BY_NAME.get(norm(city)) ?? null;
}

/** Map projection for the outline's bounding box → SVG units (equirectangular, longitude scaled by cos(latitude)). */
export function makeProjection(width: number, height: number, pad = 12) {
  const lngs = ISRAEL_OUTLINE.map((p) => p[0]);
  const lats = ISRAEL_OUTLINE.map((p) => p[1]);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs), minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const kx = Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180));
  const spanX = (maxLng - minLng) * kx;
  const spanY = maxLat - minLat;
  const scale = Math.min((width - 2 * pad) / spanX, (height - 2 * pad) / spanY);
  const offX = (width - spanX * scale) / 2;
  const offY = (height - spanY * scale) / 2;
  return ([lng, lat]: LngLat): [number, number] => [offX + (lng - minLng) * kx * scale, offY + (maxLat - lat) * scale];
}
