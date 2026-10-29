"use client";

/**
 * CONTROL SCREEN bar (owner 2026-10-29): the Control Room, Dashboard, Permissions, Display screen and Settings are ONE separate screen — plain black, a single row of buttons
 * (icon + one word, no frames) — NOT part of the player. The button in the corner (the start edge: right in Hebrew, left in English) goes to the live player and back, with NO code.
 * UI only: this bar is drawn by the app shell above the unchanged pages; the player and every provider stay mounted (the same JSX tree), so playback is never touched.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useMgmt } from "@/lib/i18n/use-mgmt";
import { useTr } from "@/lib/i18n/use-tr";
import "./control-screen.css";

type Item = { href: string; label: string; icon: React.ReactNode };

const ico = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

export function ControlRoomIcon({ size = 22 }: { size?: number }) {
  return (
    <svg {...ico} width={size} height={size}>
      <circle cx="6" cy="7" r="2.4" />
      <circle cx="18" cy="7" r="2.4" />
      <circle cx="12" cy="18" r="2.4" />
      <path d="M8.2 8.1l2.6 7.6M15.8 8.1l-2.6 7.6M8.5 7h7" />
    </svg>
  );
}

function DashboardIcon() {
  return (
    <svg {...ico}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.8" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.8" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.8" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.8" />
    </svg>
  );
}

function PeopleIcon() {
  return (
    <svg {...ico}>
      <circle cx="9" cy="8.2" r="3.1" />
      <path d="M3.2 19.5c.4-3.3 2.8-5.2 5.8-5.2s5.4 1.9 5.8 5.2" />
      <circle cx="17" cy="9.2" r="2.4" />
      <path d="M16.6 14.5c2.4.1 4.2 1.7 4.5 4.3" />
    </svg>
  );
}

function DisplayIcon() {
  return (
    <svg {...ico}>
      <rect x="3" y="4.5" width="18" height="12" rx="2" />
      <path d="M8.5 20h7M12 16.5V20" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg {...ico}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/** The live player (a play triangle in a ring) — the corner button of the control screen. */
export function PlayerIcon({ size = 22 }: { size?: number }) {
  return (
    <svg {...ico} width={size} height={size}>
      <circle cx="12" cy="12" r="9.2" />
      <path d="M10 8.4l5.6 3.6-5.6 3.6z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function ControlBar({ canManage = true }: { canManage?: boolean }) {
  const L = useMgmt();
  const tr = useTr();
  const pathname = usePathname() ?? "";
  // the clicked button lights up on the click itself (the page loads behind it); the real path takes over when the route changes
  const [pending, setPending] = useState<{ href: string; from: string } | null>(null);
  if (pending && pending.from !== pathname) setPending(null);
  const current = pending && pending.from === pathname ? pending.href : pathname;

  const all: Item[] = [
    { href: "/owner/control-room", label: L.t("nav.controlRoom"), icon: <ControlRoomIcon /> },
    { href: "/dashboard", label: L.t("nav.dashboard"), icon: <DashboardIcon /> },
    { href: "/access-control", label: L.t("nav.accessControl"), icon: <PeopleIcon /> },
    { href: "/access-control/display", label: L.t("nav.display"), icon: <DisplayIcon /> },
    { href: "/settings", label: tr("Settings"), icon: <SettingsIcon /> },
  ];
  // the manager pages bounce a branch employee back to the player — so they are not offered (Settings is for everyone)
  const items = canManage ? all : all.filter((it) => it.href === "/settings");

  return (
    <div className="sb-ctl-bar" dir={L.dir} role="banner">
      {/* the corner button: to the live player and back — no code */}
      <Link href="/sources" prefetch className="sb-ctl-corner" title={tr("Player")} aria-label={tr("Player")}>
        <PlayerIcon />
        <span>{tr("Player")}</span>
      </Link>
      <nav className="sb-ctl-nav" aria-label={L.t("nav.aria")}>
        {items.map((it) => {
          const active = current === it.href || (current.startsWith(it.href + "/") && !items.some((o) => o !== it && o.href.startsWith(it.href + "/") && (current === o.href || current.startsWith(o.href + "/"))));
          return (
            <Link key={it.href} href={it.href} prefetch aria-current={active ? "page" : undefined} className={`sb-ctl-btn${active ? " is-active" : ""}`} onClick={() => setPending({ href: it.href, from: pathname })}>
              {it.icon}
              <span>{it.label}</span>
            </Link>
          );
        })}
      </nav>
      <span className="sb-ctl-balance" aria-hidden />
    </div>
  );
}
