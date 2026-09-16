import type { ReactNode } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { DesktopDownloadButton } from "@/components/desktop-download-button";
import { StreamerDownloadButton } from "@/components/streamer-download-button";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";

export const metadata = { title: "Downloads — VONO" };

/**
 * Best-effort Android TV / Google TV detection from the User-Agent. TVs report
 * either an explicit TV token or "Android" without the "Mobile" token (phones
 * always include "Mobile"). Used ONLY to decide which download card is primary —
 * every card stays available regardless. Desktop (Windows/Mac/Linux) never
 * matches, so it keeps the Windows card primary.
 */
function isAndroidTvContext(ua: string): boolean {
  const s = (ua || "").toLowerCase();
  if (!s) return false;
  if (
    s.includes("android tv") ||
    s.includes("googletv") ||
    s.includes("google tv") ||
    s.includes("smart-tv") ||
    s.includes("smarttv") ||
    s.includes("crkey") || // Chromecast
    s.includes("aft") || // Amazon Fire TV
    s.includes("bravia") ||
    s.includes("aquos") ||
    s.includes("shield") ||
    s.includes("mibox") ||
    s.includes("boxtv")
  ) {
    return true;
  }
  // Generic Android TV boxes/sticks: Android, but not a phone ("Mobile") and not a
  // touch tablet model. Covers OEM TVs (e.g. GOtv Y) whose UA carries no TV token.
  if (s.includes("android") && !s.includes("mobile")) {
    const tabletish = ["ipad", "tablet", "sm-t", "kindle", "nexus 7", "nexus 9", "nexus 10"];
    if (!tabletish.some((t) => s.includes(t))) return true;
  }
  return false;
}

function AppCard({
  eyebrow,
  title,
  subtitle,
  primary,
  badge,
  children,
  footer,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  primary?: boolean;
  badge?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div
      className={`flex h-full flex-col rounded-2xl border p-6 ${
        primary
          ? "border-sky-500/50 bg-sky-500/[0.06] ring-2 ring-sky-500/40"
          : "border-slate-800/80 bg-slate-950/50"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-sky-400/80">{eyebrow}</p>
        {badge ? (
          <span className="shrink-0 rounded-full bg-sky-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
            {badge}
          </span>
        ) : null}
      </div>
      <h2 className="mt-1 text-base font-semibold text-slate-50">{title}</h2>
      <p className="mt-1 text-xs leading-relaxed text-slate-400">{subtitle}</p>
      <div className="mt-4">{children}</div>
      {footer ? <div className="mt-4 border-t border-slate-800/60 pt-4">{footer}</div> : null}
    </div>
  );
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-900/70 text-[11px] font-bold text-sky-200 ring-1 ring-sky-500/30 tabular-nums">
        {n}
      </span>
      <span className="text-xs leading-relaxed text-slate-300">{children}</span>
    </li>
  );
}

export default async function DownloadsPage() {
  const user = await getCurrentUserFromCookies();
  if (!user) redirect("/login?from=/downloads");

  const ua = (await headers()).get("user-agent") ?? "";
  const tv = isAndroidTvContext(ua);

  // Windows player card
  const windowsCard = (
    <AppCard
      key="windows"
      eyebrow="Desktop"
      title="VONO Player for Windows"
      subtitle="The full player for a Windows PC or mini-PC connected to your sound system."
      primary={!tv}
      badge={!tv ? "Recommended for this device" : undefined}
    >
      <DesktopDownloadButton />
      <p className="mt-3 text-[11px] text-slate-500">Windows 10 or 11. Runs your location as a MASTER player.</p>
    </AppCard>
  );

  // Android TV / Google TV streamer card
  const streamerCard = (
    <AppCard
      key="streamer"
      eyebrow="Android TV / Google TV"
      title="VONO Streamer"
      subtitle="A dedicated app for a TV box or stick at the location — plug in, install, sign in once."
      primary={tv}
      badge={tv ? "Recommended for this device" : undefined}
      footer={
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">How to install</p>
          <ol className="mt-3 space-y-3">
            <Step n={1}>On the TV device, tap <strong className="text-slate-200">Download VONO Streamer</strong>.</Step>
            <Step n={2}>When the TV asks to <em className="text-slate-200">allow installing apps from this source</em>, choose <strong className="text-slate-200">Allow</strong> (a one-time prompt), then open the downloaded file to install.</Step>
            <Step n={3}>Open <strong className="text-slate-200">VONO Streamer</strong> from the TV home screen and sign in once. It stays signed in and starts full-screen from then on.</Step>
          </ol>
          <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
            Works on Android TV / Google TV, TV boxes &amp; sticks, Chromecast with Google TV, Xiaomi TV Box and NVIDIA Shield.
            Tested on GOtv Y (Android TV 14). Any device with a modern browser can instead open the web player directly.
          </p>
        </div>
      }
    >
      <StreamerDownloadButton />
      <p className="mt-3 text-[11px] text-slate-500">
        Requires an <strong className="text-slate-300">Android TV / Google TV</strong> device.
      </p>
    </AppCard>
  );

  // Mobile / Tablet PWA card (unchanged)
  const mobileCard = (
    <AppCard
      key="mobile"
      eyebrow="Phone &amp; tablet"
      title="VONO Mobile / Tablet"
      subtitle="Use VONO as a remote or on a tablet at the counter — no app store needed."
      footer={
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">How to install</p>
          <ol className="mt-3 space-y-3">
            <Step n={1}>On the phone or tablet, open VONO in the browser and sign in.</Step>
            <Step n={2}>Open the browser menu and choose <strong className="text-slate-200">Add to Home Screen</strong> (or <strong className="text-slate-200">Install app</strong>).</Step>
            <Step n={3}>Launch VONO from the new home-screen icon — it opens full-screen like an app.</Step>
          </ol>
        </div>
      }
    >
      <div className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-700/70 bg-slate-900/60 px-4 py-3 text-center text-sm font-semibold text-slate-300">
        Install from the browser
      </div>
      <p className="mt-3 text-[11px] text-slate-500">iPhone &amp; iPad (Safari), Android phones &amp; tablets (Chrome).</p>
    </AppCard>
  );

  // On Android TV → VONO Streamer is the primary card; Windows stays available but
  // secondary. Everywhere else → Windows primary. Mobile/Tablet is always secondary.
  const primaryCard = tv ? streamerCard : windowsCard;
  const secondaryCards = tv ? [windowsCard, mobileCard] : [streamerCard, mobileCard];

  return (
    <div className="mx-auto w-full max-w-6xl px-2 py-8 sm:py-12">
      {/* Centered landing-style header */}
      <header className="mx-auto max-w-2xl text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50 sm:text-3xl">Downloads &amp; Apps</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-400">
          Install VONO on your screens. One account works across every device — sign in once on each.
        </p>
      </header>

      {/* Primary download for this device — prominent and centered */}
      <div className="mx-auto mt-10 w-full max-w-2xl">{primaryCard}</div>

      {/* Other apps — still available; auto-fit so cards never squash */}
      <div
        className="mx-auto mt-6 grid w-full max-w-4xl gap-5"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))" }}
      >
        {secondaryCards}
      </div>

      <p className="mx-auto mt-10 max-w-2xl text-center text-[11px] leading-relaxed text-slate-500">
        Every VONO app connects to the same VONO account and your location&rsquo;s controls. The player engine is identical
        across devices — the apps above are just the way each screen runs it.
      </p>
    </div>
  );
}
