import type { CatalogSourceSnapshotDTO } from "@/lib/catalog-source-snapshot-dto";
import { bpmRangeLabelForManualEnergy } from "@/lib/catalog-manual-energy-bpm";

/** Display-only: single track vs set/mix by length (no persistence). */
const TWELVE_MIN_SEC = 12 * 60;

type UrlFormFactor = "SINGLE" | "SET_MIX" | "UNKNOWN";

function classifyUrlFormFactor(durationSec: number | null): UrlFormFactor {
  if (durationSec == null || durationSec < 0) return "UNKNOWN";
  return durationSec > TWELVE_MIN_SEC ? "SET_MIX" : "SINGLE";
}

/** URL type uses provider snapshot duration only (no catalog fallback). */
function snapshotDurationForUrlType(snapshot: CatalogSourceSnapshotDTO | null): number | null {
  const snap = snapshot?.durationSec;
  if (snap != null && snap >= 0) return snap;
  return null;
}

function UrlTypeBadge({ variant }: { variant: UrlFormFactor }) {
  if (variant === "SINGLE") {
    return (
      <span
        className="inline-flex rounded-md border border-emerald-700/60 bg-emerald-950/50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-emerald-100"
        title="Single (duration 12:00 or less)"
      >
        SINGLE
      </span>
    );
  }
  if (variant === "SET_MIX") {
    return (
      <span
        className="inline-flex rounded-md border border-fuchsia-700/55 bg-fuchsia-950/45 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-fuchsia-100"
        title="SET-MIX (duration above 12:00)"
      >
        SET-MIX
      </span>
    );
  }
  return (
    <span
      className="inline-flex rounded-md border border-neutral-600 bg-neutral-900/80 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-neutral-400"
      title="Unknown — no duration on provider snapshot"
    >
      UNKNOWN
    </span>
  );
}

function urlTypeMetricShell(variant: UrlFormFactor, snapshot: CatalogSourceSnapshotDTO | null, snapshotDurationSec: number | null) {
  const sourceLine =
    snapshotDurationSec != null
      ? "Duration · provider snapshot"
      : snapshot
        ? "No duration on provider snapshot"
        : "No provider snapshot";

  return (
    <div
      title={
        variant === "UNKNOWN"
          ? snapshot
            ? "UNKNOWN — refresh snapshot if duration should appear"
            : "UNKNOWN — refresh source metadata for snapshot duration"
          : `Rule: above 12:00 = SET-MIX, 12:00 or less = SINGLE (${sourceLine})`
      }
      className="min-w-[6.75rem] flex-1 rounded-lg border border-indigo-800/50 bg-indigo-950/45 px-3 py-2 shadow-sm shadow-black/20"
    >
      <div className="text-[11px] font-semibold uppercase tracking-wide text-indigo-200/95">URL type</div>
      <div className="mt-1.5 flex flex-col items-start gap-1">
        <UrlTypeBadge variant={variant} />
        <span className="text-[10px] leading-snug text-neutral-500">{sourceLine}</span>
        {snapshotDurationSec != null ? (
          <span className="text-[10px] tabular-nums text-neutral-600">{fmtDuration(snapshotDurationSec)}</span>
        ) : null}
      </div>
    </div>
  );
}

function fmtNum(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString();
}

function fmtDuration(sec: number | null | undefined): string {
  if (sec == null || sec < 0) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtPublished(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { dateStyle: "medium" });
}

