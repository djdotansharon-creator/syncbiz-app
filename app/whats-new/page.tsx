import { resolveLatestWindowsInstaller, desktopReleasesPageUrl } from "@/lib/desktop-installer-resolve";
import { parseReleaseNotes } from "@/lib/release-notes";
import { getLocale } from "@/lib/locale-server";
import { trFor } from "@/lib/i18n/phrases";

export const metadata = { title: "What's new — VONO Player" };
/** the latest published release, refreshed every five minutes (the resolver itself caches the GitHub call) */
export const revalidate = 300;

/**
 * "What's new" — the page the app's update card opens (owner 2026-11-10): the version number, the short headlines of the latest published update, and the button that downloads it.
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
      <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-white/50">VONO Player</p>
      {latest ? (
        <>
          <h1 className="mt-2 text-[34px] font-bold leading-tight tracking-tight">{tr("What's new in VONO Player {v}", { v: latest.version })}</h1>
          {published ? <p className="mt-1 text-[13px] text-white/50">{published.toLocaleDateString(locale === "he" ? "he-IL" : "en-GB", { day: "numeric", month: "long", year: "numeric" })}</p> : null}

          <section className="mt-7 rounded-2xl bg-white/[0.06] px-5 py-5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07)]">
            {hasNotes ? (
              <>
                {notes.paragraphs.map((p, i) => (
                  <p key={`p${i}`} className="mb-3 text-[15px] leading-relaxed text-white/80">{p}</p>
                ))}
                {notes.items.length > 0 ? (
                  <ul className="space-y-3">
                    {notes.items.map((it, i) => (
                      <li key={`i${i}`} className="flex gap-3 text-[16px] font-medium leading-snug">
                        <span aria-hidden className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#fbbf24]" />
                        <span dir="auto">{it}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : (
              <p className="text-[15px] text-white/60">{tr("No details were published for this version.")}</p>
            )}
          </section>

          <a
            href="/api/desktop/installer"
            className="mt-6 flex h-12 items-center justify-center rounded-full bg-[#fbbf24] text-[15px] font-bold text-[#1c1400] no-underline transition hover:bg-[#fcd34d] active:scale-[0.99]"
          >
            {tr("Update now")}
            {mb ? <span className="ms-2 text-[12px] font-semibold opacity-70" dir="ltr">· {mb} MB</span> : null}
          </a>
          <p className="mt-3 text-center text-[12.5px] leading-relaxed text-white/50">{tr("After the download: close VONO and run the file — it installs over the current version.")}</p>
        </>
      ) : (
        <>
          <h1 className="mt-2 text-[30px] font-bold leading-tight tracking-tight">{tr("What's new")}</h1>
          <p className="mt-4 text-[15px] text-white/60">{tr("The update is not available for download yet.")}</p>
        </>
      )}
      <a href={desktopReleasesPageUrl()} target="_blank" rel="noopener noreferrer" className="mt-8 text-center text-[12.5px] text-white/45 underline-offset-4 hover:text-white/70 hover:underline">
        {tr("All versions")}
      </a>
    </main>
    </div>
  );
}
