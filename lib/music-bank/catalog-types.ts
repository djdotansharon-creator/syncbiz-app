/**
 * Royalty-Free Music — Catalog metadata types (POC).
 *
 * This is the CATALOG METADATA layer: what the Music Bank shows on screen. It is a source of truth
 * that is committed to the repo and is deliberately SEPARATE from:
 *   - the Preview Cache   (device-local audio bytes that let samples be heard in the POC), and
 *   - the Offline manifest (whether a FULL playlist was chosen Keep-Offline and is OFFLINE READY).
 *
 * A sample track's stable `id` matches its asset id in the preview cache manifest, so playback can
 * resolve an absolute local path via the desktop bridge without the catalog depending on the cache.
 *
 * Future commerce fields (`priceLabel`, `entitlement`) are present but null in the POC — no Billing,
 * no Payments, no real Entitlement yet. The UI renders the commercial model above this metadata.
 */

export type MusicBankSampleTrack = {
  /** Stable asset id (`a_<sha1(driveFileId)>`) — equals the preview-cache manifest key. */
  id: string;
  title: string;
  /** Seconds, or null when duration was not probed. */
  durationSeconds: number | null;
  ext: string;
};

export type MusicBankGenrePack = {
  /** Slug, e.g. "soul-rnb". Catalog id — NOT a playback playlist id. */
  id: string;
  name: string;
  /** Provenance: the Drive folder these samples came from (POC only). */
  driveFolder: string;
  /** Short, business-oriented atmosphere line. */
  description: string;
  /** Two-stop gradient [from, to] for the section artwork. */
  gradient: [string, string];
  /** Future pricing — null in the POC (no Billing). */
  priceLabel: string | null;
  /** Future entitlement — null in the POC (no real Entitlement). */
  entitlement: null;
  tracks: MusicBankSampleTrack[];
};

export type MusicBankPocCatalog = {
  /** ISO timestamp of the last generation from real Drive data, or null before first sync. */
  generatedAt: string | null;
  source: "drive-preview-samples";
  totalTracks: number;
  genres: MusicBankGenrePack[];
};
