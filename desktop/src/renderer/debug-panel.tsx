import type { MvpStatusSnapshot } from "../shared/mvp-types";

function truncateUrl(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

type Props = {
  snapshot: MvpStatusSnapshot;
  /** Renderer document URL (`file://…/index.html`) — not from IPC; for load-context only. */
  pageHref: string;
};

/**
 * Read-only dev observability: mirrors `MvpStatusSnapshot` + `location.href`.
 * Gated at compile time via `__DESKTOP_DEV_DEBUG_PANEL__`.
 */
export function DesktopDebugPanel({ snapshot: s, pageHref }: Props) {
  const total = s.branchCatalogCount ?? 0;
  const idx = s.branchCatalogIndex;
  const catalogPosition =
    total === 0 ? "— / 0" : idx !== null && idx >= 0 ? `${idx + 1} / ${total}` : `— / ${total}`;

  return (
    <aside className="sb-desktop-debug" aria-label="Developer debug (read-only)">
      <div className="sb-desktop-debug-title">Dev · IPC snapshot</div>
      <dl className="sb-desktop-debug-dl">
        <dt>currentUrl</dt>
        <dd title={pageHref}>{truncateUrl(pageHref, 72)}</dd>
        <dt>providerType</dt>
        <dd>{s.mockSelectedSourceType ?? "—"}</dd>
        <dt>playbackState</dt>
        <dd>{s.mockPlaybackStatus}</dd>
        <dt>lastIpcCommand</dt>
        <dd>{s.lastCommandSummary ?? "—"}</dd>
        <dt>catalogPosition</dt>
        <dd>{catalogPosition}</dd>
        <dt>lastError</dt>
        <dd className="sb-desktop-debug-err">{s.lastError ?? "—"}</dd>
        <dt>volume</dt>
        <dd>{s.mockVolume}</dd>
        <dt>workspace</dt>
        <dd>{s.workspaceLabel?.trim() || "—"}</dd>
        <dt>branch</dt>
        <dd>{s.branchId?.trim() || "—"}</dd>
      </dl>
    </aside>
  );
}
