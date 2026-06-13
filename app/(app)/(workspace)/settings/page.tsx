import type { ReactNode } from "react";
import { ClearPlaybackCacheButton } from "@/components/clear-playback-cache-button";
import {
  DesktopStartupSettingsCard,
  DesktopLocalMusicSettingsCard,
  DesktopOperatorToolsToggle,
  DesktopPlaylistProOperatorCard,
} from "@/components/desktop-settings-controls";
import { DeviceModeSettingsSwitch } from "@/components/device-mode-settings-switch";
import { StreamerDeviceSettingsPanel } from "@/components/streamer-device-settings-panel";
import { MixDurationSetting } from "@/components/mix-duration-setting";
import { SettingsPreferencesControls } from "@/components/settings-preferences-controls";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";
import { redirect } from "next/navigation";

function PlaceholderCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-800/80 bg-slate-950/50 p-5">
      <h2 className="text-sm font-semibold text-slate-50">{title}</h2>
      <p className="mt-0.5 text-xs text-slate-400">{description}</p>
      {children ? <div className="mt-4">{children}</div> : null}
    </div>
  );
}

export default async function SettingsPage() {
  const user = await getCurrentUserFromCookies();
  if (!user) redirect("/login?from=/settings");

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-slate-50">Settings</h1>
        <p className="mt-0.5 text-xs text-slate-400">
          Day-to-day playback and device preferences. Workspace business profile lives under{" "}
          <span className="text-slate-300">Owner</span>.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <PlaceholderCard
          title="Playback preferences"
          description="Theme and language for this browser."
        >
          <SettingsPreferencesControls />
        </PlaceholderCard>
        <PlaceholderCard title="Startup" description="Desktop app launches at login.">
          <DesktopStartupSettingsCard />
        </PlaceholderCard>
        <PlaceholderCard
          title="Local Music"
          description="PlaylistPro library on this device. Paths are resolved by Desktop only."
        >
          <DesktopLocalMusicSettingsCard />
        </PlaceholderCard>
        <PlaceholderCard
          title="Advanced / Operator"
          description="Maintenance tools for PlaylistPro metadata. Hidden from normal library UI."
        >
          <div className="space-y-5">
            <DesktopOperatorToolsToggle />
            <DesktopPlaylistProOperatorCard />
          </div>
        </PlaceholderCard>
        <PlaceholderCard
          title="Account preferences"
          description="Profile and workspace account options. More coming soon."
        />
        <PlaceholderCard
          title="More settings"
          description="Additional controls will appear here in future releases."
        />
      </div>

      <section className="rounded-2xl border border-slate-800/80 bg-slate-950/50 p-5">
        <h2 className="text-sm font-semibold text-slate-50">Branch streamer (GOtv / Android TV)</h2>
        <p className="mt-0.5 text-xs text-slate-400">
          Pair a dedicated TV player once — it stays logged in without browser passwords.
        </p>
        <div className="mt-4">
          <StreamerDeviceSettingsPanel />
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800/80 bg-slate-950/50 p-5">
        <h2 className="text-sm font-semibold text-slate-50">Remote player</h2>
        <p className="mt-0.5 text-xs text-slate-400">
          Choose whether this device is MASTER (outputs audio) or CONTROL (mirrors master).
        </p>
        <div className="mt-4">
          <DeviceModeSettingsSwitch />
        </div>
        <div className="mt-6 border-t border-slate-800/60 pt-6">
          <h3 className="text-xs font-semibold text-slate-300">Mix / crossfade</h3>
          <p className="mt-0.5 text-[11px] text-slate-500">
            Crossfade length when AutoMix is on. Direct audio URL playback only.
          </p>
          <div className="mt-3">
            <MixDurationSetting />
          </div>
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
        <ClearPlaybackCacheButton />
      </section>
    </div>
  );
}
