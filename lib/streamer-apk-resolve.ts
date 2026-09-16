/**
 * Resolves the customer-facing VONO Streamer Android TV APK.
 *
 * Delivery is controlled by us. In priority order:
 *   1. `STREAMER_APK_URL` env override (a public https URL — e.g. Railway/R2/CDN).
 *   2. Latest GitHub Release tagged `streamer-v*` with an `.apk` asset (produced by
 *      .github/workflows/streamer-tv.yml).
 *   3. Nothing published yet → the caller shows an honest "release build in progress"
 *      state that links to the Releases page.
 *
 * No native build happens here — this only points at an already-built, signed APK.
 */

const DEFAULT_OWNER = "djdotansharon-creator";
const DEFAULT_REPO = "syncbiz-app";
const TAG_PREFIX = "streamer-v";

type GHAsset = { name: string; browser_download_url: string; size: number };
type GHRelease = {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  assets: GHAsset[];
};

export type StreamerApk = {
  url: string; // direct https URL to the .apk
  fileName: string;
  version: string;
  sizeBytes: number | null;
  publishedAt: string | null;
  source: "env" | "github";
};

function getOwnerRepo(): { owner: string; repo: string } {
  const rawOwner = (process.env.DESKTOP_GITHUB_OWNER ?? DEFAULT_OWNER).trim() || DEFAULT_OWNER;
  const owner = rawOwner === "creator" ? DEFAULT_OWNER : rawOwner;
  const repo = (process.env.DESKTOP_GITHUB_REPO ?? DEFAULT_REPO).trim() || DEFAULT_REPO;
  return { owner, repo };
}

export function streamerReleasesPageUrl(): string {
  const { owner, repo } = getOwnerRepo();
  return `https://github.com/${owner}/${repo}/releases`;
}

function isPublicHttpsUrl(s: string): boolean {
  try {
    const u = new URL(s);
    if (u.protocol === "https:") return true;
    if (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1")) return true;
    return false;
  } catch {
    return false;
  }
}

function versionFromTag(tag: string): string {
  return tag.startsWith(TAG_PREFIX) ? tag.slice(TAG_PREFIX.length) : tag;
}

function tagSortKey(tag: string): number {
  const m = versionFromTag(tag).match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return -1;
  return parseInt(m[1]!, 10) * 1_000_000 + parseInt(m[2]!, 10) * 1_000 + parseInt(m[3]!, 10);
}

/** Prefer a non-debug .apk; fall back to any .apk in the release. */
function pickApkAsset(assets: GHAsset[]): GHAsset | null {
  const apks = assets.filter((a) => a.name.toLowerCase().endsWith(".apk"));
  if (apks.length === 0) return null;
  return apks.find((a) => !a.name.toLowerCase().includes("debug")) ?? apks[0]!;
}

function readEnvApk(): StreamerApk | null {
  const raw = process.env.STREAMER_APK_URL?.trim();
  if (!raw || !isPublicHttpsUrl(raw)) return null;
  let fileName = process.env.STREAMER_APK_FILE_NAME?.trim();
  if (!fileName) {
    try {
      const last = new URL(raw).pathname.split("/").filter(Boolean).pop();
      fileName = last && last.toLowerCase().endsWith(".apk") ? last : "VONO-Streamer.apk";
    } catch {
      fileName = "VONO-Streamer.apk";
    }
  }
  return {
    url: raw,
    fileName,
    version: (process.env.STREAMER_APK_VERSION ?? "").trim() || "latest",
    sizeBytes: null,
    publishedAt: null,
    source: "env",
  };
}

export async function resolveStreamerApk(): Promise<StreamerApk | null> {
  const envApk = readEnvApk();
  if (envApk) return envApk;

  const { owner, repo } = getOwnerRepo();
  try {
    const resp = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases?per_page=60`, {
      headers: { Accept: "application/vnd.github+json" },
      next: { revalidate: 300 },
    });
    if (!resp.ok) return null;
    const releases = (await resp.json()) as GHRelease[];
    const published = releases
      .filter((r) => !r.draft && !r.prerelease && r.tag_name.startsWith(TAG_PREFIX))
      .sort((a, b) => tagSortKey(b.tag_name) - tagSortKey(a.tag_name));
    for (const rel of published) {
      const asset = pickApkAsset(rel.assets);
      if (asset?.browser_download_url) {
        return {
          url: asset.browser_download_url,
          fileName: asset.name,
          version: versionFromTag(rel.tag_name),
          sizeBytes: asset.size,
          publishedAt: rel.published_at,
          source: "github",
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}
