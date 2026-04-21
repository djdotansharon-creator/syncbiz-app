/**
 * Shared types for the runtime-binaries module.
 *
 * Keeping types in one place (instead of inline inside `sources.ts`) lets us
 * swap the source config layer without touching resolver/downloader logic.
 */

export type BinaryName = "mpv" | "yt-dlp";

export type PlatformKey = "win32-x64" | "darwin-x64" | "darwin-arm64" | "linux-x64";

/**
 * `github-release` — fetch the latest release JSON from GitHub and pick an
 *                    asset by regex; optionally verify via a sha256 sidecar
 *                    asset. This is the upstream-GitHub strategy used today.
 *
 * `system` — the binary is expected to live on the user's PATH (mpv on
 *            Mac/Linux is typically installed via Homebrew / apt). If it's
 *            missing, we open `helpUrl` and the app explains how to install.
 *
 * Adding a new strategy later (e.g. `"syncbiz-cdn"`) is a matter of adding
 * a case here + a handler in `resolver.ts`. No consumer (mpv-manager.ts,
 * index.ts) has to change.
 */
export type BinarySource = GithubReleaseSource | SystemSource;

export type GithubReleaseSource = {
  kind: "github-release";
  /** `owner/repo`, e.g. `yt-dlp/yt-dlp`. */
  owner: string;
  repo: string;
  /** Regex matched against `release.assets[].name`; first hit wins. */
  assetPattern: string;
  /**
   * Optional sha256 sidecar. `assetPattern` points at the SUMS file inside the
   * same release; `pickPattern` is a regex (one capture group) that extracts
   * our file's hex digest out of that file's plain-text body.
   */
  integritySidecar?: {
    assetPattern: string;
    pickPattern: string;
  };
  /**
   * Post-download action. `raw` is the default — the downloaded file IS the
   * binary. `7z`/`zip`/`tar.gz` extract a single entry out of an archive.
   */
  archive?: ArchiveSpec;
  /** Final filename to write under `userData/bin/`. */
  outputFileName: string;
};

export type SystemSource = {
  kind: "system";
  /** Executable basename to look up on PATH (`mpv`, `mpv.exe` added automatically on Win). */
  command: string;
  /** Help link to surface in the first-run window if the command isn't found. */
  helpUrl: string;
  /** Short human install hint (e.g. `brew install mpv`). */
  installHint: string;
};

export type ArchiveSpec =
  | { kind: "raw" }
  | { kind: "7z"; pickFile: string }
  | { kind: "zip"; pickFile: string }
  | { kind: "tar.gz"; pickFile: string };

/**
 * What's persisted in `userData/bin/manifest.json`. Stored per-binary so we
 * can upgrade them independently (yt-dlp updates weekly, mpv quarterly).
 */
export type ManifestEntry = {
  name: BinaryName;
  /** Absolute filesystem path to the executable. */
  path: string;
  /** Upstream tag or version string (e.g. `2025.01.26` for yt-dlp). */
  version: string;
  /** SHA256 hex digest of the final binary (or "tls-only" if we skipped hashing). */
  sha256: string;
  /** ISO timestamp when we last downloaded this binary. */
  installedAt: string;
  /** ISO timestamp when we last hit GitHub to check for a newer version. */
  lastCheckedAt: string;
  /** Source descriptor key ("github-release" / "system") recorded for debug. */
  sourceKind: BinarySource["kind"];
};

export type Manifest = {
  version: 1;
  entries: Partial<Record<BinaryName, ManifestEntry>>;
};

export type ResolveProgress = {
  /** Currently-processed binary (`null` between binaries). */
  binary: BinaryName | null;
  /** Short human phase label, e.g. "Downloading yt-dlp". */
  phase: string;
  /** 0..100 for the current phase. -1 means indeterminate. */
  percent: number;
  /** If set, an error that halted the flow. */
  error?: string;
};

export type ResolveProgressHandler = (p: ResolveProgress) => void;

export type ResolvedBinary = {
  name: BinaryName;
  path: string;
  version: string;
  /** True when we served the binary from an existing cache entry (no download). */
  fromCache: boolean;
  /** True when we resolved via PATH (SystemSource). */
  fromSystemPath: boolean;
  /** True when we served from `desktop/resources/*` in dev (not a production code path). */
  fromDevFallback: boolean;
};
