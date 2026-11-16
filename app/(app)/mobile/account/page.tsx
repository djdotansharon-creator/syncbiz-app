"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/lib/locale-context";
import { useTr } from "@/lib/i18n/use-tr";
import { VmPage } from "@/components/vm/vm-ui";
import { VmCover } from "@/components/vm/vm-parts";
import { IconGlobe, IconSignOut } from "@/components/vm/vm-icons";

/** ACCOUNT — who is signed in, the language, and signing out. (Business setup — branches, people, players — stays on the computer's Control Room.) */
type Me = { email?: string | null; name?: string | null; accountName?: string | null };

export default function MobileAccountPage() {
  const tr = useTr();
  const { locale, setLocale } = useLocale();
  const [me, setMe] = useState<Me | null>(null);
  const [busy, setBusy] = useState(false);

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
