import { getLocale } from "@/lib/locale-server";
import { trFor } from "@/lib/i18n/phrases";

export default async function ArchitecturePage() {
  const locale = await getLocale();
  const tr = (text: string) => trFor(locale, text);
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-slate-50">{tr("Architecture")}</h1>
        <p className="mt-0.5 text-xs text-slate-400">
          {tr("How SyncBiz sends commands to endpoint agents. SyncBiz does not store or host media.")}
        </p>
      </div>

      <section className="space-y-4 rounded-2xl border border-slate-800/80 bg-slate-950/50 p-5">
        <h2 className="text-sm font-semibold text-slate-50">
          {tr("Cloud → API → Local Agent (poll every 10s) → Device actions")}
        </h2>
        <ol className="space-y-3 text-sm text-slate-300">
          <li>
            <span className="font-medium text-slate-100">{tr("Cloud SaaS:")}</span>{" "}
            {tr("Stores devices, sources, schedules, announcements. Does not host or stream music; no Spotify or YouTube APIs.")}
          </li>
          <li>
            <span className="font-medium text-slate-100">{tr("API:")}</span>{" "}
            {tr("Exposes schedules and control commands. Only metadata and commands — no media files.")}
          </li>
          <li>
            <span className="font-medium text-slate-100">{tr("Local agent:")}</span>{" "}
            {tr("Polls API ~every 10 seconds, applies schedules and commands on customer-owned devices.")}
          </li>
          <li>
            <span className="font-medium text-slate-100">{tr("Device actions:")}</span>{" "}
            {tr("Agent sends commands:")} OPEN_URL, STOP_CURRENT, PLAY_TARGET, PLAY_TTS,
            SET_VOLUME, RESUME_PREVIOUS. {tr("The endpoint executes playback.")}
          </li>
        </ol>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-slate-800/80 bg-slate-950/50 p-5">
          <h2 className="text-sm font-semibold text-slate-50">
            {tr("Local agent components")}
          </h2>
          <ul className="mt-3 space-y-2 text-xs text-slate-400">
            <li>· {tr("Agent poller")}</li>
            <li>· {tr("Watchdog")}</li>
            <li>· {tr("Local cache")}</li>
            <li>· {tr("Audio state monitor")}</li>
            <li>· {tr("TTS player")}</li>
            <li>· {tr("Browser / app launcher")}</li>
          </ul>
        </div>
        <div className="rounded-2xl border border-slate-800/80 bg-slate-950/50 p-5">
          <h2 className="text-sm font-semibold text-slate-50">
            {tr("Command types")}
          </h2>
          <ul className="mt-3 space-y-2 text-xs text-slate-400">
            <li>· OPEN_URL</li>
            <li>· STOP_CURRENT</li>
            <li>· PLAY_TARGET</li>
            <li>· PLAY_TTS</li>
            <li>· SET_VOLUME</li>
            <li>· RESUME_PREVIOUS</li>
          </ul>
          <p className="mt-3 text-[11px] text-slate-500">
            {tr("SyncBiz does not host or stream media. It only sends commands to customer-owned endpoint devices.")}
          </p>
        </div>
      </section>
    </div>
  );
}
