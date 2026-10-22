"use client";

import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps, useMapsConfig, type GoogleNS } from "@/lib/google-maps-client";
import { BranchMap } from "@/components/control-room/branch-map";
import { useMgmt } from "@/lib/i18n/use-mgmt";
import { GlassModal, type GlassModalStep } from "@/components/glass-modal";
import { useWizardClosing } from "@/components/control-room/wizard-bits";

/**
 * CONTROL ROOM — add / edit a branch (owner), as a STEP-BY-STEP dialog (owner 2026-10-20: "like we know, with the steps"): Details (logo · name · number) → Brand → Location → Save,
 * the same glass dialog + pager as the Edit playlist wizard. Name, branch number and ONE Location field with Google Places Autocomplete
 * ("בילו סנטר", "ישפרו סנטר נס ציונה", "הרצל 25 תל אביב"). The owner picks a Google suggestion → a preview point on
 * the map → Save sends the Place ID; the server resolves it with Google itself and stores Place ID, formatted address,
 * city and latitude / longitude. Text that was not picked from Google is never saved (no guessed location).
 */

export type BranchFormValues = { name: string; branchNumber: string; currentLocation?: string | null; brandId?: string | null; logoUrl?: string | null };
export type FormBrand = { id: string; name: string; color: string | null; isDefault: boolean };
export type Picked = { placeId: string; label: string; latitude: number; longitude: number };

