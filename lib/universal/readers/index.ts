/**
 * Phase A2 — reader registry wiring.
 *
 * Importing this module registers every real reader into PLATFORM_READERS. Only the
 * genuinely-backed readers are listed. Apple Music / Deezer / TIDAL / Amazon are
 * intentionally ABSENT: they have no real reader, so readerForUrl() returns null and
 * the UI can honestly show "recognized, not supported yet" instead of a facade.
 */

import { registerPlatformReader } from "@/lib/universal/platform-reader";
import { youtubeReader } from "@/lib/universal/readers/youtube-reader";
import { spotifyReader } from "@/lib/universal/readers/spotify-reader";
import { soundcloudReader } from "@/lib/universal/readers/soundcloud-reader";
import { m3uLocalReader } from "@/lib/universal/readers/m3u-local-reader";

registerPlatformReader(youtubeReader);
registerPlatformReader(spotifyReader);
registerPlatformReader(soundcloudReader);
registerPlatformReader(m3uLocalReader);

export { youtubeReader, spotifyReader, soundcloudReader, m3uLocalReader };
