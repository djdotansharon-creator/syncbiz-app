export default function ArchitecturePage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-slate-50">Architecture</h1>
        <p className="mt-0.5 text-xs text-slate-400">
          How SyncBiz sends commands to endpoint agents. SyncBiz does not store or host media.
        </p>
      </div>

      <section className="space-y-4 rounded-2xl border border-slate-800/80 bg-slate-950/50 p-5">
        <h2 className="text-sm font-semibold text-slate-50">
          Cloud → API → Local Agent (poll every 10s) → Device actions
        </h2>
        <ol className="space-y-3 text-sm text-slate-300">
          <li>
            <span className="font-medium text-slate-100">Cloud SaaS:</span>{" "}
            Stores devices, sources, schedules, announcements. Does not host or
            stream music; no Spotify or YouTube APIs.
          </li>
          <li>
            <span className="font-medium text-slate-100">API:</span> Exposes
            schedules and control commands. Only metadata and commands — no
            media files.
          </li>
          <li>
            <span className="font-medium text-slate-100">Local agent:</span>{" "}
            Polls API ~every 10 seconds, applies schedules and commands on
            customer-owned devices.
          </li>
          <li>
            <span className="font-medium text-slate-100">Device actions:</span>{" "}
            Agent sends commands: OPEN_URL, STOP_CURRENT, PLAY_TARGET, PLAY_TTS,
            SET_VOLUME, RESUME_PREVIOUS. The endpoint executes playback.
          </li>
        </ol>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-slate-800/80 bg-slate-950/50 p-5">
          <h2 className="text-sm font-semibold text-slate-50">
            Local agent components
          </h2>
          <ul className="mt-3 space-y-2 text-xs text-slate-400">
            <li>· Agent poller</li>
            <li>· Watchdog</li>
            <li>· Local cache</li>
            <li>· Audio state monitor</li>
            <li>· TTS player</li>
            <li>· Browser / app launcher</li>
          </ul>
        </div>
        <div className="rounded-2xl border border-slate-800/80 bg-slate-950/50 p-5">
          <h2 className="text-sm font-semibold text-slate-50">
            Command types
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
            SyncBiz does not host or stream media. It only sends commands to
            customer-owned endpoint devices.
          </p>
        </div>
      </section>
    </div>
  );
}
