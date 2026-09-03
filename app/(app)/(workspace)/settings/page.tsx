import type { ReactNode } from "react";
import { ClearPlaybackCacheButton } from "@/components/clear-playback-cache-button";
import {
  DesktopStartupSettingsCard,
  DesktopLocalMusicSettingsCard,
} from "@/components/desktop-settings-controls";
import { DeviceModeSettingsSwitch } from "@/components/device-mode-settings-switch";
import { MixDurationSetting } from "@/components/mix-duration-setting";
import { SettingsPreferencesControls } from "@/components/settings-preferences-controls";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";
import { POC_MUSIC_BANK_CATALOG } from "@/lib/music-bank/poc-catalog";
import { GENRE_PRICE_LABEL, CHOICE3_PRICE_LABEL, FULL_BANK_PRICE_LABEL, CHOICE3_PACK_COUNT } from "@/lib/music-bank/pricing";
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

/** One status tile inside Billing & Plan. */
function BillingStatTile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-xl border border-slate-800/70 bg-slate-900/40 p-4">
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-100">{value}</p>
      <p className="mt-0.5 text-xs text-slate-400">{note}</p>
    </div>
  );
}

/** One plan option inside Billing & Plan (presentation only — payments not built yet). */
function PlanTile({ label, price, best }: { label: string; price: string; best?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${best ? "border-[#0a84ff]/40 bg-[#0a84ff]/[0.07]" : "border-slate-800/70 bg-slate-900/40"}`}>
      <div className="flex items-center gap-1.5">
        <p className="text-xs font-semibold text-slate-100">{label}</p>
        {best ? <span className="text-[9px] font-bold uppercase tracking-wider text-[#7db8ff]">Best</span> : null}
      </div>
      <p className="mt-1 text-sm font-semibold tabular-nums text-white">{price}</p>
    </div>
  );
}

export default async function SettingsPage() {
  const user = await getCurrentUserFromCookies();
  if (!user) redirect("/login?from=/settings");

  const totalPacks = POC_MUSIC_BANK_CATALOG.genres.length;

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
        <PlaceholderCard title="PlayItPro Local Library" description="Play local music on this machine. The file location is never shown.">
          <DesktopLocalMusicSettingsCard />
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

      {/* Billing & Plan — the ONE place subscription/plan management lives. The Royalty-Free Music
          catalog stays music-only; unlocking a locked pack there opens a contextual modal that points
          back here. Presentation only — no billing backend is wired yet. */}
      <section className="rounded-2xl border border-slate-800/80 bg-slate-950/50 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-50">Billing &amp; Plan</h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Your subscription, Music Bank access and Genre Packs — managed here, not in the catalog.
            </p>
          </div>
          <button
            type="button"
            disabled
            title="Coming soon"
            className="shrink-0 cursor-not-allowed rounded-lg bg-[#0a84ff]/70 px-3 py-1.5 text-xs font-semibold text-white/90"
          >
            Change plan
          </button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <BillingStatTile label="Current plan" value="Preview" note="Sample previews only — nothing unlocked yet." />
          <BillingStatTile label="Genre Packs owned" value={`0 / ${totalPacks}`} note="Unlock from the Royalty-Free Music catalog." />
          <BillingStatTile label="Full Music Bank" value="Locked" note={`Complete-bank access · ${FULL_BANK_PRICE_LABEL}`} />
          <BillingStatTile label="Payment method" value="—" note="Added at checkout. Coming soon." />
        </div>

        <div className="mt-5 border-t border-slate-800/60 pt-5">
          <h3 className="text-xs font-semibold text-slate-300">Plans</h3>
          <p className="mt-0.5 text-[11px] text-slate-500">Upgrade or change plan. Payments &amp; entitlements coming soon.</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <PlanTile label="1 Genre Pack" price={GENRE_PRICE_LABEL} />
            <PlanTile label={`${CHOICE3_PACK_COUNT} Genre Packs`} price={CHOICE3_PRICE_LABEL} />
            <PlanTile label="Full Music Bank" price={FULL_BANK_PRICE_LABEL} best />
          </div>
        </div>

        <p className="mt-4 text-[11px] text-slate-500">Billing history and payment methods will appear here once payments are enabled.</p>
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