export function usePlaceAutocomplete(hostRef: React.RefObject<HTMLDivElement | null>, browserKey: string | null, onPick: (p: Picked) => void, onError: () => void) {
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  useEffect(() => {
    if (!browserKey || !hostRef.current) return;
    let cancelled = false;
    let el: HTMLElement | null = null;
    loadGoogleMaps(browserKey)
      .then(async (google: GoogleNS) => {
        const { PlaceAutocompleteElement } = await google.maps.importLibrary("places");
        if (cancelled || !hostRef.current) return;
        el = new PlaceAutocompleteElement({}) as HTMLElement;
        el.style.width = "100%";
        el.style.colorScheme = "dark";
        const handle = async (place: GoogleNS) => {
          if (!place) return;
          await place.fetchFields({ fields: ["id", "formattedAddress", "location", "displayName"] });
          const loc = place.location;
          const lat = typeof loc?.lat === "function" ? loc.lat() : loc?.lat;
          const lng = typeof loc?.lng === "function" ? loc.lng() : loc?.lng;
          if (!place.id || typeof lat !== "number" || typeof lng !== "number") return;
          const name = typeof place.displayName === "string" ? place.displayName : place.displayName?.text;
          const addr = place.formattedAddress ?? "";
          onPickRef.current({ placeId: place.id, label: name && !addr.startsWith(name) ? `${name}, ${addr}` : addr || name || "", latitude: lat, longitude: lng });
        };
        // current API: "gmp-select" with placePrediction; older: "gmp-placeselect" with place
        el.addEventListener("gmp-select", (ev: Event) => { const pp = (ev as unknown as { placePrediction?: GoogleNS }).placePrediction; if (pp) void handle(pp.toPlace()); });
        el.addEventListener("gmp-placeselect", (ev: Event) => { void handle((ev as unknown as { place?: GoogleNS }).place); });
        hostRef.current.appendChild(el);
      })
      .catch(() => { if (!cancelled) onError(); });
    return () => { cancelled = true; el?.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mounted once per key
  }, [browserKey]);
}

export function BranchForm({
  mode,
  branchId,
  initial,
  brands,
  onDone,
  onCancel,
  onLogoChanged,
}: {
  mode: "add" | "edit";
  branchId?: string;
  initial?: Partial<BranchFormValues>;
  /** the organization's brands (null = not loaded / not available → the brand field is hidden and nothing is sent) */
  brands?: FormBrand[] | null;
  onDone: (branchId: string | null) => void;
  onCancel: () => void;
  /** the branch's own logo was uploaded / removed → the list reloads */
  onLogoChanged?: () => void;
}) {
  const L = useMgmt();
  const cfg = useMapsConfig();
  const [step, setStep] = useState(0);
  const { closing, request: requestClose } = useWizardClosing(onCancel);
  const [name, setName] = useState(initial?.name ?? "");
  const [branchNumber, setBranchNumber] = useState(initial?.branchNumber ?? "");
  const [picked, setPicked] = useState<Picked | null>(null);
  const [brandId, setBrandId] = useState<string>(initial?.brandId ?? brands?.find((b) => b.isDefault)?.id ?? brands?.[0]?.id ?? "");
  // brands may arrive after the form opened → pick the branch's brand (edit) or the default (add) once they do
  useEffect(() => {
    if (brandId || !brands?.length) return;
    setBrandId(initial?.brandId ?? brands.find((b) => b.isDefault)?.id ?? brands[0].id);
  }, [brands, brandId, initial?.brandId]);
  // the branch's own logo (edit only — a new branch gets its logo after it is saved)
  const [logo, setLogo] = useState<string | null>(initial?.logoUrl ?? null);
  const [logoBusy, setLogoBusy] = useState(false);
  // ADD mode: the chosen logo waits here and is uploaded right after the branch is created (it needs the new branch id)
  const [pendingLogo, setPendingLogo] = useState<File | null>(null);
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  const pickLogo = (f: File) => {
    if (pendingPreview) URL.revokeObjectURL(pendingPreview);
    setPendingLogo(f);
    setPendingPreview(URL.createObjectURL(f));
  };
  const clearPendingLogo = () => {
    if (pendingPreview) URL.revokeObjectURL(pendingPreview);
    setPendingLogo(null);
    setPendingPreview(null);
  };
  const uploadLogo = async (file: File) => {
    if (!branchId) return;
    setLogoBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/control-room/branches/${encodeURIComponent(branchId)}/logo`, { method: "POST", body: fd });
      const d = (await res.json().catch(() => ({}))) as { error?: string; logoUrl?: string };
      if (!res.ok || !d.logoUrl) { setError(d.error ?? L.t("common.saveFailedHttp", { status: res.status })); return; }
      setLogo(d.logoUrl);
      onLogoChanged?.();
    } catch {
      setError(L.t("common.serverRetry"));
    } finally {
      setLogoBusy(false);
    }
  };
  const removeLogo = async () => {
    if (!branchId) return;
    setLogoBusy(true);
    try {
      const res = await fetch(`/api/control-room/branches/${encodeURIComponent(branchId)}/logo`, { method: "DELETE" });
      if (res.ok) { setLogo(null); onLogoChanged?.(); }
    } finally {
      setLogoBusy(false);
    }
  };
  const [changingLocation, setChangingLocation] = useState(mode === "add" || !initial?.currentLocation);
  const [googleError, setGoogleError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const acHostRef = useRef<HTMLDivElement | null>(null);
  usePlaceAutocomplete(acHostRef, changingLocation ? cfg?.browserKey ?? null : null, (p) => { setPicked(p); setError(null); }, () => setGoogleError(true));

  const locationReady = mode === "edit" ? !changingLocation || !!picked : !!picked;
  const complete = name.trim() && branchNumber.trim() && locationReady;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(mode === "add" ? "/api/control-room/branches" : `/api/control-room/branches/${encodeURIComponent(branchId ?? "")}`, {
        method: mode === "add" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, branchNumber, ...(picked ? { placeId: picked.placeId } : {}), ...(brands?.length && brandId ? { brandId } : {}), language: "he" }),
      });
      const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok) { setError(data.error ?? L.t("common.saveFailedHttp", { status: res.status })); return; }
      if (mode === "add" && data.id && pendingLogo) {
        try {
          const fd = new FormData();
          fd.append("file", pendingLogo);
          await fetch(`/api/control-room/branches/${encodeURIComponent(data.id)}/logo`, { method: "POST", body: fd });
        } catch { /* the branch exists; the logo can be added from Edit */ }
      }
      onDone(mode === "add" ? data.id ?? null : branchId ?? null);
    } catch {
      setError(L.t("common.serverRetry"));
    } finally {
      setSaving(false);
    }
  };

  const googleReady = !!cfg?.browserKey && !googleError;
  const shownLogo = mode === "edit" ? logo : pendingPreview;
  const missing = [!name.trim() ? L.t("form.name") : "", !branchNumber.trim() ? L.t("form.number") : "", !locationReady ? L.t("form.location") : ""].filter(Boolean);

  const steps: GlassModalStep[] = [
    { key: "details", label: L.t("wz.details") },
    ...(brands && brands.length > 0 ? [{ key: "brand", label: L.t("form.brand") }] : []),
    { key: "location", label: L.t("form.location") },
  ];
  const at = Math.min(step, steps.length - 1);
  const cur = steps[at]!.key;
  const last = at === steps.length - 1;
  const stepOk = cur === "details" ? !!name.trim() && !!branchNumber.trim() : true;
  const advance = () => { if (!last) { if (stepOk) setStep(at + 1); } else if (complete && !saving) void save(); };

  return (
    <GlassModal
      title={L.t(mode === "add" ? "form.add" : "form.edit")}
      subtitle={name.trim() || null}
      cover={shownLogo}
      showInitial
      steps={steps}
      step={at}
      onStep={(i) => { if (i <= at || stepOk) setStep(i); }}
      width={600}
      closing={closing}
      closeOnBackdrop={false}
      onClose={requestClose}
      footer={
        <>
          <button type="button" className="sb-wz-btn" onClick={requestClose} disabled={saving}>{L.t("common.cancel")}</button>
          <span className="sb-wz-spacer" />
          {at > 0 ? <button type="button" className="sb-wz-btn" onClick={() => setStep(at - 1)} disabled={saving}>{L.t("common.back")}</button> : null}
          {!last ? (
            <button type="button" className="sb-wz-btn sb-wz-btn--primary" onClick={advance} disabled={!stepOk}>{L.t("wz.next")}</button>
          ) : (
            <button type="button" className="sb-wz-btn sb-wz-btn--primary" onClick={() => void save()} disabled={!complete || saving}>{saving ? L.t("common.saving") : L.t(mode === "add" ? "form.add" : "common.save")}</button>
          )}
        </>
      }
    >
      <form onSubmit={(e) => { e.preventDefault(); advance(); }}>
        {cur === "details" ? (
          <div className="flex items-start gap-5">
            <div className="flex shrink-0 flex-col items-center gap-1.5">
              <label className={`cr-logo-pick ${logoBusy || saving ? "pointer-events-none opacity-50" : ""}`} title={L.t(shownLogo ? "brand.logoReplace" : "brand.logoUpload")}>
                {shownLogo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={shownLogo} alt="" draggable={false} />
                ) : (
                  <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="9" cy="9" r="1.6" /><path d="m21 15-4.6-4.6a1.5 1.5 0 0 0-2.1 0L5 19.7" /></svg>
                )}
                <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="sr-only" disabled={logoBusy || saving} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (!f) return; if (mode === "edit") void uploadLogo(f); else pickLogo(f); }} />
              </label>
              {shownLogo ? (
                <button type="button" onClick={() => (mode === "edit" ? void removeLogo() : clearPendingLogo())} disabled={logoBusy || saving} className="text-xs text-[var(--sb-text-tertiary)] hover:text-[var(--sb-text)] disabled:opacity-40">{L.t("brand.logoRemove")}</button>
              ) : (
                <span className="text-xs text-[var(--sb-text-tertiary)]">{logoBusy ? L.t("brand.logoUploading") : L.t("form.logo")}</span>
              )}
            </div>
            <div className="sb-wz-stack min-w-0 flex-1">
              <div className="sb-wz-field">
                <label className="sb-wz-label">{L.t("form.name")}</label>
                <input className="sb-wz-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={L.t("common.eg", { x: "Universe Club Ashdod" })} dir="auto" disabled={saving} autoFocus={mode === "add"} />
              </div>
              <div className="sb-wz-field">
                <label className="sb-wz-label">{L.t("form.number")}</label>
                <input className="sb-wz-input" value={branchNumber} onChange={(e) => setBranchNumber(e.target.value)} placeholder={L.t("common.eg", { x: "192" })} dir="ltr" disabled={saving} style={{ maxWidth: 200 }} />
              </div>
            </div>
          </div>
        ) : null}

        {cur === "brand" && brands ? (
          <div className="sb-wz-field">
            <label className="sb-wz-label">{L.t("form.brand")}</label>
            <div className="sb-wz-chips" role="radiogroup" aria-label={L.t("form.brand")}>
              {brands.map((b) => (
                <button key={b.id} type="button" role="radio" aria-checked={brandId === b.id} disabled={saving} onClick={() => setBrandId(b.id)} className={`sb-wz-chip${brandId === b.id ? " is-on" : ""}`}>
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: b.color ?? "#8e8e93" }} aria-hidden />
                  <span dir="auto">{b.name}{b.isDefault ? ` ${L.t("form.defaultBrand")}` : ""}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {cur === "location" ? (
          <div className="sb-wz-stack">
            <div className="sb-wz-field">
              <label className="sb-wz-label">{L.t("form.location")}</label>
              {!changingLocation ? (
                <div className="flex items-center justify-between gap-3 rounded-2xl bg-white/[0.06] px-4 py-3">
                  <span className="text-base text-[var(--sb-text)]" dir="auto">{initial?.currentLocation}</span>
                  <button type="button" onClick={() => setChangingLocation(true)} className="shrink-0 text-sm font-medium text-[var(--sb-text-secondary)] hover:text-[var(--sb-text)]">{L.t("common.change")}</button>
                </div>
              ) : !googleReady ? (
                <p className="cr-note">
                  <span className="cr-note-dot" aria-hidden />
                  {cfg === null ? L.t("form.loadingSearch") : L.t("form.googleMissing")}
                </p>
              ) : (
                <>
                  <div ref={acHostRef} />
                  <p className="sb-wz-hint">{L.t("form.locationHint")}</p>
                </>
              )}
            </div>
            {picked ? (
              <div className="space-y-2">
                <p className="text-sm text-[var(--sb-text)]" dir="auto">📍 {picked.label}</p>
                <div className="overflow-hidden rounded-3xl bg-black/20">
                  <BranchMap
                    branches={[{ id: "preview", name: name || L.t("form.newBranch"), city: "", status: "idle", latitude: picked.latitude, longitude: picked.longitude }]}
                    selectedId="preview"
                    onSelect={() => {}}
                    height={190}
                    fit="branches"
                  />
                </div>
              </div>
            ) : null}
            {missing.length ? <p className="sb-wz-hint">{`${L.t("form.missing")} ${missing.join(" · ")}`}</p> : null}
          </div>
        ) : null}

        {error ? <p className="sb-wz-error" role="alert">{error}</p> : null}
      </form>
    </GlassModal>
  );
}
