"use client";

/**
 * "Your VONO ID" (owner 2026-11-22): the person's own `name#1234`, with a copy button. It is assigned the first time it is asked for and never changes. People find you by this EXACT ID,
 * to share playlists with you or to add you to a business (sharing comes next — today the ID is only shown). Styles: `.sb-vid*` in components/control-screen/settings-screen.css.
 */
import { useEffect, useState, type ReactElement } from "react";
import { useTr } from "@/lib/i18n/use-tr";

export function VonoIdCard(): ReactElement {
  const tr = useTr();
  const [handle, setHandle] = useState<string | null | undefined>(undefined); // undefined = loading, null = none
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let off = false;
    fetch("/api/me/vono-id", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { handle?: string | null } | null) => {
        if (!off) setHandle(typeof j?.handle === "string" && j.handle ? j.handle : null);
      })
      .catch(() => {
        if (!off) setHandle(null);
      });
    return () => {
      off = true;
    };
  }, []);

  const copy = async () => {
    if (!handle) return;
    try {
      await navigator.clipboard.writeText(handle);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* the ID is on screen — it can be selected by hand */
    }
  };

  return (
    <div className="sb-vid">
      <div className="sb-vid-row">
        {handle === undefined ? (
          <span className="sb-vid-id sb-vid-id--wait" aria-hidden />
        ) : handle ? (
          <code className="sb-vid-id" dir="ltr">{handle}</code>
        ) : (
          <span className="sb-vid-none">{tr("Your VONO ID is not available right now.")}</span>
        )}
        {handle ? (
          <button type="button" className="sb-vid-copy" onClick={() => void copy()}>
            {copied ? tr("Copied") : tr("Copy")}
          </button>
        ) : null}
      </div>
      <p>{tr("People find you by this exact ID, to share playlists with you or to add you to a business.")}</p>
    </div>
  );
}
