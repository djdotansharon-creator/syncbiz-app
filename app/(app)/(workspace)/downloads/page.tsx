import type { ReactNode } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { DesktopDownloadButton } from "@/components/desktop-download-button";
import { StreamerDownloadButton } from "@/components/streamer-download-button";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";

export const metadata = { title: "Downloads — VONO" };

/**
 * Best-effort Android TV / Google TV detection from the User-Agent — used ONLY to
 * mark the recommended card for the current device. Every card stays available.
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
    s.includes("crkey") ||
    s.includes("aft") ||
    s.includes("bravia") ||
    s.includes("aquos") ||
    s.includes("shield") ||
    s.includes("mibox") ||
    s.includes("boxtv")
  ) {
    return true;
  }
  if (s.includes("android") && !s.includes("mobile")) {
    const tabletish = ["ipad", "tablet", "sm-t", "kindle", "nexus 7", "nexus 9", "nexus 10"];
    if (!tabletish.some((t) => s.includes(t))) return true;
  }
  return false;
}

/* ── Device / OS logos (monochrome, nominative — not app-store badges) ── */
function WindowsLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M3 5.6 10.4 4.5v7.0H3zM11.4 4.35 21 3v8.4h-9.6zM3 12.5h7.4v7.0L3 18.4zM11.4 12.5H21V21l-9.6-1.35z" />
    </svg>
  );
}
function TvLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2.5" y="4.5" width="19" height="12.5" rx="2" />
      <path d="M8.5 20.5h7M12 17v3.5" />
    </svg>
  );
}
function AppleLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M16.37 1.43c0 1.14-.42 2.2-1.12 2.98-.85.94-2.2 1.66-3.33 1.57-.14-1.1.45-2.28 1.11-3.02.76-.86 2.14-1.5 3.34-1.53zM20.5 17.1c-.55 1.27-.82 1.84-1.53 2.96-.99 1.57-2.39 3.52-4.12 3.53-1.54.01-1.94-1-4.03-.99-2.09.01-2.53 1.01-4.07.99-1.73-.02-3.06-1.78-4.05-3.35C-.02 16.9-.32 12.3 1.14 9.86c1.02-1.73 2.65-2.74 4.18-2.74 1.56 0 2.54 1.01 3.83 1.01 1.25 0 2.01-1.01 3.81-1.01 1.36 0 2.8.74 3.83 2.02-3.36 1.84-2.81 6.63.71 7.96z" />
    </svg>
  );
}
function AndroidLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M6 9v7a1 1 0 0 0 1 1h1v3a1 1 0 0 0 2 0v-3h2v3a1 1 0 0 0 2 0v-3h1a1 1 0 0 0 1-1V9zM3.5 9A1.5 1.5 0 0 0 2 10.5v4a1.5 1.5 0 0 0 3 0v-4A1.5 1.5 0 0 0 3.5 9zm17 0A1.5 1.5 0 0 0 19 10.5v4a1.5 1.5 0 0 0 3 0v-4A1.5 1.5 0 0 0 20.5 9zM15.5 3.6l1-1.5a.3.3 0 0 0-.5-.34l-1.09 1.6a6.5 6.5 0 0 0-5.82 0L8 1.76a.3.3 0 0 0-.5.34l1 1.5A5.8 5.8 0 0 0 6 8h12a5.8 5.8 0 0 0-2.5-4.4zM9.5 6.2a.7.7 0 1 1 0-1.4.7.7 0 0 1 0 1.4zm5 0a.7.7 0 1 1 0-1.4.7.7 0 0 1 0 1.4z" />
    </svg>
  );
}

function SectionHeader({ children }: { children: ReactNode }) {
  return (
    <div className="text-center">
      <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-300">{children}</h2>
      <div className="mx-auto mt-2 h-[3px] w-10 rounded-full bg-[#22d3ee]" />
    </div>
  );
}

