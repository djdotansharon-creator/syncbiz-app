"use client";

import { useMemo, useState } from "react";
import { useMgmt } from "@/lib/i18n/use-mgmt";
import { GlassModal, type GlassModalStep } from "@/components/glass-modal";
import { useWizardClosing } from "@/components/control-room/wizard-bits";
import { BrandCreateFlow } from "@/components/control-room/brand-create-flow";
import { ConfirmDelete, deleteRefusalText, type DeleteRefusal } from "@/components/control-room/confirm-delete";

/**
 * CONTROL ROOM — brands (owner). Add / edit a brand is a STEP-BY-STEP dialog (Name → Logo → Colour; owner 2026-10-20), the list stays on the page behind it. Organization → Brand → Branch. Add / edit a brand: name, code, color. The default
 * Brand holds every branch that was not assigned. A brand can be DELETED from its edit dialog (owner 2026-10-22; archived on the server, refused while branches still belong to it). Branches are assigned to a brand
 * in Add / Edit branch.
 */

export type BrandRow = { id: string; name: string; code: string; color: string | null; logoUrl?: string | null; isDefault: boolean; branchCount: number };

/** Distinct colors that read well on the dark map (owner can still pick any color). */
export const BRAND_PALETTE = ["#0a84ff", "#ff375f", "#ff9f0a", "#30d158", "#bf5af2", "#64d2ff", "#ffd60a", "#ff6482", "#5e5ce6", "#ac8e68", "#66d4cf", "#e5e5ea"];
export const DEFAULT_BRAND_COLOR = "#8e8e93";

type Draft = { id: string | null; name: string; code: string; color: string; logoUrl: string | null };

