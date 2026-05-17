/**
 * Embedded cover art read in the Electron main process (no network).
 */

import { parseFile } from "music-metadata";

const LOG = "[SyncBiz:desktop:local-cover]";

export async function extractEmbeddedCoverDataUrlFromAudioFile(
  absolutePath: string,
): Promise<string | null> {
  const p = (absolutePath ?? "").trim();
  if (!p) return null;
  try {
    const meta = await parseFile(p, {
      duration: false,
      skipCovers: false,
    });
    const pic = meta.common.picture?.[0];
    if (!pic?.data?.length) return null;
    const mimeRaw = pic.format ?? "image/jpeg";
    const mime = String(mimeRaw).replace(/\s+/g, "") || "image/jpeg";
    const b64 = Buffer.from(pic.data).toString("base64");
    return `data:${mime};base64,${b64}`;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(LOG, "no cover / unreadable file", { path: p.slice(0, 120), msg });
    return null;
  }
}
