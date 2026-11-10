import { resolveLatestWindowsInstaller, desktopReleasesPageUrl } from "@/lib/desktop-installer-resolve";
import { parseReleaseNotes } from "@/lib/release-notes";
import { getLocale } from "@/lib/locale-server";
import { trFor } from "@/lib/i18n/phrases";
import { WhatsNewNotes } from "@/components/whats-new-notes";

export const metadata = { title: "What's new — VONO Player" };
/** the latest published release, refreshed every five minutes (the resolver itself caches the GitHub call) */
export const revalidate = 300;

/** the delay (ms) before a block rises out of the mist — the page fills from the top down */
const rise = (ms: number) => ({ "--d": `${ms}ms` }) as React.CSSProperties;

/**
 * "What's new" — the page the app's update card opens (owner 2026-11-10): the version number, the release date and size, the short headlines of the latest published update (no frame, scrolling between a soft blur above and below) and the one-word Update button under them.
 * Public on purpose (the notes are public on GitHub anyway); no login, no app chrome — so it paints its OWN dark background (outside the app layout the page is otherwise white).
 */
export default async function WhatsNewPage() {
  const locale = await getLocale();
  const tr = (text: string, vars?: Record<string, string | number>) => trFor(locale, text, vars);
  const latest = await resolveLatestWindowsInstaller();
  const notes = parseReleaseNotes(latest?.notes);
  const hasNotes = notes.items.length + notes.paragraphs.length > 0;
  const published = latest?.publishedAt ? new Date(latest.publishedAt) : null;
  const mb = latest && latest.sizeBytes ? Math.round(latest.sizeBytes / 1_000_000) : null;

  return (
    <div className="min-h-screen w-full bg-[#0b0f16]">
    <main className="mx-auto flex min-h-screen w-full max-w-[640px] flex-col justify-center px-5 py-12 text-[#f5f5f7]">
      <p className="sb-wn-rise text-[12px] font-semibold uppercase tracking-[0.14em] text-white/50" style={rise(0)}>VONO Player</p>
      {latest ? (
        <>
          <h1 className="sb-wn-rise mt-2 text-[34px] font-bold leading-tight tracking-tight" style={rise(120)}>{tr("What's new in VONO Player {v}", { v: latest.version })}</h1>
          {published || mb ? (
            <p className="sb-wn-rise mt-1 text-[13px] text-white/50" style={rise(240)}>
              {published ? published.toLocaleDateString(locale === "he" ? "he-IL" : "en-GB", { day: "numeric", month: "long", year: "numeric" }) : null}
              {published && mb ? " · " : null}
              {mb ? <span dir="ltr">{mb} MB</span> : null}
            </p>
          ) : null}

          <section className="mt-7">
            {hasNotes ? (
              <WhatsNewNotes paragraphs={notes.paragraphs} items={notes.items} label={tr("What's new")} />
            ) : (
              <p className="text-[15px] text-white/60">{tr("No details were published for this version.")}</p>
            )}
          </section>

          <a
            href="/api/desktop/installer"
            style={rise(1380)}
            className="sb-wn-rise mt-12 flex h-12 items-center justify-center rounded-full bg-[#fbbf24] text-[15px] font-bold text-[#1c1400] no-underline transition hover:bg-[#fcd34d] active:scale-[0.99]"
          >
            {tr("Update")}
          </a>
          <p className="sb-wn-rise mt-3 text-center text-[12.5px] leading-relaxed text-white/50" style={rise(1500)}>{tr("After the download: close VONO and run the file — it installs over the current version.")}</p>
        </>
      ) : (
        <>
          <h1 className="mt-2 text-[30px] font-bold leading-tight tracking-tight">{tr("What's new")}</h1>
          <p className="mt-4 text-[15px] text-white/60">{tr("The update is not available for download yet.")}</p>
        </>
      )}
      <a href={desktopReleasesPageUrl()} target="_blank" rel="noopener noreferrer" style={rise(1620)} className="sb-wn-rise mt-8 text-center text-[12.5px] text-white/45 underline-offset-4 hover:text-white/70 hover:underline">
        {tr("All versions")}
      </a>
    </main>
    </div>
  );
}
