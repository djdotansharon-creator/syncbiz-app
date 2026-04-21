import { NextResponse } from "next/server";

/**
 * Returns the download URL for the SyncBiz desktop installer that matches the
 * caller's platform (Windows / macOS / Linux), based on the latest GitHub
 * Release tagged `desktop-v*`.
 *
 * Contract:
 *   GET /api/desktop/download
 *     → { ok: true, platform, url, version, releasedAt, downloads: [...] }
 *     → 404 if no matching release has been published yet.
 *
 * This route is deliberately thin so the browser doesn't have to know about
 * GitHub's API auth / rate-limit rules, and so the asset names live in one
 * place (the electron-builder artifactName pattern).
 */

const GITHUB_OWNER = "djdotansharon-creator";
const GITHUB_REPO = "syncbiz-app";
/** Releases for the desktop app are tagged `desktop-vX.Y.Z`; plain repo tags (e.g. app migrations) are ignored. */
const TAG_PREFIX = "desktop-v";

type GHAsset = { name: string; browser_download_url: string; size: number };
type GHRelease = {
  tag_name: string;
  name: string;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  assets: GHAsset[];
};

/**
 * Map a User-Agent string to an installer suffix. electron-builder artifact
 * names follow these patterns (see desktop/package.json `build.artifactName`):
 *   win   → SyncBiz-Player-Setup-<ver>-x64.exe
 *   mac   → SyncBiz-Player-<ver>-<arch>.dmg   (arch = x64 | arm64)
 *   linux → SyncBiz-Player-<ver>-x64.AppImage
 */
function guessPlatformFromUA(ua: string): "win" | "mac-intel" | "mac-arm" | "linux" | "unknown" {
  const s = ua.toLowerCase();
  if (s.includes("windows")) return "win";
  if (s.includes("mac os") || s.includes("macintosh")) {
    // Apple Silicon UA strings still say "Intel Mac OS X" so we can't tell
    // from UA alone. Default to arm64 (current Apple hardware) and let the
    // caller override with ?platform=mac-intel if needed.
    return "mac-arm";
  }
  if (s.includes("linux") || s.includes("x11")) return "linux";
  return "unknown";
}

function matchAssetForPlatform(
  assets: GHAsset[],
  platform: "win" | "mac-intel" | "mac-arm" | "linux" | "unknown",
): GHAsset | null {
  const byExt = (ext: string) => assets.find((a) => a.name.toLowerCase().endsWith(ext));
  const bySubstr = (s: string) => assets.find((a) => a.name.toLowerCase().includes(s));
  switch (platform) {
    case "win":
      return byExt(".exe") ?? null;
    case "mac-arm":
      return bySubstr("arm64.dmg") ?? bySubstr(".dmg") ?? null;
    case "mac-intel":
      return bySubstr("x64.dmg") ?? bySubstr(".dmg") ?? null;
    case "linux":
      return byExt(".appimage") ?? null;
    default:
      return null;
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const explicit = url.searchParams.get("platform");
  const ua = req.headers.get("user-agent") ?? "";
  const platform = (explicit as ReturnType<typeof guessPlatformFromUA>) ?? guessPlatformFromUA(ua);

  try {
    // No auth token required for public repo releases list. GitHub rate-limits
    // unauthenticated requests to ~60/hour per IP, which is plenty for a
    // download button.
    const resp = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases?per_page=30`,
      {
        headers: { Accept: "application/vnd.github+json" },
        // Revalidate every 5 minutes so a fresh release shows up quickly
        // without hammering GitHub on every page view.
        next: { revalidate: 300 },
      },
    );
    if (!resp.ok) {
      return NextResponse.json(
        { ok: false, error: `GitHub API returned ${resp.status}` },
        { status: 502 },
      );
    }
    const releases = (await resp.json()) as GHRelease[];
    const published = releases.filter(
      (r) => !r.draft && !r.prerelease && r.tag_name.startsWith(TAG_PREFIX),
    );
    if (published.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No desktop release has been published yet.", platform },
        { status: 404 },
      );
    }
    const latest = published[0]!;
    const asset = matchAssetForPlatform(latest.assets, platform);
    const downloads = latest.assets.map((a) => ({
      name: a.name,
      url: a.browser_download_url,
      sizeBytes: a.size,
    }));

    return NextResponse.json({
      ok: true,
      platform,
      version: latest.tag_name.replace(TAG_PREFIX, ""),
      releasedAt: latest.published_at,
      url: asset?.browser_download_url ?? null,
      fileName: asset?.name ?? null,
      sizeBytes: asset?.size ?? null,
      downloads,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }
}
