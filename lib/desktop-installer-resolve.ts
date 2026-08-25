/**
 * Shared resolution of the latest published Windows desktop installer (.exe) from GitHub releases.
 *
 * Used by both `/api/desktop/installer` (302 → the asset) and `/api/desktop/download` (metadata +
 * the SyncBiz-owned `url: "/api/desktop/installer"`). Keeping this in one place ensures the metadata
 * the button shows and the file the redirect serves are always the SAME release.
 *
 * "Latest" = the highest-versioned published (non-draft, non-prerelease) desktop release tag
 * (`desktop-v*` or `vX.Y.Z`) that actually has a `.exe` asset. This intentionally does NOT pin to
 * `desktop/package.json`'s version — pinning caused Download to dead-end on the GitHub releases page
 * whenever the package version was bumped ahead of the published release.
 */

const DEFAULT_OWNER = "djdotansharon-creator";
const DEFAULT_REPO = "syncbiz-app";
const TAG_PREFIX = "desktop-v";
const SEMVER_V_TAG = /^v(\d+)\.(\d+)\.(\d+)/i;

export function getDesktopOwnerRepo(): { owner: string; repo: string } {
  const raw = (process.env.DESKTOP_GITHUB_OWNER ?? DEFAULT_OWNER).trim() || DEFAULT_OWNER;
  // Common env-dashboard typo: "creator" instead of the full slug → all GitHub URLs 404.
  const owner = raw === "creator" ? DEFAULT_OWNER : raw;
  const repo = (process.env.DESKTOP_GITHUB_REPO ?? DEFAULT_REPO).trim() || DEFAULT_REPO;
  return { owner, repo };
}

export function desktopReleasesPageUrl(owner?: string, repo?: string): string {
  const or = owner && repo ? { owner, repo } : getDesktopOwnerRepo();
  return `https://github.com/${or.owner}/${or.repo}/releases`;
}

function isDesktopReleaseTag(tag: string): boolean {
  return tag.startsWith(TAG_PREFIX) || SEMVER_V_TAG.test(tag);
}

function versionFromReleaseTag(tag: string): string {
  if (tag.startsWith(TAG_PREFIX)) return tag.slice(TAG_PREFIX.length);
  const m = tag.match(SEMVER_V_TAG);
  return m ? [m[1], m[2], m[3]].join(".") : tag;
}

function desktopTagSortKey(tag: string): number {
  const m = versionFromReleaseTag(tag).match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return -1;
  return parseInt(m[1]!, 10) * 1_000_000 + parseInt(m[2]!, 10) * 1_000 + parseInt(m[3]!, 10);
}

type GHAsset = { name: string; browser_download_url: string; size: number };
type GHRelease = { tag_name: string; draft: boolean; prerelease: boolean; published_at: string | null; assets: GHAsset[] };

export type WindowsInstaller = {
  url: string; // GitHub asset browser_download_url (attachment); NEVER shown to the client directly
  fileName: string;
  version: string;
  sizeBytes: number;
  tag: string;
  publishedAt: string | null;
};

/** Latest published desktop release that actually has a `.exe` asset, or null. Network — server only. */
export async function resolveLatestWindowsInstaller(): Promise<WindowsInstaller | null> {
  const { owner, repo } = getDesktopOwnerRepo();
  let resp: Response;
  try {
    resp = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases?per_page=60`, {
      headers: { Accept: "application/vnd.github+json" },
      next: { revalidate: 300 },
    });
  } catch {
    return null;
  }
  if (!resp.ok) return null;
  let releases: GHRelease[];
  try {
    releases = (await resp.json()) as GHRelease[];
  } catch {
    return null;
  }
  const published = releases
    .filter((r) => !r.draft && !r.prerelease && isDesktopReleaseTag(r.tag_name))
    .sort((a, b) => desktopTagSortKey(b.tag_name) - desktopTagSortKey(a.tag_name));
  for (const r of published) {
    const asset = (r.assets || []).find((a) => a.name.toLowerCase().endsWith(".exe"));
    if (asset?.browser_download_url) {
      return {
        url: asset.browser_download_url,
        fileName: asset.name,
        version: versionFromReleaseTag(r.tag_name),
        sizeBytes: asset.size,
        tag: r.tag_name,
        publishedAt: r.published_at,
      };
    }
  }
  return null;
}
