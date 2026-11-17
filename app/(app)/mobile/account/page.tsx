"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLocale } from "@/lib/locale-context";
import { useTr } from "@/lib/i18n/use-tr";
import { usePeopleAccess } from "@/lib/mobile-people";
import { VmPage } from "@/components/vm/vm-ui";
import { VmCover } from "@/components/vm/vm-parts";
import { IconChevronForward, IconGlobe, IconPeople, IconSignOut } from "@/components/vm/vm-icons";

/** ACCOUNT — who is signed in, the language, People (for an administrator only — the server decides who is one), and signing out. (Business setup — new branches, players, what a role allows — stays on the computer's Control Room.) */
type Me = { email?: string | null; name?: string | null; accountName?: string | null };

export default function MobileAccountPage() {
  const tr = useTr();
  const { locale, setLocale } = useLocale();
  const [me, setMe] = useState<Me | null>(null);
  const [busy, setBusy] = useState(false);
  const canPeople = usePeopleAccess();

  useEffect(() => {
    let off = false;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: Me | null) => { if (!off) setMe(j); })
      .catch(() => undefined);
    return () => { off = true; };
  }, []);

  const name = me?.name || me?.email || "";

  return (
    <VmPage title={tr("Account")}>
      <div className="vm-hero" style={{ paddingTop: 18 }}>
        <VmCover name={name || "VONO"} size={84} radius={999} />
        <div className="vm-hero-title vm-bdi">{name || "…"}</div>
        {me?.name && me?.email ? <div className="vm-hero-sub vm-bdi">{me.email}</div> : null}
        {me?.accountName ? <div className="vm-hero-sub vm-bdi">{me.accountName}</div> : null}
      </div>

      <div className="vm-group">
        <div className="vm-line" style={{ cursor: "default" }}>
          <IconGlobe />
          <span className="vm-line-text">{tr("Language")}</span>
          <span className="vm-chips" style={{ padding: 0, gap: 6 }}>
            <button type="button" className="vm-chip" data-on={locale === "en" ? "" : undefined} onClick={() => setLocale("en")}>English</button>
            <button type="button" className="vm-chip" data-on={locale === "he" ? "" : undefined} onClick={() => setLocale("he")}>עברית</button>
          </span>
        </div>
      </div>

      {canPeople ? (
        <div className="vm-group">
          <Link href="/mobile/people" className="vm-line">
            <IconPeople />
            <span className="vm-line-text">
              {tr("People")}
              <small>{tr("Add people, answer requests, change roles and branches")}</small>
            </span>
            <IconChevronForward className="vm-chev vm-flip" />
          </Link>
        </div>
      ) : null}

      <div className="vm-group">
        <button
          type="button"
          className="vm-line"
          disabled={busy}
          style={{ color: "var(--vm-danger)" }}
          onClick={async () => {
            setBusy(true);
            try {
              await fetch("/api/auth/logout", { method: "POST" });
            } finally {
              window.location.href = "/login";
            }
          }}
        >
          <IconSignOut style={{ color: "var(--vm-danger)" }} />
          <span className="vm-line-text">{tr("Sign out")}</span>
        </button>
      </div>
      <p className="vm-sub" style={{ margin: "18px 24px 0", textAlign: "center", fontSize: 13, color: "var(--vm-text3)" }}>
        {tr("This phone controls your branches. Music plays on each branch's own player.")}
      </p>
    </VmPage>
  );
}
