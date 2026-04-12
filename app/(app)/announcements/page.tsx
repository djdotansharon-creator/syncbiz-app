import { DenseDataRowSurface } from "@/components/player-surface/dense-data-row-surface";
import {
  DENSE_ADMIN_ANNOUNCEMENTS_TABLE_HEADER_CLASS,
  DENSE_ADMIN_ANNOUNCEMENTS_TABLE_ROW_GRID_CLASS,
} from "@/lib/player-surface/dense-data-row-constants";
import { getApiBase } from "@/lib/api-base";
import type { Announcement } from "@/lib/types";

async function getAnnouncements(): Promise<Announcement[]> {
  try {
    const base = getApiBase();
    const res = await fetch(`${base}/api/announcements`, { cache: "no-store" });
    if (!res.ok) {
      console.error("[announcements] API error:", res.status, await res.text());
      return [];
    }
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error("[announcements] getAnnouncements error:", e);
    return [];
  }
}

export default async function AnnouncementsPage() {
  const announcements = await getAnnouncements();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-50">Announcements</h1>
        <p className="mt-1 text-sm text-slate-400">
          TTS and promo triggers. Optionally resume previous source after playing. SyncBiz does not store media.
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-950/50">
        <div className={DENSE_ADMIN_ANNOUNCEMENTS_TABLE_HEADER_CLASS}>
          <div>Announcement</div>
          <div>Window</div>
          <div>Status</div>
        </div>
        <div className="divide-y divide-slate-800/60">
          {announcements.map((a) => {
            const start = new Date(a.windowStart);
            const end = new Date(a.windowEnd);
            return (
              <DenseDataRowSurface
                key={a.id}
                gridClassName={DENSE_ADMIN_ANNOUNCEMENTS_TABLE_ROW_GRID_CLASS}
                cells={[
                  <div key="ann">
                    <p className="font-medium text-slate-100">{a.title}</p>
                    <p className="line-clamp-2 text-xs text-slate-500">{a.message}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {a.ttsEnabled ? "TTS" : "Pre-recorded"} ·{" "}
                      <span className="capitalize">{a.priority}</span>
                      {a.resumePreviousSource ? (
                        <>
                          {" "}
                          · <span className="text-sky-400/90">Resume previous</span>
                        </>
                      ) : null}
                    </p>
                  </div>,
                  <div key="window">
                    <p className="text-slate-200">
                      {start.toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}{" "}
                      {start.toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}{" "}
                      –{" "}
                      {end.toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>,
                  <div key="status" className="flex items-center gap-2">
                    <span
                      className={`h-2 w-2 rounded-full ${
                        a.status === "draft"
                          ? "bg-slate-500"
                          : a.status === "scheduled"
                            ? "bg-amber-400"
                            : "bg-emerald-400"
                      }`}
                    />
                    <span className="capitalize text-slate-200">{a.status}</span>
                  </div>,
                ]}
              />
            );
          })}
        </div>
        {announcements.length === 0 && (
          <div className="py-12 text-center text-sm text-slate-500">
            No announcements yet.
          </div>
        )}
      </div>
    </div>
  );
}
