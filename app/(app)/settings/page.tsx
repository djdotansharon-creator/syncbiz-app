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
import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale } from "@/lib/locale-server";
import { trFor } from "@/lib/i18n/phrases";
import { SettingsGate } from "@/components/management/management-gate";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { PlayerDeviceOnly } from "@/components/remote-bar/player-device-only";
import { OwnerControlPanel } from "@/components/owner-control-panel";
import { WorkspaceBusinessProfileForm } from "@/components/workspace-business-profile-form";
import { getWorkspaceBusinessProfileJson, sanitizeBusinessProfileForTenant } from "@/lib/workspace-business-profile";
import { getTenantRole } from "@/lib/user-store";
import "@/components/control-screen/settings-screen.css";

const ico = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true, className: "sb-set-ico" } as const;
const Icons = {
  play: (<svg {...ico}><circle cx="12" cy="12" r="9.2" /><path d="M10 8.4l5.6 3.6-5.6 3.6z" fill="currentColor" stroke="none" /></svg>),
  monitor: (<svg {...ico}><rect x="3" y="4.5" width="18" height="12" rx="2" /><path d="M8.5 20h7M12 16.5V20" /></svg>),
  download: (<svg {...ico}><path d="M12 3.5v11M7.5 10.5L12 15l4.5-4.5" /><path d="M4.5 19.5h15" /></svg>),
  card: (<svg {...ico}><rect x="3" y="5.5" width="18" height="13" rx="2.4" /><path d="M3 10h18M7 15h3" /></svg>),
  user: (<svg {...ico}><circle cx="12" cy="8.2" r="3.6" /><path d="M4.8 19.5c.6-3.6 3.5-5.6 7.2-5.6s6.6 2 7.2 5.6" /></svg>),
  shield: (<svg {...ico}><path d="M12 3.2l7 2.8v5.4c0 4.4-2.9 7.6-7 9.4-4.1-1.8-7-5-7-9.4V6z" /><path d="M9 12l2.2 2.2L15.4 10" /></svg>),
};

