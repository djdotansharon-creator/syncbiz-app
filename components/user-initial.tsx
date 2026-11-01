"use client";

/**
 * UserInitial — who is signed in (owner 2026-11-01: "before there is a Player or a Remote there is a user"): the first letter of the person's name on a soft white disc with a faint grey tint, at the END-most
 * corner of the top bar (right in English, left in Hebrew — the bar mirrors). Display only: no hover, no tooltip (the site has none), no click, and it changes nothing — no playback, no socket. The name comes from
 * `/api/auth/me` (the name, else the e-mail), fetched ONCE per page and shared by every bar that shows the disc. Styles: components/user-initial.css.
 */

import { useEffect, useState, type ReactElement } from "react";
import { initialOf } from "@/lib/initial-of";
import "@/components/user-initial.css";

let sharedName: { at: number; value: Promise<string | null> } | null = null;
const SHARE_MS = 60_000;
function fetchSessionName(): Promise<string | null> {
  if (sharedName && Date.now() - sharedName.at < SHARE_MS) return sharedName.value;
  const value = fetch("/api/auth/me", { credentials: "include", cache: "no-store" })
    .then((r) => r.json())
    .then((d: { name?: string | null; email?: string | null } | null) => (d?.name ?? "").trim() || (d?.email ?? "").trim() || null)
    .catch(() => null);
  sharedName = { at: Date.now(), value };
  return value;
}

export function UserInitial({ name, className = "" }: { name: string | null | undefined; className?: string }): ReactElement | null {
  const letter = initialOf(name);
  if (!letter) return null;
  return <span className={`sb-user-initial ${className}`.trim()} role="img" aria-label={(name ?? "").trim()}>{letter}</span>;
}

/** the disc with the signed-in person's own letter (nothing while the name is not known yet, or when there is none) */
export function SessionInitial({ className = "" }: { className?: string }): ReactElement | null {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    let off = false;
    void fetchSessionName().then((n) => { if (!off) setName(n); });
    return () => { off = true; };
  }, []);
  return <UserInitial name={name} className={className} />;
}
