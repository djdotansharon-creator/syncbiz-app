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
        <div className="grid grid-cols-[1.4fr,1.2fr,0.8fr] gap-4 border-b border-slate-800/80 px-4 py-3 text-xs font-medium uppercase tracking-wider text-slate-500">
          <div>Announcement</div>
          <div>Window</div>
          <div>Status</div>
        </div>
        <div className="divide-y divide-slate-800/60">
          {announcements.map((a) => {
            const start = new Date(a.windowStart);
            const end = new Date(a.windowEnd);
            return (
              <div
                key={a.id}
                className="grid grid-cols-[1.4fr,1.2fr,0.8fr] gap-4 px-4 py-3 text-sm transition hover:bg-slate-900/40"
              >
                <div>
                  <p className="font-medium text-slate-100">{a.title}</p>
                  <p className="line-clamp-2 text-xs text-slate-500">
                    {a.message}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {a.ttsEnabled ? "TTS" : "Pre-recorded"} ·{" "}
                    <span className="capitalize">{a.priority}</span>
                    {a.resumePreviousSource && (
                      <> · <span className="text-sky-400/90">Resume previous</span></>
                    )}
                  </p>
                </div>
                <div>
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
                </div>
                <div className="flex items-center gap-2">
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
                </div>
              </div>
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