/** One frameless section: an icon + a name (+ a quiet line, + an optional action), a hairline above. */
function Section({ icon, title, description, action, children }: { icon: ReactNode; title: string; description?: string; action?: ReactNode; children?: ReactNode }) {
  return (
    <section className="sb-set-sec">
      <div className="sb-set-sec-head">
        {icon}
        <div className="min-w-0">
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {action ? <div className="sb-set-action">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** One quiet block inside a section (a name, a line, the control). */
function Sub({ title, description, children }: { title?: string; description?: string; children?: ReactNode }) {
  return (
    <div className="sb-set-sub">
      {title ? <h3>{title}</h3> : null}
      {description ? <p>{description}</p> : null}
      {children}
    </div>
  );
}

function Fact({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="sb-set-fact">
      <span>{label}</span>
      <b>{value}</b>
      <small>{note}</small>
    </div>
  );
}

async function SettingsContent({ tab }: { tab?: string }) {
  const user = await getCurrentUserFromCookies();
  if (!user) redirect("/login?from=/settings");

  const totalPacks = POC_MUSIC_BANK_CATALOG.genres.length;
  const locale = await getLocale();
  const tr = (text: string, vars?: Record<string, string | number>) => trFor(locale, text, vars);
  /** "$17/mo" → "$17 לחודש" */
  const priceText = (p: string) => (p.endsWith("/mo") ? `${p.slice(0, -3)} ${tr("per month")}` : p);

  // owner 2026-10-31: the old "Owner" tab lives here now — "Business" (workspace profile) and "Remote control" — for the people who manage the workspace
  const role = await getTenantRole(user.id, user.tenantId);
  const manages = role === "TENANT_OWNER" || role === "TENANT_ADMIN";
  const business = manages ? (
    <WorkspaceBusinessProfileForm
      workspaceId={user.tenantId}
      initialProfile={sanitizeBusinessProfileForTenant(await getWorkspaceBusinessProfileJson(user.tenantId))}
      variant="tenant"
      canEdit
    />
  ) : undefined;
  const remote = manages ? <OwnerControlPanel /> : undefined;

  return (
    // the app main area is a fixed-height region — like the other management pages, this one scrolls on its own
    <div className="mgmt-type h-full overflow-y-auto">
    <div className="sb-set">
      <header className="sb-set-head">
        <h1>{tr("Settings")}</h1>
        <p>{tr("Day-to-day playback and device preferences.")}</p>
      </header>

      <SettingsTabs initial={tab} business={business} remote={remote} general={<>

      <Section icon={Icons.play} title={tr("Playback preferences")} description={tr("Theme and language for this browser.")}>
        <div className="pb-6">
          <SettingsPreferencesControls />
        </div>
      </Section>

      <PlayerDeviceOnly>
      <Section icon={Icons.monitor} title={tr("Remote player")} description={tr("Choose whether this device is MASTER (outputs audio) or CONTROL (mirrors master).")}>
        <div className="sb-set-grid">
          <Sub>
            <DeviceModeSettingsSwitch />
          </Sub>
          <Sub title={tr("Mix / crossfade")} description={tr("Crossfade length when AutoMix is on. Direct audio URL playback only.")}>
            <MixDurationSetting />
          </Sub>
        </div>
      </Section>

      </PlayerDeviceOnly>

      <PlayerDeviceOnly>
      <Section icon={Icons.shield} title={tr("VONO Protection")} description={tr("Unattended branch-player: auto-start with Windows and automatic recovery (VONO Desktop).")}>
        <div className="sb-set-grid">
          <Sub>
            <DesktopStartupSettingsCard />
          </Sub>
          <Sub title={tr("PlayItPro Local Library")} description={tr("Play local music on this machine. The file location is never shown.")}>
            <DesktopLocalMusicSettingsCard />
          </Sub>
        </div>
        <ul className="sb-set-list">
          <li><i />{tr("Optional watchdog recovery (enable via VONO Protection)")}</li>
          <li><i />{tr("Prefer local cache when available")}</li>
          <li><i />{tr("Log TTS playback events")}</li>
        </ul>
        <div className="pb-6">
          <ClearPlaybackCacheButton />
        </div>
      </Section>
      </PlayerDeviceOnly>

      <Section
        icon={Icons.download}
        title={tr("Apps & Downloads")}
        description={tr("Install VONO on Windows, Android TV / Google TV, and phones & tablets.")}
        action={<Link href="/downloads" className="sb-set-pill">{tr("Open Downloads")}</Link>}
      />

      {/* Billing & Plan — the ONE place subscription/plan management lives. Presentation only — no billing backend is wired yet. */}
      <Section
        icon={Icons.card}
        title={tr("Billing & Plan")}
        description={tr("Your subscription, Music Bank access and Genre Packs — managed here, not in the catalog.")}
        action={<button type="button" disabled title={tr("Coming soon")} className="sb-set-pill">{tr("Change plan")}</button>}
      >
        <div className="sb-set-facts">
          <Fact label={tr("Current plan")} value={tr("Preview")} note={tr("Sample previews only — nothing unlocked yet.")} />
          <Fact label={tr("Genre Packs owned")} value={`0 / ${totalPacks}`} note={tr("Unlock from the Royalty-Free Music catalog.")} />
          <Fact label={tr("Full Music Bank")} value={tr("Locked")} note={tr("Complete-bank access · {price}", { price: priceText(FULL_BANK_PRICE_LABEL) })} />
          <Fact label={tr("Payment method")} value="—" note={tr("Added at checkout. Coming soon.")} />
        </div>
        <div className="sb-set-facts">
          <Fact label={tr("1 Genre Pack")} value={priceText(GENRE_PRICE_LABEL)} note="" />
          <Fact label={`${CHOICE3_PACK_COUNT} ${tr("Genre Packs")}`} value={priceText(CHOICE3_PRICE_LABEL)} note="" />
          <Fact label={tr("Full Music Bank")} value={priceText(FULL_BANK_PRICE_LABEL)} note={tr("Best")} />
        </div>
        <p className="sb-set-muted">{tr("Billing history and payment methods will appear here once payments are enabled.")}</p>
      </Section>

      <Section icon={Icons.user} title={tr("Account preferences")} description={tr("Profile and workspace account options. More coming soon.")}>
        <div className="sb-set-grid">
          <Sub title={tr("Organization")} description={tr("Informational only in this version.")}>
            <div className="sb-set-facts" style={{ paddingBottom: 0 }}>
              <Fact label={tr("Account name")} value="SyncBiz Demo" note="" />
              <Fact label={tr("Default timezone")} value="America/New_York" note="" />
            </div>
          </Sub>
          <Sub title={tr("More settings")} description={tr("Additional controls will appear here in future releases.")} />
        </div>
      </Section>
      </>} />
    </div>
    </div>
  );
}

export default async function SettingsPage({ searchParams }: { searchParams?: Promise<{ tab?: string }> }) {
  const tab = (await searchParams)?.tab;
  // on the player computer (desktop app) the access code comes first; a browser goes straight in
  return (
    <SettingsGate from="/settings">
      <SettingsContent tab={tab} />
    </SettingsGate>
  );
}
