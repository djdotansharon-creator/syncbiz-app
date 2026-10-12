"use client";

import { useEffect, useState } from "react";
import { useMgmt } from "@/lib/i18n/use-mgmt";

/** CONTROL ROOM — the organization's network code (Station ID prefix, e.g. AROMA → AROMA-192). Owner only. */
export function NetworkCode() {
  const L = useMgmt();
  const [prefix, setPrefix] = useState<string | null | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/control-room/network", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { stationIdPrefix?: string | null } | null) => { if (!cancelled) setPrefix(d ? d.stationIdPrefix ?? null : undefined); })
      .catch(() => { /* not an owner / unavailable → hidden */ });
    return () => { cancelled = true; };
  }, []);

  if (prefix === undefined) return null; // not loaded / not an owner

  const save = async () => {
    setSaving(true); setError(null);
    try {
      const res = await fetch("/api/control-room/network", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stationIdPrefix: draft }) });
      const d = (await res.json().catch(() => ({}))) as { stationIdPrefix?: string; error?: string };
      if (!res.ok) { setError(d.error ?? L.t("common.saveFailed")); return; }
      setPrefix(d.stationIdPrefix ?? null);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  if (editing || prefix === null) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-[var(--sb-text-tertiary)]">{L.t("net.label")}</span>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value.toUpperCase())}
          placeholder={L.t("common.eg", { x: "AROMA" })}
          dir="ltr"
          maxLength={12}
          className="w-28 rounded-lg border border-[color:var(--sb-border)] bg-white/[0.04] px-2 py-1 font-mono text-sm text-[var(--sb-text)] focus:border-[color:var(--sb-accent)] focus:outline-none"
        />
        <button type="button" disabled={saving || draft.trim().length < 2} onClick={() => void save()} className="rounded-full bg-white/[0.1] px-3 py-1 text-xs text-[var(--sb-text)] hover:bg-white/[0.16] disabled:opacity-40">
          {L.t("common.save")}
        </button>
        {prefix !== null ? (
          <button type="button" onClick={() => { setEditing(false); setError(null); }} className="text-xs text-[var(--sb-text-tertiary)]">{L.t("common.cancel")}</button>
        ) : null}
        {error ? <span className="text-xs text-amber-200">{error}</span> : null}
      </div>
    );
  }
  return (
    <button type="button" onClick={() => { setDraft(prefix); setEditing(true); }} className="text-xs text-[var(--sb-text-tertiary)] hover:text-[var(--sb-text)]" title={L.t("net.title")}>
      {L.t("net.label")} <span className="font-mono text-[var(--sb-text-secondary)]" dir="ltr">{prefix}</span>
    </button>
  );
}
