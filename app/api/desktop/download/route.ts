import { existsSync, readFileSync, statSync } from "fs";
import path from "path";
import { NextResponse } from "next/server";

/**
 * Returns JSON with a direct `url` to the Windows installer (.exe) when available.
 * See `DESKTOP_INSTALLER_BUNDLE_PATH`, `DESKTOP_WIN_INSTALLER_URL`, and GitHub
 * `desktop-v*` or semver `v*` (e.g. `v0.1.2`) release assets.
 */

const DEFAULT_OWNER = "djdotansharon-creator";
const DEFAULT_REPO = "syncbiz-app";
const TAG_PREFIX = "desktop-v";
/** e.g. `v0.1.2` from electron-builder on main; matches GitHub's tag when not using `desktop-v*`. */
const SEMVER_V_TAG = /^v(\d+)\.(\d+)\.(\d+)/i;

function isDesktopReleaseTag(tag: string): boolean {
  if (tag.startsWith(TAG_PREFIX)) return true;
  return SEMVER_V_TAG.test(tag);
}

function versionFromReleaseTag(tag: string): string {
  if (tag.startsWith(TAG_PREFIX)) return tag.slice(TAG_PREFIX.length);
  const m = tag.match(SEMVER_V_TAG);
  if (m) return [m[1], m[2], m[3]].join(".");
  return tag;
}

type GHAsset = { name: string; browser_download_url: string; size: number };
type GHRelease = {
  tag_name: string;
  name: string;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  assets: GHAsset[];
};

function getOwnerRepo(): { owner: string; repo: string } {
  const raw = (process.env.DESKTOP_GITHUB_OWNER ?? DEFAULT_OWNER).trim() || DEFAULT_OWNER;
  /**
   * Common misconfig in env dashboards: "creator" (short) instead of
   * `djdotansharon-creator` → all GitHub URLs 404. Map only this mistaken slug
   * back to the repo’s default; override with full slug if you use another org.
   */
  const owner = raw === "creator" ? DEFAULT_OWNER : raw;
  const repo = (process.env.DESKTOP_GITHUB_REPO ?? DEFAULT_REPO).trim() || DEFAULT_REPO;
  return { owner, repo };
}

function releasesPageUrl(owner: string, repo: string): string {
  return `https://github.com/${owner}/${repo}/releases`;
}

function guessPlatformFromUA(ua: string): "win" | "mac-intel" | "mac-arm" | "linux" | "unknown" {
  const s = ua.toLowerCase();
  if (s.includes("windows")) return "win";
  if (s.includes("mac os") || s.includes("macintosh")) {
    return "mac-arm";
  }
  if (s.includes("linux") || s.includes("x11")) return "linux";
  return "unknown";
}

const ALLOWED_PLATFORMS = new Set<string>(["win", "linux", "mac-intel", "mac-arm", "unknown"]);

function parsePlatform(explicit: string | null, ua: string): "win" | "mac-intel" | "mac-arm" | "linux" | "unknown" {
  const raw = explicit?.trim().toLowerCase();
  if (raw && ALLOWED_PLATFORMS.has(raw)) {
    return raw as "win" | "mac-intel" | "mac-arm" | "linux" | "unknown";
  }
  return guessPlatformFromUA(ua);
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
      /** `unknown` UA: prefer Windows .exe download (covers dev tools / generic curl). */
      return byExt(".exe") ?? null;
  }
}

function desktopTagSortKey(tag: string): number {
  const semver = versionFromReleaseTag(tag);
  const m = semver.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return -1;
  return parseInt(m[1]!, 10) * 1_000_000 + parseInt(m[2]!, 10) * 1_000 + parseInt(m[3]!, 10);
}

let cachedOfferedDesktopVersion: string | null = null;

/**
 * Canonical desktop app SemVer advertised by the repo (`desktop/package.json`).
 * installers should match this before we point users at GitHub/GitHub Releases.
 */
function getOfferedDesktopPackageVersion(): string {
  if (cachedOfferedDesktopVersion) return cachedOfferedDesktopVersion;
  try {
    const p = path.join(process.cwd(), "desktop", "package.json");
    const raw = readFileSync(p, "utf8");
    const j = JSON.parse(raw) as { version?: unknown };
    const v = typeof j.version === "string" ? j.version.trim() : "";
    cachedOfferedDesktopVersion = /^(\d+)\.(\d+)\.(\d+)/.test(v) ? v : "0.0.0";
  } catch {
    cachedOfferedDesktopVersion = "0.0.0";
  }
  return cachedOfferedDesktopVersion!;
}