export function BrandManager({ brands, onClose, onChanged, startNew = false }: { brands: BrandRow[]; onClose: () => void; onChanged: () => void; /** open straight in the "new brand" form (the "+ Add brand" chip) */ startNew?: boolean }) {
  const L = useMgmt();
  // a NEW brand is created in the full-screen writing flow (brand-create-flow.tsx — owner 2026-10-21); EDITING a brand keeps the glass wizard below (`draft`)
  const [creating, setCreating] = useState(startNew);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const { closing, request: requestClose } = useWizardClosing(() => { setDraft(null); setPendingLogo(null); setError(null); setStep(0); });

  const startAdd = () => { setDraft(null); setError(null); setStep(0); setCreating(true); };
  const startEdit = (b: BrandRow) => { setDraft({ id: b.id, name: b.name, code: b.code, color: b.color ?? DEFAULT_BRAND_COLOR, logoUrl: b.logoUrl ?? null }); setError(null); setStep(0); };

  // LOGO (owner 2026-10-15): uploaded / removed immediately for an existing brand (the server checks the real file type)
  const [logoBusy, setLogoBusy] = useState(false);
  // a NEW brand: the chosen logo waits here and is uploaded right after the brand is created
  const [pendingLogo, setPendingLogo] = useState<File | null>(null);
  const pendingPreview = useMemo(() => (pendingLogo ? URL.createObjectURL(pendingLogo) : null), [pendingLogo]);
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
      const d = (await res.json().catch(() => ({}))) as { error?: string; id?: string };
      if (!res.ok) { setError(d.error ?? L.t("common.saveFailedHttp", { status: res.status })); return; }
      if (!draft.id && d.id && pendingLogo) {
        try {
          const fd = new FormData();
          fd.append("file", pendingLogo);
          await fetch(`/api/control-room/brands/${encodeURIComponent(d.id)}/logo`, { method: "POST", body: fd });
        } catch { /* the brand exists; the logo can be added from Edit */ }
      }
      setPendingLogo(null);
      setDraft(null);
      onChanged();
    } catch {
      setError(L.t("common.serverRetry"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-[color:var(--sb-border)] px-6 py-4">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onClose} className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--sb-text-secondary)] transition-colors hover:bg-white/[0.06] hover:text-[var(--sb-text)]" aria-label={L.t("common.back")}>
            <svg className="h-4 w-4 rtl:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m15 18-6-6 6-6" /></svg>
          </button>
          <div>
            <h2 className="text-base font-semibold text-[var(--sb-text)]">{L.t("brand.title")}</h2>
            <p className="text-xs text-[var(--sb-text-secondary)]">{L.t("brand.subtitle")}</p>
          </div>
        </div>
          <button type="button" onClick={startAdd} className="rounded-xl border border-[color:var(--sb-border-strong)] px-3.5 py-2 text-sm font-medium text-[var(--sb-text)] hover:bg-white/[0.06]">
            + {L.t("brand.add")}
          </button>

      </div>

      <ul className="divide-y divide-[color:var(--sb-border)]">
          {brands.map((b) => (
            <li key={b.id} className="flex items-center gap-3 px-6 py-3.5">
              <span className={`cr-chip-logo ${b.logoUrl ? "has-logo" : ""}`} style={{ ["--cr-brand" as string]: b.color ?? DEFAULT_BRAND_COLOR, width: 40, height: 40, borderRadius: 13 } as React.CSSProperties} aria-hidden>
                {b.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={b.logoUrl} alt="" draggable={false} />
                ) : (
                  <span>{(b.name.trim().split(/\s+/).pop() ?? "").charAt(0).toUpperCase()}</span>
                )}
              </span>
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

      {/* a NEW brand: the full-screen writing flow; when it was opened straight from the "+" of the brand strip, finishing / cancelling it closes the whole brands screen too */}
      {creating ? (
        <BrandCreateFlow
          brands={brands}
          palette={BRAND_PALETTE}
          onChanged={onChanged}
          onClose={() => { setCreating(false); if (startNew) onClose(); }}
        />
      ) : null}

      {/* add / edit a brand: a step-by-step dialog (Name → Logo → Colour) */}
      {draft ? (() => {
        const steps: GlassModalStep[] = [
          { key: "name", label: L.t("brand.name") },
          { key: "logo", label: L.t("brand.logo") },
          { key: "color", label: L.t("brand.color") },
        ];
        const at = Math.min(step, steps.length - 1);
        const cur = steps[at]!.key;
        const last = at === steps.length - 1;
        const stepOk = cur === "name" ? !!draft.name.trim() && !!draft.code.trim() : true;
        const advance = () => { if (!last) { if (stepOk) setStep(at + 1); } else if (draft.name.trim() && draft.code.trim() && !saving) void save(); };
        const shownLogo = draft.id ? draft.logoUrl : pendingPreview;
        return (
          <GlassModal
            title={L.t(draft.id ? "brand.edit" : "brand.add")}
            subtitle={draft.name.trim() || null}
            cover={shownLogo}
            showInitial
            steps={steps}
            step={at}
            onStep={(i) => { if (i <= at || stepOk) setStep(i); }}
            width={560}
            closing={closing}
            closeOnBackdrop={false}
            onClose={requestClose}
            footer={
              <>
                <button type="button" className="sb-wz-btn" onClick={requestClose} disabled={saving}>{L.t("common.cancel")}</button>
                {draft.id && !brands.find((b) => b.id === draft.id)?.isDefault ? (
                  <button type="button" className="sb-wz-btn cr-del-link" onClick={() => setConfirmDelete(true)} disabled={saving}>{L.t("common.delete")}</button>
                ) : null}
                <span className="sb-wz-spacer" />
                {at > 0 ? <button type="button" className="sb-wz-btn" onClick={() => setStep(at - 1)} disabled={saving}>{L.t("common.back")}</button> : null}
                {!last ? (
                  <button type="button" className="sb-wz-btn sb-wz-btn--primary" onClick={advance} disabled={!stepOk}>{L.t("wz.next")}</button>
                ) : (
                  <button type="button" className="sb-wz-btn sb-wz-btn--primary" onClick={() => void save()} disabled={saving || !draft.name.trim() || !draft.code.trim()}>{saving ? L.t("common.saving") : L.t(draft.id ? "common.save" : "brand.add")}</button>
                )}
              </>
            }
          >
            <form onSubmit={(e) => { e.preventDefault(); advance(); }}>
              {cur === "name" ? (
                <div className="sb-wz-grid2">
                  <div className="sb-wz-field sb-wz-span2">
                    <label className="sb-wz-label">{L.t("brand.name")}</label>
                    <input className="sb-wz-input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={L.t("common.eg", { x: "יש חסד" })} dir="auto" disabled={saving} autoFocus />
                  </div>
                  <div className="sb-wz-field">
                    <label className="sb-wz-label">{L.t("brand.code")}</label>
                    <input className="sb-wz-input font-mono" value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })} placeholder={L.t("common.eg", { x: "YH" })} dir="ltr" disabled={saving} />
                  </div>
                </div>
              ) : null}

              {cur === "logo" ? (
                <div className="flex flex-col items-center gap-3 py-2 text-center">
                  <span className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-3xl bg-white/[0.94]">
                    {shownLogo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={shownLogo} alt="" className="h-full w-full object-contain p-3" />
                    ) : (
                      <svg className="h-8 w-8 text-black/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="3" y="3" width="18" height="18" rx="4" /><circle cx="9" cy="9" r="1.6" /><path d="m21 15-4.6-4.6a1.5 1.5 0 0 0-2.1 0L5 19.7" /></svg>
                    )}
                  </span>
                  <div className="flex flex-wrap items-center justify-center gap-3">
                    <label className={`sb-wz-btn cursor-pointer ${logoBusy || saving ? "pointer-events-none opacity-40" : ""}`}>
                      {logoBusy ? L.t("brand.logoUploading") : L.t(shownLogo ? "brand.logoReplace" : "brand.logoUpload")}
                      <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="sr-only" disabled={logoBusy || saving} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (!f) return; if (draft.id) void uploadLogo(f); else setPendingLogo(f); }} />
                    </label>
                    {shownLogo ? <button type="button" onClick={() => (draft.id ? void removeLogo() : setPendingLogo(null))} disabled={logoBusy || saving} className="text-sm text-[var(--sb-text-secondary)] hover:text-[var(--sb-text)] disabled:opacity-40">{L.t("brand.logoRemove")}</button> : null}
                  </div>
                  <p className="sb-wz-hint">{L.t("brand.logoHint")}</p>
                </div>
              ) : null}

              {cur === "color" ? (
                <div className="sb-wz-stack">
                  <div className="sb-wz-field">
                    <label className="sb-wz-label">{L.t("brand.color")}</label>
                    <div className="flex flex-wrap items-center gap-2.5">
                      {BRAND_PALETTE.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setDraft({ ...draft, color: c })}
                          disabled={saving}
                          className={`h-8 w-8 rounded-full transition-transform ${draft.color.toLowerCase() === c ? "scale-110 ring-2 ring-white ring-offset-2 ring-offset-[#1c1c20]" : "hover:scale-105"}`}
                          style={{ background: c }}
                          aria-label={L.t("brand.colorAria", { c })}
                        />
                      ))}
                      <label className="ms-1 inline-flex items-center gap-2 text-xs text-[var(--sb-text-secondary)]">
                        <input type="color" value={draft.color} onChange={(e) => setDraft({ ...draft, color: e.target.value })} disabled={saving} className="h-8 w-10 cursor-pointer rounded border border-white/15 bg-transparent" />
                        {L.t("brand.other")}
                      </label>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-[var(--sb-text-secondary)]">
                    {L.t("brand.preview")} <BrandBadge name={draft.name || L.t("brand.placeholder")} color={draft.color} logoUrl={draft.logoUrl ?? pendingPreview} />
                  </div>
                </div>
              ) : null}

              {error ? <p className="sb-wz-error" role="alert">{error}</p> : null}
            </form>
          </GlassModal>
        );
      })() : null}

      {/* delete this brand (owner 2026-10-22): asks first; refused while branches still belong to it */}
      {confirmDelete && draft?.id ? (
        <ConfirmDelete
          kind="brand"
          name={draft.name}
          onClose={() => setConfirmDelete(false)}
          onConfirm={async () => {
            try {
              const res = await fetch(`/api/control-room/brands/${encodeURIComponent(draft.id!)}`, { method: "DELETE" });
              if (!res.ok) return deleteRefusalText(L, (await res.json().catch(() => ({}))) as DeleteRefusal);
            } catch {
              return L.t("common.serverRetry");
            }
            setConfirmDelete(false);
            setDraft(null);
            setPendingLogo(null);
            setStep(0);
            onChanged();
            return null;
          }}
        />
      ) : null}
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
