"use client";

/**
 * MANAGEMENT TABS (owner 2026-10-19): the Control Room is ONE tab of the main top bar (no separate management bar, no "Back to Player" button —
 * "Library" in the main bar is the way back). Inside the management pages this small pill group switches between Control Room · Dashboard · Access Control.
 * It sits at the SAME place (start edge, top) on all three pages, switches to the clicked tab AT ONCE (optimistic — the page loads behind it) and, on the
 * desktop app, a quiet Lock button sits beside it.
 */
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { useMgmt } from "@/lib/i18n/use-mgmt";

export function ManagementTabs() {
  const L = useMgmt();
  const pathname = usePathname() ?? "";
  const router = useRouter();
  // the clicked tab becomes active on the click itself; the real path takes over when the route changes (previous-render pattern)
  const [pending, setPending] = useState<{ href: string; from: string } | null>(null);
  if (pending && pending.from !== pathname) setPending(null);
  const current = pending && pending.from === pathname ? pending.href : pathname;
  const desktop = useSyncExternalStore(
    () => () => {},
    () => /\bElectron\//.test(navigator.userAgent),
    () => false,
  );
  const items = [
    { href: "/owner/control-room", label: L.t("nav.controlRoom") },
    { href: "/dashboard", label: L.t("nav.dashboard") },
    { href: "/access-control", label: L.t("nav.accessControl") },
    { href: "/access-control/display", label: L.t("nav.display") },
  ];
  return (
    <div className="cr-tabs-row" dir={L.dir}>
      <nav className="cr-tabs flex items-center" aria-label={L.t("nav.aria")}>
        {items.map((it) => {
          const active = current === it.href || (current.startsWith(it.href + "/") && !items.some((o) => o !== it && o.href.startsWith(it.href + "/") && (current === o.href || current.startsWith(o.href + "/"))));
          return (
            <Link key={it.href} href={it.href} prefetch aria-current={active ? "page" : undefined} className={`cr-tab ${active ? "is-active" : ""}`} onClick={() => setPending({ href: it.href, from: pathname })}>
              {it.label}
            </Link>
          );
        })}
      </nav>
      {desktop ? (
        <button
          type="button"
          title="Lock management on this station"
          onClick={() => {
            void fetch("/api/auth/management-unlock", { method: "DELETE", credentials: "include" })
              .catch(() => {})
              .finally(() => router.push("/sources"));
          }}
          className="cr-tab inline-flex items-center gap-1.5"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
          Lock
        </button>
      ) : null}
    </div>
  );
}