function fmtDateTime(isoOrDate: string | Date | null | undefined): string {
  if (isoOrDate == null) return "—";
  const d = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  return Number.isNaN(d.getTime())
    ? String(isoOrDate)
    : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function metricTile(label: string, value: string, wide?: boolean, title?: string) {
  return (
    <div
      title={title ?? `${label}: ${value}`}
      className={`rounded-lg border border-indigo-800/50 bg-indigo-950/45 px-3 py-2 shadow-sm shadow-black/20 ${
        wide ? "min-w-[min(100%,14rem)] flex-1 sm:max-w-[20rem]" : "min-w-[5.5rem] flex-1"
      }`}
    >
      <div className="text-[11px] font-semibold uppercase tracking-wide text-indigo-200/95">{label}</div>
      <div className="mt-1 break-words text-base font-semibold leading-snug tracking-tight text-neutral-50">{value}</div>
    </div>
  );
}

export function CatalogWorkbenchTopDashboard({
  snapshot,
  providerSnapshotPhase,
  archivedAt,
  archiveReason,
  catalogCreatedAt,
  lastPlaylistLinkAt,
  lastAnalyticsPlayAt,
  playlistUsageCount,
  distinctPlaylistCount,
  workspaceCount,
  branchesViaSchedules,
  scheduleRefsCount,
  analyticsPlays,
  analyticsShares,
  usageTier,
  tierBadgeClass,
  curationRating,
  manualEnergyRating,
}: {
  snapshot: CatalogSourceSnapshotDTO | null;
  /** First-intake visibility — UNSUPPORTED = non-YouTube V1; PENDING = eligible, snapshot row not written yet; READY = snapshot exists. */
  providerSnapshotPhase: "UNSUPPORTED" | "PENDING" | "READY";
  archivedAt: Date | null;
  archiveReason?: string | null;
  catalogCreatedAt: Date;
  lastPlaylistLinkAt: Date | null;
  lastAnalyticsPlayAt: Date | null;
  playlistUsageCount: number;
  distinctPlaylistCount: number;
  workspaceCount: number;
  branchesViaSchedules: number;
  scheduleRefsCount: number;
  analyticsPlays: number;
  analyticsShares: number;
  usageTier: "HIGH" | "MEDIUM" | "LOW" | "NOT_USED";
  tierBadgeClass: string;
  curationRating: number;
  manualEnergyRating: number | null;
}) {
  const channelRaw = snapshot?.channelTitle?.trim()
    ? `${snapshot.channelTitle}${snapshot.channelId ? ` (${snapshot.channelId})` : ""}`
    : snapshot?.channelId ?? "—";

  const cuesPreview = snapshot
    ? [...snapshot.sourceTags.slice(0, 6), ...snapshot.hashtags.slice(0, 6)].filter(Boolean)
    : [];
  const cuesExtra =
    snapshot && snapshot.sourceTags.length + snapshot.hashtags.length > cuesPreview.length
      ? snapshot.sourceTags.length + snapshot.hashtags.length - cuesPreview.length
      : 0;

  const snapshotDurationForType = snapshotDurationForUrlType(snapshot);
  const urlFormFactor = classifyUrlFormFactor(snapshotDurationForType);

  return (
    <div className="mt-4 rounded-xl border border-sky-900/40 bg-gradient-to-br from-sky-950/35 via-neutral-950/80 to-neutral-950 px-4 py-4 ring-1 ring-sky-500/15">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-sky-300/95">Catalog overview</p>
          <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-neutral-500">
            Provider snapshot status, SyncBiz timeline, usage, and curation preview.
          </p>
          {archivedAt ? (
            <p className="mt-2 text-[11px] text-neutral-500">
              <span className="rounded border border-neutral-600 bg-neutral-900 px-2 py-0.5 font-semibold uppercase tracking-wide text-neutral-400">
                Archived
              </span>
              <span className="ml-2 tabular-nums text-neutral-600">{fmtDateTime(archivedAt)}</span>
              {archiveReason?.trim() ? (
                <span className="mt-1 block text-neutral-600">Reason · {archiveReason.trim()}</span>
              ) : null}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`shrink-0 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide ${tierBadgeClass}`}
          >
          {usageTier === "NOT_USED"
            ? "Not used"
            : usageTier === "HIGH"
              ? "High usage"
              : usageTier === "MEDIUM"
                ? "Medium usage"
                : "Low usage"}
          </span>
        </div>
      </div>

      {snapshot ? (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-semibold uppercase text-indigo-300/90">Provider snapshot</span>
            <span
              className={`rounded border px-2 py-0.5 font-mono text-[10px] uppercase ${
                snapshot.fetchStatus === "SUCCESS"
                  ? "border-emerald-800/55 bg-emerald-950/45 text-emerald-100"
                  : snapshot.fetchStatus === "PARTIAL"
                    ? "border-amber-800/50 bg-amber-950/40 text-amber-100"
                    : snapshot.fetchStatus === "FAILED"
                      ? "border-rose-800/55 bg-rose-950/40 text-rose-100"
                      : "border-neutral-700 bg-neutral-900 text-neutral-300"
              }`}
            >
              {snapshot.fetchStatus}
            </span>
            <span className="text-[11px] text-neutral-500">{snapshot.fetchMethod}</span>
            <span className="text-neutral-600">·</span>
            <UrlTypeBadge variant={urlFormFactor} />
          </div>
          <div className="mt-3 flex flex-wrap items-start gap-3">
            {snapshot.thumbnail?.trim() ? (
              <div className="shrink-0 overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 shadow-md shadow-black/30">
                {/* eslint-disable-next-line @next/next/no-img-element -- external provider URL; admin-only */}
                <img
                  src={snapshot.thumbnail.trim()}
                  alt=""
                  className="h-20 w-[120px] object-cover sm:h-[88px] sm:w-[140px]"
                  loading="lazy"
                />
              </div>
            ) : null}
            <div className="flex min-w-0 flex-1 flex-wrap gap-2">
              {metricTile("Views", fmtNum(snapshot.viewCount))}
              {metricTile("Likes", fmtNum(snapshot.likeCount))}
              {metricTile("Comments", fmtNum(snapshot.commentCount))}
              {metricTile("Duration", fmtDuration(snapshot.durationSec))}
              {urlTypeMetricShell(urlFormFactor, snapshot, snapshotDurationForType)}
              {metricTile("Published", fmtPublished(snapshot.publishedAt), false, snapshot.publishedAt ?? undefined)}
              {metricTile("Channel", channelRaw.length > 56 ? `${channelRaw.slice(0, 54)}…` : channelRaw, true, channelRaw)}
            </div>
          </div>
          {snapshot.fetchStatus === "FAILED" && snapshot.errorMessage ? (
            <p className="mt-2 rounded border border-rose-900/55 bg-rose-950/30 px-3 py-2 text-xs text-rose-100">
              {snapshot.errorMessage}
            </p>
          ) : null}
          {snapshot.title?.trim() ? (
            <p className="mt-2 text-[12px] text-neutral-300">
              <span className="text-neutral-500">Snapshot title · </span>
              {snapshot.title.trim()}
            </p>
          ) : null}
          {snapshot.description?.trim() ? (
            <p className="mt-2 line-clamp-3 text-[11px] leading-snug text-neutral-400" title={snapshot.description!.trim()}>
              <span className="font-semibold text-neutral-600">Description · </span>
              {snapshot.description!.trim()}
            </p>
          ) : null}
          {cuesPreview.length > 0 ? (
            <p className="mt-1 line-clamp-2 text-[11px] text-neutral-500" title={[...snapshot.sourceTags, ...snapshot.hashtags].join(" · ")}>
              <span className="font-semibold text-neutral-600">Metadata cues · </span>
              {cuesPreview.join(" · ")}
              {cuesExtra > 0 ? ` · +${cuesExtra} more` : ""}
            </p>
          ) : (
            <p className="mt-1 text-[11px] text-neutral-600">Metadata cues · none in snapshot</p>
          )}
        </>
      ) : providerSnapshotPhase === "PENDING" ? (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-semibold uppercase text-amber-300/90">Provider snapshot</span>
            <span className="rounded border border-amber-700/55 bg-amber-950/45 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-amber-100">
              Refreshing…
            </span>
          </div>
          <p className="mt-2 rounded-lg border border-amber-900/45 bg-amber-950/25 px-3 py-2 text-[12px] text-amber-50/95">
            Fetching YouTube metadata now (first intake). This page picks up the snapshot automatically — usually within seconds.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">{urlTypeMetricShell(urlFormFactor, null, null)}</div>
        </>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-semibold uppercase text-neutral-500">Provider snapshot</span>
            <span className="rounded border border-neutral-700 bg-neutral-900 px-2 py-0.5 font-mono text-[10px] uppercase text-neutral-400">
              Unsupported
            </span>
          </div>
          <p className="mt-2 rounded-lg border border-neutral-800 bg-neutral-950/60 px-3 py-2 text-[12px] text-neutral-400">
            Provider metadata snapshots are YouTube-only in this version. Automatic intake does not run for this URL; use Refresh source metadata only if you need an audit trail row (records FAILED with details).
          </p>
          <div className="mt-3 flex flex-wrap gap-2">{urlTypeMetricShell(urlFormFactor, null, null)}</div>
        </>
      )}

      <div className="mt-4 grid gap-3 border-t border-neutral-800/80 pt-4 sm:grid-cols-2">
        <div className="space-y-1.5 text-[12px]">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">Timeline</p>
          <p className="text-neutral-400">
            Source published · <span className="font-medium text-neutral-200">{snapshot ? fmtPublished(snapshot.publishedAt) : "—"}</span>
          </p>
          <p className="text-neutral-400">
            Catalog created (SyncBiz) · <span className="font-medium text-neutral-200">{fmtDateTime(catalogCreatedAt)}</span>
          </p>
          <p className="text-neutral-400">
            Last metadata refresh ·{" "}
            <span className="font-medium text-neutral-200">{snapshot ? fmtDateTime(snapshot.fetchedAt) : "—"}</span>
          </p>
          <p className="text-neutral-400">
            Last playlist link · <span className="font-medium text-neutral-200">{fmtDateTime(lastPlaylistLinkAt)}</span>
          </p>
          <p className="text-neutral-400">
            Last analytics play · <span className="font-medium text-neutral-200">{fmtDateTime(lastAnalyticsPlayAt)}</span>
          </p>
        </div>

        <div className="space-y-1.5 text-[12px]">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">Usage (aggregated)</p>
          <p className="text-neutral-400">
            Playlist items · <span className="font-semibold tabular-nums text-neutral-100">{playlistUsageCount}</span>
          </p>
          <p className="text-neutral-400">
            Distinct playlists · <span className="font-semibold tabular-nums text-neutral-100">{distinctPlaylistCount}</span>
          </p>
          <p className="text-neutral-400">
            Workspaces · <span className="font-semibold tabular-nums text-neutral-100">{workspaceCount}</span>
          </p>
          <p className="text-neutral-400">
            Branches (via schedules) · <span className="font-semibold tabular-nums text-neutral-100">{branchesViaSchedules}</span>
          </p>
          <p className="text-neutral-400">
            Schedules · <span className="font-semibold tabular-nums text-neutral-100">{scheduleRefsCount}</span>
          </p>
          <p className="text-neutral-400">
            Analytics plays · <span className="font-semibold tabular-nums text-neutral-100">{analyticsPlays}</span>
          </p>
          <p className="text-neutral-400">
            Share signals · <span className="font-semibold tabular-nums text-neutral-100">{analyticsShares}</span>
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:col-span-2 sm:flex-row">
          <div className="flex-1 rounded-lg border border-amber-900/40 bg-amber-950/15 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-200/90">Curation preview</p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-amber-50">
              SYNC {Math.min(5, Math.max(0, Math.round(curationRating)))}/5
            </p>
            <p className="text-[11px] text-neutral-500">Full editor below.</p>
          </div>
          <div className="flex-1 rounded-lg border border-violet-900/35 bg-violet-950/15 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-200/90">Energy rating preview</p>
            {manualEnergyRating != null &&
            manualEnergyRating >= 1 &&
            manualEnergyRating <= 10 ? (
              <>
                <p className="mt-1 text-xl font-semibold tabular-nums text-violet-50">
                  Energy {manualEnergyRating}/10
                </p>
                <p className="mt-1 text-[11px] text-neutral-400">
                  BPM hint ·{" "}
                  <span className="font-medium text-neutral-300">{bpmRangeLabelForManualEnergy(manualEnergyRating)}</span>
                </p>
              </>
            ) : (
              <p className="mt-1 text-[13px] font-semibold text-neutral-400">Unset — edit below</p>
            )}
            <p className="mt-1 text-[10px] leading-snug text-neutral-600">
              Bands are display-only (Stage 6.2A). Full taxonomy energy remains future work.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
