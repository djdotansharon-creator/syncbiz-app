"use client";

import { useState } from "react";
import { useMgmt } from "@/lib/i18n/use-mgmt";

/**
 * CONTROL ROOM — brands (owner). Organization → Brand → Branch. Add / edit a brand: name, code, color. The default
 * Brand holds every branch that was not assigned. No delete / archive in this step. Branches are assigned to a brand
 * in Add / Edit branch.
 */

export type BrandRow = { id: string; name: string; code: string; color: string | null; logoUrl?: string | null; isDefault: boolean; branchCount: number };

/** Distinct colors that read well on the dark map (owner can still pick any color). */
export const BRAND_PALETTE = ["#0a84ff", "#ff375f", "#ff9f0a", "#30d158", "#bf5af2", "#64d2ff", "#ffd60a", "#ff6482", "#5e5ce6", "#ac8e68", "#66d4cf", "#e5e5ea"];
export const DEFAULT_BRAND_COLOR = "#8e8e93";

type Draft = { id: string | null; name: string; code: string; color: string; logoUrl: string | null };

export function BrandManager({ brands, onClose, onChanged }: { brands: BrandRow[]; onClose: () => void; onChanged: () => void }) {
  const L = useMgmt();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startAdd = () => {
    const used = new Set(brands.map((b) => (b.color ?? "").toLowerCase()));
    setDraft({ id: null, name: "", code: "", color: BRAND_PALETTE.find((c) => !used.has(c)) ?? BRAND_PALETTE[0], logoUrl: null });
    setError(null);
  };
  const startEdit = (b: BrandRow) => { setDraft({ id: b.id, name: b.name, code: b.code, color: b.color ?? DEFAULT_BRAND_COLOR, logoUrl: b.logoUrl ?? null }); setError(null); };

  // LOGO (owner 2026-10-15): uploaded / removed immediately for an existing brand (the server checks the real file type)
  const [logoBusy, setLogoBusy] = useState(false);
  const uploadLogo = async (file: File) => {
    if (!draft?.id) return;
    setLogoBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/control-room/brands/${encodeURIComponent(draft.id)}/logo`, { method: "POST", body: fd });
      const d = (await res.json().catch(() => ({}))) as { error?: string; logoUrl?: string };
      if (!res.ok || !d.logoUrl) { setError(d.error ?? L.t("common.saveFailedHttp", { status: res.status })); return; }
      setDraft((cur) => (cur ? { ...cur, logoUrl: d.logoUrl ?? null } : cur));
      onChanged();
    } catch {
      setError(L.t("common.serverRetry"));
    } finally {
      setLogoBusy(false);
    }
  };
  const removeLogo = async () => {
    if (!draft?.id) return;
    setLogoBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/control-room/brands/${encodeURIComponent(draft.id)}/logo`, { method: "DELETE" });
      if (!res.ok) { setError(L.t("common.saveFailedHttp", { status: res.status })); return; }
      setDraft((cur) => (cur ? { ...cur, logoUrl: null } : cur));
      onChanged();
    } catch {
      setError(L.t("common.serverRetry"));
    } finally {
      setLogoBusy(false);
    }
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(draft.id ? `/api/control-room/brands/${encodeURIComponent(draft.id)}` : "/api/control-room/brands", {
        method: draft.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: draft.name, code: draft.code, color: draft.color }),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) { setError(d.error ?? L.t("common.saveFailedHttp", { status: res.status })); return; }
      setDraft(null);
      onChanged();
    } catch {
      setError(L.t("common.serverRetry"));
    } finally {
      setSaving(false);
    }
  };

  const input = "mt-1 w-full rounded-lg border border-[color:var(--sb-border)] bg-white/[0.04] px-3 py-2 text-sm text-[var(--sb-text)] placeholder:text-[var(--sb-text-tertiary)] focus:border-[color:var(--sb-accent)] focus:outline-none";

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-[color:var(--sb-border)] px-6 py-4">
        <div className="flex items-center gap-3">
          <button type="button" onClick={draft ? () => setDraft(null) : onClose} className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--sb-text-secondary)] transition-colors hover:bg-white/[0.06] hover:text-[var(--sb-text)]" aria-label={L.t("common.back")}>
            <svg className="h-4 w-4 rtl:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m15 18-6-6 6-6" /></svg>
          </button>
          <div>
            <h2 className="text-base font-semibold text-[var(--sb-text)]">{L.t(draft ? (draft.id ? "brand.edit" : "brand.add") : "brand.title")}</h2>
            {!draft ? <p className="text-xs text-[var(--sb-text-secondary)]">{L.t("brand.subtitle")}</p> : null}
          </div>
        </div>
        {!draft ? (
          <button type="button" onClick={startAdd} className="rounded-xl border border-[color:var(--sb-border-strong)] px-3.5 py-2 text-sm font-medium text-[var(--sb-text)] hover:bg-white/[0.06]">
            + {L.t("brand.add")}
          </button>
        ) : null}
      </div>

      {draft ? (
        <div className="space-y-4 px-6 py-5">
          <div className="grid grid-cols-[2fr_1fr] gap-3">
            <label className="block">
              <span className="text-xs text-[var(--sb-text-tertiary)]">{L.t("brand.name")}</span>
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={L.t("common.eg", { x: "יש חסד" })} dir="auto" disabled={saving} className={input} />
            </label>
            <label className="block">
              <span className="text-xs text-[var(--sb-text-tertiary)]">{L.t("brand.code")}</span>
              <input value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })} placeholder={L.t("common.eg", { x: "YH" })} dir="ltr" disabled={saving} className={`${input} font-mono`} />
            </label>
          </div>
          <div>
            <span className="text-xs text-[var(--sb-text-tertiary)]">{L.t("brand.color")}</span>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {BRAND_PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setDraft({ ...draft, color: c })}
                  disabled={saving}
                  className={`h-7 w-7 rounded-full transition-transform ${draft.color.toLowerCase() === c ? "scale-110 ring-2 ring-white ring-offset-2 ring-offset-[var(--sb-surface)]" : "hover:scale-105"}`}
                  style={{ background: c }}
                  aria-label={L.t("brand.colorAria", { c })}
                />
              ))}
              <label className="ms-1 inline-flex items-center gap-2 text-xs text-[var(--sb-text-secondary)]">
                <input type="color" value={draft.color} onChange={(e) => setDraft({ ...draft, color: e.target.value })} disabled={saving} className="h-7 w-9 cursor-pointer rounded border border-[color:var(--sb-border)] bg-transparent" />
                {L.t("brand.other")}
              </label>
            </div>
          </div>
          <div>
            <span className="text-xs text-[var(--sb-text-tertiary)]">{L.t("brand.logo")}</span>
            {draft.id ? (
              <div className="mt-2 flex flex-wrap items-center gap-4">
                {draft.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={draft.logoUrl} alt="" className="h-10 w-auto max-w-[160px] object-contain" />
                ) : null}
                <label className={`cursor-pointer text-sm font-medium text-[var(--sb-text)] hover:underline ${logoBusy || saving ? "pointer-events-none opacity-40" : ""}`}>
                  {logoBusy ? L.t("brand.logoUploading") : L.t(draft.logoUrl ? "brand.logoReplace" : "brand.logoUpload")}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    className="sr-only"
                    disabled={logoBusy || saving}
                    onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void uploadLogo(f); }}
                  />
                </label>
                {draft.logoUrl ? (
                  <button type="button" onClick={() => void removeLogo()} disabled={logoBusy || saving} className="text-sm text-[var(--sb-text-secondary)] hover:text-[var(--sb-text)] disabled:opacity-40">{L.t("brand.logoRemove")}</button>
                ) : null}
                <span className="text-xs text-[var(--sb-text-tertiary)]">{L.t("brand.logoHint")}</span>
              </div>
            ) : (
              <p className="mt-1 text-xs text-[var(--sb-text-tertiary)]">{L.t("brand.logoAfterSave")}</p>
            )}
          </div>
          <div className="flex items-center gap-2 text-sm text-[var(--sb-text-secondary)]">
            {L.t("brand.preview")} <BrandBadge name={draft.name || L.t("brand.placeholder")} color={draft.color} logoUrl={draft.logoUrl} />
          </div>
          {error ? <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-200" role="alert">{error}</p> : null}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" onClick={() => setDraft(null)} disabled={saving} className="rounded-full px-4 py-2 text-sm text-[var(--sb-text-secondary)] hover:text-[var(--sb-text)]">{L.t("common.cancel")}</button>
            <button type="button" onClick={() => void save()} disabled={saving || !draft.name.trim() || !draft.code.trim()} className="rounded-full bg-white px-5 py-2 text-sm font-semibold text-black transition-transform active:scale-95 disabled:opacity-40">
              {saving ? L.t("common.saving") : L.t(draft.id ? "common.save" : "brand.add")}
            </button>
          </div>
        </div>
      ) : (
        <ul className="divide-y divide-[color:var(--sb-border)]">
          {brands.map((b) => (
            <li key={b.id} className="flex items-center gap-3 px-6 py-3.5">
              {b.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={b.logoUrl} alt="" aria-hidden className="h-6 w-10 shrink-0 object-contain" />
              ) : (
                <span className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ background: b.color ?? DEFAULT_BRAND_COLOR }} aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-[var(--sb-text)]" dir="auto">{b.name}</div>
                <div className="text-xs text-[var(--sb-text-tertiary)]">
                  <span className="font-mono" dir="ltr">{b.code}</span> · {L.branches(b.branchCount)}{b.isDefault ? ` · ${L.t("brand.defaultNote")}` : ""}
                </div>
              </div>
              <button type="button" onClick={() => startEdit(b)} className="rounded-full border border-[color:var(--sb-border)] px-3 py-1 text-xs text-[var(--sb-text-secondary)] hover:text-[var(--sb-text)]">{L.t("common.edit")}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Small brand label (list / preview) — frameless (owner 2026-10-14, Mac-clean): the brand colour dot + the name. */
export function BrandBadge({ name, color, logoUrl }: { name: string; color: string | null; logoUrl?: string | null }) {
  const c = color ?? DEFAULT_BRAND_COLOR;
  // owner 2026-10-16: a brand WITH a logo shows only the logo (the name = tooltip / accessible name); without → dot + name
  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={logoUrl} alt={name} title={name} className="inline-block h-5 w-auto max-w-[72px] shrink-0 object-contain" />
    );
  }
  return (
    <span className="inline-flex max-w-[12rem] items-center gap-1.5 text-xs font-medium text-[var(--sb-text-secondary)]">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: c }} aria-hidden />
      <span className="truncate" dir="auto">{name}</span>
    </span>
  );
}
