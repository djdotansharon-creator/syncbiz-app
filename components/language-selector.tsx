"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocale } from "@/lib/locale-context";
import { LOCALES, localeMeta } from "@/lib/locales";

/** Round SVG flag (flag-icons) — renders on Windows too, unlike emoji flags. */
function Flag({ country, size = 20 }: { country: string; size?: number }) {
  return (
    <span
      className={`fi fi-${country} shrink-0 rounded-full ring-1 ring-black/10`}
      style={{ width: size, height: size, backgroundSize: "cover", backgroundPosition: "center" }}
      aria-hidden
    />
  );
}

/**
 * Header language picker — a round flag button. The menu is rendered in a body
 * PORTAL with fixed positioning + a viewport-bounded max-height, so it can never be
 * clipped or hidden behind the playlists / player panels (which have their own
 * stacking contexts). Selecting a language switches the locale; untranslated ones
 * fall back to English. Layout stays LTR for every language — display only.
 */
export function LanguageSelector({ className = "" }: { className?: string }) {
  const { locale, setLocale } = useLocale();
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const current = localeMeta(locale);

  const openMenu = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setRect({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!btnRef.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onScroll = () => setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  return (
    <div className={`relative ${className}`}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openMenu())}
        aria-label={`Language: ${current.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={current.name}
        className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/[0.06] shadow-sm backdrop-blur transition-colors hover:border-white/35 hover:bg-white/[0.12] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0a84ff]/60"
      >
        <Flag country={current.country} size={22} />
      </button>

      {open && rect
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              dir="ltr"
              style={{
                position: "fixed",
                top: rect.top,
                right: rect.right,
                width: 340,
                maxHeight: `calc(100vh - ${rect.top + 12}px)`,
                zIndex: 100000,
              }}
              className="sb-anim-rise overflow-y-auto overscroll-contain rounded-2xl border border-white/10 bg-[#0d0d12] p-2 shadow-[0_24px_64px_rgba(0,0,0,0.7)]"
            >
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
                {LOCALES.map((l) => {
                  const active = l.code === locale;
                  return (
                    <button
                      key={l.code}
                      type="button"
                      role="menuitemradio"
                      aria-checked={active}
                      onClick={() => {
                        setLocale(l.code);
                        setOpen(false);
                      }}
                      className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors ${
                        active ? "bg-[#0a84ff]/15 text-white" : "text-slate-200 hover:bg-white/[0.06]"
                      }`}
                    >
                      <Flag country={l.country} size={20} />
                      <span className="min-w-0 flex-1 truncate">{l.name}</span>
                      {active ? (
                        <svg className="h-3.5 w-3.5 shrink-0 text-[#0a84ff]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M20 6 9 17l-5-5" />
                        </svg>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
