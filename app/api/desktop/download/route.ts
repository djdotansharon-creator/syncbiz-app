import { existsSync, statSync } from "fs";
import path from "path";
import { NextResponse } from "next/server";

/**
 * Returns JSON with a direct `url` to the Windows installer (.exe) when available.
 * See `DESKTOP_INSTALLER_BUNDLE_PATH`, `DESKTOP_WIN_INSTALLER_URL`, and GitHub
 * `desktop-v*` release assets in the module comment at the top of `route.ts` (source).
 */

const DEFAULT_OWNER = "djdotansharon-creator";
const DEFAULT_REPO = "syncbiz-app";
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

function getOwnerRepo(): { owner: string; repo: string } {
  const owner = (process.env.DESKTOP_GITHUB_OWNER ?? DEFAULT_OWNER).trim() || DEFAULT_OWNER;
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
  const without = tag.startsWith(TAG_PREFIX) ? tag.slice(TAG_PREFIX.length) : tag;
  const m = without.match(/^(\d+)\.(\d+)\.(\d+)/);
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
      return NextResponse.json(
        { ok: false, error: `GitHub API returned ${resp.status}`, platform, releasesPageUrl: releasesUrl },
        { status: 502 },
      );
    }

    const releases = (await resp.json()) as GHRelease[];
    const published = releases
      .filter((r) => !r.draft && !r.prerelease && r.tag_name.startsWith(TAG_PREFIX))
      .sort((a, b) => desktopTagSortKey(b.tag_name) - desktopTagSortKey(a.tag_name));

    if (published.length === 0) {
      const envPayload = fromEnvForWin();
      if (envPayload) {
        return successJson(platform, releasesUrl, envPayload);
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
        version: latest.tag_name.replace(TAG_PREFIX, ""),
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
        version: winEnv?.version && winEnv.version !== "0.0.0" ? winEnv.version : latest.tag_name.replace(TAG_PREFIX, ""),
        downloads: downloads.length > 0 ? downloads : envPayload.downloads,
      });
    }

    return NextResponse.json({
      ok: true,
      platform,
      version: latest.tag_name.replace(TAG_PREFIX, ""),
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
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "unknown", platform, releasesPageUrl: releasesUrl },
      { status: 500 },
    );
  }
}
