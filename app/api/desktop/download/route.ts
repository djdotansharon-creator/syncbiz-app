import { existsSync, readFileSync, statSync } from "fs";
import path from "path";
import { NextResponse } from "next/server";

/**
 * Returns JSON with a direct `url` to the Windows installer (.exe) when available.
 * See `DESKTOP_INSTALLER_BUNDLE_PATH`, `DESKTOP_WIN_INSTALLER_URL`, and GitHub
 * `desktop-v*` or semver `v*` (e.g. `v0.1.0`) release assets.
 */

const DEFAULT_OWNER = "djdotansharon-creator";
const DEFAULT_REPO = "syncbiz-app";
const TAG_PREFIX = "desktop-v";
/** e.g. `v0.1.0` from electron-builder on main; matches GitHub's tag when not using `desktop-v*`. */
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
      return null;
  }
}

function desktopTagSortKey(tag: string): number {
  const semver = versionFromReleaseTag(tag);
  const m = semver.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return -1;
  return parseInt(m[1]!, 10) * 1_000_000 + parseInt(m[2]!, 10) * 1_000 + parseInt(m[3]!, 10);
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

function publicOrigin(req: Request): string {
  const u = new URL(req.url);
  const h = (n: string) => req.headers.get(n);
  const host = h("x-forwarded-host") ?? h("host") ?? u.host;
  const rawProto = h("x-forwarded-proto")?.split(",")[0]?.trim();
  const proto = rawProto && rawProto.length > 0 ? rawProto : u.protocol.replace(":", "") || "https";
  return `${proto}://${host}`;
}

/** Version from `desktop/package.json` so the default release URL matches CI artifact names. */
function getDesktopPackageVersion(): string {
  try {
    const pkgPath = path.join(process.cwd(), "desktop", "package.json");
    const j = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
    const v = (j.version ?? "0.1.0").trim();
    return v || "0.1.0";
  } catch {
    return "0.1.0";
  }
}

/**
 * When GitHub has no matching release in the list yet (or no .exe in the release) we
 * still return a direct `releases/download/v<ver>/...exe` URL so the web UI can show a
 * download link; the file appears once a release is published. Uses `v` tag to match
 * electron-builder's common semver tags (and `dist:win` in this repo).
 * Only for Windows / unknown UA.
 */
function defaultWinInstallerPart(
  owner: string,
  repo: string,
  platform: "win" | "mac-intel" | "mac-arm" | "linux" | "unknown",
):
  | {
      version: string;
      releasedAt: null;
      url: string;
      fileName: string;
      sizeBytes: null;
      downloads: Array<{ name: string; url: string; sizeBytes: number }>;
      source: "default";
    }
  | null {
  if (platform !== "win" && platform !== "unknown") return null;
  const version = getDesktopPackageVersion();
  const fileName = `SyncBiz-Player-Setup-${version}-x64.exe`;
  const url = `https://github.com/${owner}/${repo}/releases/download/v${version}/${fileName}`;
  return {
    version,
    releasedAt: null,
    url,
    fileName,
    sizeBytes: null,
    downloads: [{ name: fileName, url, sizeBytes: 0 }],
    source: "default",
  };
}

/** Same as default URL pattern but pinned to an existing `desktop-v*` or `v*` tag (e.g. .exe not uploaded yet). */
function defaultWinInstallerFromTag(
  owner: string,
  repo: string,
  platform: "win" | "mac-intel" | "mac-arm" | "linux" | "unknown",
  tagName: string,
  releasedAt: string | null,
):
  | {
      version: string;
      releasedAt: string | null;
      url: string;
      fileName: string;
      sizeBytes: null;
      downloads: Array<{ name: string; url: string; sizeBytes: number }>;
      source: "default";
    }
  | null {
  if (platform !== "win" && platform !== "unknown") return null;
  if (!isDesktopReleaseTag(tagName)) return null;
  const version = versionFromReleaseTag(tagName);
  const fileName = `SyncBiz-Player-Setup-${version}-x64.exe`;
  const url = `https://github.com/${owner}/${repo}/releases/download/${tagName}/${fileName}`;
  return {
    version,
    releasedAt,
    url,
    fileName,
    sizeBytes: null,
    downloads: [{ name: fileName, url, sizeBytes: 0 }],
    source: "default",
  };
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

function readBundlePayload(
  req: Request,
  platform: "win" | "mac-intel" | "mac-arm" | "linux" | "unknown",
): {
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
  const version = (process.env.DESKTOP_WIN_INSTALLER_VERSION ?? "").trim() || "0.1.0";
  const origin = publicOrigin(req);
  const ourl = `${origin}/api/desktop/installer`;
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
  source: "github" | "env" | "bundle" | "default";
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
    source: "github" | "env" | "bundle" | "default";
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

export async function GET(req: Request) {
  const url = new URL(req.url);
  const explicit = url.searchParams.get("platform");
  const ua = req.headers.get("user-agent") ?? "";
  const platform = parsePlatform(explicit, ua);
  const { owner, repo } = getOwnerRepo();
  const releasesUrl = releasesPageUrl(owner, repo);
  const winEnv = readWinInstallerFromEnv();

  const bundle = readBundlePayload(req, platform);
  if (bundle) {
    return successJson(platform, releasesUrl, bundle);
  }

  const fromEnvForWin = () => {
    if (platform !== "win" && platform !== "unknown") return null;
    if (!winEnv) return null;
    return {
      version: winEnv.version,
      releasedAt: null as string | null,
      url: winEnv.url,
      fileName: winEnv.fileName,
      sizeBytes: null as number | null,
      downloads: [{ name: winEnv.fileName, url: winEnv.url, sizeBytes: 0 }],
      source: "env" as const,
    };
  };

  try {
    const resp = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases?per_page=30`, {
      headers: { Accept: "application/vnd.github+json" },
      next: { revalidate: 300 },
    });

    if (!resp.ok) {
      const envPayload = fromEnvForWin();
      if (envPayload) {
        return successJson(platform, releasesUrl, envPayload);
      }
      const def = defaultWinInstallerPart(owner, repo, platform);
      if (def) {
        return successJson(platform, releasesUrl, def);
      }
      return NextResponse.json(
        { ok: false, error: `GitHub API returned ${resp.status}`, platform, releasesPageUrl: releasesUrl },
        { status: 502 },
      );
    }

    const releases = (await resp.json()) as GHRelease[];
    const published = releases
      .filter((r) => !r.draft && !r.prerelease && isDesktopReleaseTag(r.tag_name))
      .sort((a, b) => desktopTagSortKey(b.tag_name) - desktopTagSortKey(a.tag_name));

    if (published.length === 0) {
      const envPayload = fromEnvForWin();
      if (envPayload) {
        return successJson(platform, releasesUrl, envPayload);
      }
      const def = defaultWinInstallerPart(owner, repo, platform);
      if (def) {
        return successJson(platform, releasesUrl, def);
      }
      return NextResponse.json(
        { ok: false, error: "No desktop release has been published yet.", platform, releasesPageUrl: releasesUrl },
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

    if (asset?.browser_download_url) {
      return successJson(platform, releasesUrl, {
        version: versionFromReleaseTag(latest.tag_name),
        releasedAt: latest.published_at,
        url: asset.browser_download_url,
        fileName: asset.name,
        sizeBytes: asset.size,
        downloads,
        source: "github",
      });
    }

    const envPayload = fromEnvForWin();
    if (envPayload) {
      return successJson(platform, releasesUrl, {
        ...envPayload,
        releasedAt: latest.published_at,
        version: winEnv?.version && winEnv.version !== "0.0.0" ? winEnv.version : versionFromReleaseTag(latest.tag_name),
        downloads: downloads.length > 0 ? downloads : envPayload.downloads,
      });
    }

    const fromTag = defaultWinInstallerFromTag(owner, repo, platform, latest.tag_name, latest.published_at);
    if (fromTag) {
      return successJson(platform, releasesUrl, fromTag);
    }

    return NextResponse.json({
      ok: true,
      platform,
      version: versionFromReleaseTag(latest.tag_name),
      releasedAt: latest.published_at,
      url: null,
      fileName: null,
      sizeBytes: null,
      downloads,
      releasesPageUrl: releasesUrl,
    });
  } catch (err) {
    const envPayload = fromEnvForWin();
    if (envPayload) {
      return successJson(platform, releasesUrl, envPayload);
    }
    const def = defaultWinInstallerPart(owner, repo, platform);
    if (def) {
      return successJson(platform, releasesUrl, def);
    }
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "unknown", platform, releasesPageUrl: releasesUrl },
      { status: 500 },
    );
  }
}