function isAllowedPublicInstallerUrl(s: string): boolean {
  try {
    const u = new URL(s);
    if (u.protocol === "https:") return true;
    if (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1")) return true;
    return false;
  } catch {
    return false;
  }
}

/** `DESKTOP_WIN_INSTALLER_URL` — public URL to the .exe (or localhost http in dev). */
function readWinInstallerFromEnv(): { url: string; fileName: string; version: string } | null {
  const raw = process.env.DESKTOP_WIN_INSTALLER_URL?.trim();
  if (!raw || !isAllowedPublicInstallerUrl(raw)) return null;
  let fileName = process.env.DESKTOP_WIN_INSTALLER_FILE_NAME?.trim();
  if (!fileName) {
    try {
      const uu = new URL(raw);
      const last = uu.pathname.split("/").filter(Boolean).pop();
      fileName = last && /\.(exe|msi)$/i.test(last) ? last : "SyncBiz-Player-Setup-x64.exe";
    } catch {
      fileName = "SyncBiz-Player-Setup-x64.exe";
    }
  }
  const version = (process.env.DESKTOP_WIN_INSTALLER_VERSION ?? "").trim() || "0.0.0";
  return { url: raw, fileName, version };
}

function readBundlePayload(platform: "win" | "mac-intel" | "mac-arm" | "linux" | "unknown"): {
  version: string;
  releasedAt: null;
  url: string;
  fileName: string;
  sizeBytes: number;
  downloads: Array<{ name: string; url: string; sizeBytes: number }>;
  source: "bundle";
} | null {
  if (platform !== "win" && platform !== "unknown") return null;
  const raw = process.env.DESKTOP_INSTALLER_BUNDLE_PATH?.trim();
  if (!raw) return null;
  const abs = path.resolve(raw);
  if (!abs.toLowerCase().endsWith(".exe")) return null;
  if (!existsSync(abs)) return null;
  const st = statSync(abs);
  const fileName = process.env.DESKTOP_WIN_INSTALLER_FILE_NAME?.trim() || path.basename(abs);
  const pkgV = getOfferedDesktopPackageVersion();
  const version = (process.env.DESKTOP_WIN_INSTALLER_VERSION ?? "").trim() || pkgV || "0.1.2";
  /** Relative path avoids cross-origin quirks with `<a download>` in the browser. */
  const ourl = "/api/desktop/installer";
  return {
    version,
    releasedAt: null,
    url: ourl,
    fileName,
    sizeBytes: st.size,
    downloads: [{ name: fileName, url: ourl, sizeBytes: st.size }],
    source: "bundle",
  };
}

type SuccessBody = {
  ok: true;
  platform: string;
  version: string;
  releasedAt: string | null;
  url: string;
  fileName: string;
  sizeBytes: number | null;
  downloads: Array<{ name: string; url: string; sizeBytes: number }>;
  releasesPageUrl: string;
  source: "github" | "env" | "bundle";
};

function successJson(
  platform: string,
  releasesUrl: string,
  part: {
    version: string;
    releasedAt: string | null;
    url: string;
    fileName: string;
    sizeBytes: number | null;
    downloads: Array<{ name: string; url: string; sizeBytes: number }>;
    source: "github" | "env" | "bundle";
  },
) {
  const body: SuccessBody = {
    ok: true,
    platform,
    version: part.version,
    releasedAt: part.releasedAt,
    url: part.url,
    fileName: part.fileName,
    sizeBytes: part.sizeBytes,
    downloads: part.downloads,
    releasesPageUrl: releasesUrl,
    source: part.source,
  };
  return NextResponse.json(body);
}

type MissingInstallerSource =
  | "railway_bundle"
  | "github_release"
  | "github_platform_asset"
  /** Upstream GitHub API failure (no env/bundle override). */
  | "github_api";

function missingInstallerJson(
  platform: string,
  releasesUrl: string,
  part: {
    expectedVersion: string;
    missingSource: MissingInstallerSource;
    latestPublishedVersion: string | null;
    githubTag?: string;
    error?: string;
  },
) {
  return NextResponse.json({
    ok: false,
    platform,
    url: null,
    releasesPageUrl: releasesUrl,
    expectedVersion: part.expectedVersion,
    latestPublishedVersion: part.latestPublishedVersion,
    missingSource: part.missingSource,
    githubTag: part.githubTag,
    downloads: [],
    error: part.error ?? "DESKTOP_INSTALLER_NOT_AVAILABLE",
  });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const explicit = url.searchParams.get("platform");
  const ua = req.headers.get("user-agent") ?? "";
  const platform = parsePlatform(explicit, ua);
  const { owner, repo } = getOwnerRepo();
  const releasesUrl = releasesPageUrl(owner, repo);
  const offered = getOfferedDesktopPackageVersion();
  const winEnv = readWinInstallerFromEnv();

  const bundle = readBundlePayload(platform);
  if (bundle) {
    return successJson(platform, releasesUrl, bundle);
  }

  const bundlePathRaw = process.env.DESKTOP_INSTALLER_BUNDLE_PATH?.trim();
  if (bundlePathRaw && (platform === "win" || platform === "unknown")) {
    const abs = path.resolve(bundlePathRaw);
    const invalidBundle =
      !abs.toLowerCase().endsWith(".exe") || !existsSync(abs);
    if (invalidBundle) {
      return missingInstallerJson(platform, releasesUrl, {
        expectedVersion: offered,
        missingSource: "railway_bundle",
        latestPublishedVersion: null,
        error: "DESKTOP_INSTALLER_BUNDLE_PATH is set but does not point at a readable .exe.",
      });
    }
  }

  const fromEnvForWin = () => {
    if (platform !== "win" && platform !== "unknown") return null;
    if (!winEnv) return null;
    const v = (process.env.DESKTOP_WIN_INSTALLER_VERSION ?? "").trim() || offered;
    return {
      version: v,
      releasedAt: null as string | null,
      url: winEnv.url,
      fileName: winEnv.fileName,
      sizeBytes: null as number | null,
      downloads: [{ name: winEnv.fileName, url: winEnv.url, sizeBytes: 0 }],
      source: "env" as const,
    };
  };

  const envPayload = fromEnvForWin();
  if (envPayload) {
    return successJson(platform, releasesUrl, envPayload);
  }

  try {
    const resp = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases?per_page=60`, {
      headers: { Accept: "application/vnd.github+json" },
      next: { revalidate: 300 },
    });

    if (!resp.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: `GitHub API returned ${resp.status}`,
          platform,
          releasesPageUrl: releasesUrl,
          expectedVersion: offered,
          missingSource: "github_api" satisfies MissingInstallerSource,
          latestPublishedVersion: null,
          url: null,
          downloads: [],
        },
        { status: 502 },
      );
    }

    const releases = (await resp.json()) as GHRelease[];
    const published = releases
      .filter((r) => !r.draft && !r.prerelease && isDesktopReleaseTag(r.tag_name))
      .sort((a, b) => desktopTagSortKey(b.tag_name) - desktopTagSortKey(a.tag_name));

    if (published.length === 0) {
      return missingInstallerJson(platform, releasesUrl, {
        expectedVersion: offered,
        missingSource: "github_release",
        latestPublishedVersion: null,
        githubTag: undefined,
        error: "No desktop release tags (desktop-v* or vX.Y.Z) published on GitHub yet.",
      });
    }

    const latestPublishedVersion = versionFromReleaseTag(published[0]!.tag_name);

    const pinned = published.find((r) => versionFromReleaseTag(r.tag_name) === offered);
    if (!pinned) {
      return missingInstallerJson(platform, releasesUrl, {
        expectedVersion: offered,
        missingSource: "github_release",
        latestPublishedVersion,
      });
    }

    const asset = matchAssetForPlatform(pinned.assets, platform);
    const downloads = pinned.assets.map((a) => ({
      name: a.name,
      url: a.browser_download_url,
      sizeBytes: a.size,
    }));

    if (asset?.browser_download_url) {
      return successJson(platform, releasesUrl, {
        version: versionFromReleaseTag(pinned.tag_name),
        releasedAt: pinned.published_at,
        url: asset.browser_download_url,
        fileName: asset.name,
        sizeBytes: asset.size,
        downloads,
        source: "github",
      });
    }

    return missingInstallerJson(platform, releasesUrl, {
      expectedVersion: offered,
      missingSource: "github_platform_asset",
      latestPublishedVersion,
      githubTag: pinned.tag_name,
      error: `Release ${pinned.tag_name} has no installer for this platform (${platform}).`,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "unknown",
        platform,
        releasesPageUrl: releasesUrl,
        expectedVersion: offered,
        missingSource: "github_api" satisfies MissingInstallerSource,
        latestPublishedVersion: null,
        url: null,
        downloads: [],
      },
      { status: 500 },
    );
  }
}
