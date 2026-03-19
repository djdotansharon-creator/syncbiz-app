import { DeviceModeSettingsSwitch } from "@/components/device-mode-settings-switch";

export default function SettingsPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-slate-50">Settings</h1>
        <p className="mt-0.5 text-xs text-slate-400">
          Account and playback preferences. Mock-only for MVP.
        </p>
      </div>

      <section className="rounded-2xl border border-slate-800/80 bg-slate-950/50 p-5">
        <h2 className="text-sm font-semibold text-slate-50">Remote player</h2>
        <p className="mt-0.5 text-xs text-slate-400">
          Choose whether this device is MASTER (outputs audio) or CONTROL (mirrors master).
        </p>
        <div className="mt-4">
          <DeviceModeSettingsSwitch />
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800/80 bg-slate-950/50 p-5">
        <h2 className="text-sm font-semibold text-slate-50">Organization</h2>
        <p className="mt-0.5 text-xs text-slate-400">
          Informational only in this version.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-xs text-slate-500">
              Account name
            </label>
            <input
              disabled
              defaultValue="SyncBiz Demo"
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-400 outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500">
              Default timezone
            </label>
            <input
              disabled
              defaultValue="America/New_York"
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-400 outline-none"
            />
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800/80 bg-slate-950/50 p-5">
        <h2 className="text-sm font-semibold text-slate-50">
          Playback & safety
        </h2>
        <p className="mt-0.5 text-xs text-slate-400">
          How agents behave on your devices. SyncBiz does not host or stream media.
        </p>
        <ul className="mt-4 space-y-3 text-sm text-slate-300">
          <li className="flex items-start gap-2">
            <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
            Require local agent watchdog
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
            Prefer local cache when available
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
            Log TTS playback events
          </li>
        </ul>
      </section>
    </div>
  );
}