function DeviceCard({
  logo,
  title,
  note,
  primary,
  children,
}: {
  logo: ReactNode;
  title: string;
  note?: string;
  primary?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`relative flex flex-col items-center rounded-2xl border p-6 text-center ${
        primary ? "border-sky-500/50 bg-sky-500/[0.06] ring-2 ring-sky-500/40" : "border-slate-800/80 bg-slate-950/50"
      }`}
    >
      {primary ? (
        <span className="absolute right-3 top-3 rounded-full bg-sky-500 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
          Recommended
        </span>
      ) : null}
      <div className="flex h-14 w-14 items-center justify-center text-slate-100">{logo}</div>
      <h3 className="mt-3 text-base font-semibold text-slate-50">{title}</h3>
      {note ? <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{note}</p> : null}
      <div className="mt-4 w-full">{children}</div>
    </div>
  );
}

/** Static "install from browser" affordance for the PWA cards. */
function PwaAction({ label }: { label: string }) {
  return (
    <div className="inline-flex w-full items-center justify-center rounded-xl border border-slate-700/70 bg-slate-900/60 px-4 py-3 text-sm font-semibold text-slate-300">
      {label}
    </div>
  );
}

// Centered, fixed-width cards that wrap and never stretch full-width.
const SECTION_GRID = "mx-auto mt-5 grid justify-center gap-5";
const SECTION_GRID_STYLE = { gridTemplateColumns: "repeat(auto-fit, minmax(240px, 300px))" } as const;

export default async function DownloadsPage() {
  const user = await getCurrentUserFromCookies();
  if (!user) redirect("/login?from=/downloads");

  const ua = (await headers()).get("user-agent") ?? "";
  const tv = isAndroidTvContext(ua);

  return (
    <div className="w-full px-4 pb-16 pt-8 sm:pt-10">
      {/* Header */}
      <header className="text-center">
        <span className="inline-block rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-sky-300">
          Desktop, TV, Mobile &amp; more
        </span>
        <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-50 sm:text-4xl">Download VONO</h1>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-slate-400">
          Play VONO on any screen at your location. One account works everywhere — sign in once on each device.
        </p>
      </header>

      {/* Sections are ordered so the recommended device for THIS screen comes first —
          e.g. on the GOtv the TV/Streamer card is at the very top, reachable without
          any scrolling. */}
      {(tv ? ["tv", "desktop", "mobile"] : ["desktop", "tv", "mobile"]).map((id) => {
        if (id === "desktop") {
          return (
            <section key="desktop" className="mt-10">
              <SectionHeader>Desktop</SectionHeader>
              <div className={SECTION_GRID} style={SECTION_GRID_STYLE}>
                <DeviceCard logo={<WindowsLogo className="h-11 w-11" />} title="Windows" note="Windows 10 / 11 — runs as a MASTER player" primary={!tv}>
                  <DesktopDownloadButton />
                </DeviceCard>
              </div>
            </section>
          );
        }
        if (id === "tv") {
          return (
            <section key="tv" className="mt-10">
              <SectionHeader>TV</SectionHeader>
              <div className={SECTION_GRID} style={SECTION_GRID_STYLE}>
                <DeviceCard
                  logo={<TvLogo className="h-11 w-11" />}
                  title="Android TV / Google TV"
                  note="TV box or stick — install, sign in once. Allow install from this source if asked."
                  primary={tv}
                >
                  <StreamerDownloadButton />
                </DeviceCard>
              </div>
            </section>
          );
        }
        return (
          <section key="mobile" className="mt-10">
            <SectionHeader>Mobile &amp; Tablet</SectionHeader>
            <div className={SECTION_GRID} style={SECTION_GRID_STYLE}>
              <DeviceCard logo={<AppleLogo className="h-11 w-11" />} title="iPhone &amp; iPad" note="Open in Safari → Share → Add to Home Screen">
                <PwaAction label="Install from Safari" />
              </DeviceCard>
              <DeviceCard logo={<AndroidLogo className="h-11 w-11" />} title="Android phone &amp; tablet" note="Open in Chrome → menu → Install app">
                <PwaAction label="Install from Chrome" />
              </DeviceCard>
            </div>
          </section>
        );
      })}

      <p className="mx-auto mt-12 max-w-xl text-center text-[11px] leading-relaxed text-slate-500">
        Every VONO app connects to the same account and your location&rsquo;s controls — the player engine is identical
        across devices.
      </p>
    </div>
  );
}
