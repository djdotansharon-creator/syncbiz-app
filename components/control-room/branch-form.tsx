"use client";

import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps, useMapsConfig, type GoogleNS } from "@/lib/google-maps-client";
import { BranchMap } from "@/components/control-room/branch-map";
import { useMgmt } from "@/lib/i18n/use-mgmt";

/**
 * CONTROL ROOM — add / edit a branch (owner). Name, branch number and ONE Location field with Google Places Autocomplete
 * ("בילו סנטר", "ישפרו סנטר נס ציונה", "הרצל 25 תל אביב"). The owner picks a Google suggestion → a preview point on
 * the map → Save sends the Place ID; the server resolves it with Google itself and stores Place ID, formatted address,
 * city and latitude / longitude. Text that was not picked from Google is never saved (no guessed location).
 */

export type BranchFormValues = { name: string; branchNumber: string; currentLocation?: string | null; brandId?: string | null };
export type FormBrand = { id: string; name: string; color: string | null; isDefault: boolean };
type Picked = { placeId: string; label: string; latitude: number; longitude: number };

function usePlaceAutocomplete(hostRef: React.RefObject<HTMLDivElement | null>, browserKey: string | null, onPick: (p: Picked) => void, onError: () => void) {
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
}: {
  mode: "add" | "edit";
  branchId?: string;
  initial?: Partial<BranchFormValues>;
  /** the organization's brands (null = not loaded / not available → the brand field is hidden and nothing is sent) */
  brands?: FormBrand[] | null;
  onDone: (branchId: string | null) => void;
  onCancel: () => void;
}) {
  const L = useMgmt();
  const cfg = useMapsConfig();
  const [name, setName] = useState(initial?.name ?? "");
  const [branchNumber, setBranchNumber] = useState(initial?.branchNumber ?? "");
  const [picked, setPicked] = useState<Picked | null>(null);
  const [brandId, setBrandId] = useState<string>(initial?.brandId ?? brands?.find((b) => b.isDefault)?.id ?? brands?.[0]?.id ?? "");
  // brands may arrive after the form opened → pick the branch's brand (edit) or the default (add) once they do
  useEffect(() => {
    if (brandId || !brands?.length) return;
    setBrandId(initial?.brandId ?? brands.find((b) => b.isDefault)?.id ?? brands[0].id);
  }, [brands, brandId, initial?.brandId]);
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
      onDone(mode === "add" ? data.id ?? null : branchId ?? null);
    } catch {
      setError(L.t("common.serverRetry"));
    } finally {
      setSaving(false);
    }
  };

  const input = "mt-1 w-full rounded-lg border border-[color:var(--sb-border)] bg-white/[0.04] px-3 py-2 text-sm text-[var(--sb-text)] placeholder:text-[var(--sb-text-tertiary)] focus:border-[color:var(--sb-accent)] focus:outline-none";
  const googleReady = !!cfg?.browserKey && !googleError;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-[color:var(--sb-border)] px-6 py-4">
        <button type="button" onClick={onCancel} className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--sb-text-secondary)] transition-colors hover:bg-white/[0.06] hover:text-[var(--sb-text)]" aria-label={L.t("common.cancel")}>
          <svg className="h-4 w-4 rtl:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m15 18-6-6 6-6" /></svg>
        </button>
        <h2 className="text-base font-semibold text-[var(--sb-text)]">{L.t(mode === "add" ? "form.add" : "form.edit")}</h2>
      </div>

      <div className="space-y-4 px-6 py-5">
        <div className="grid grid-cols-[2fr_1fr] gap-3">
          <label className="block">
            <span className="text-xs text-[var(--sb-text-tertiary)]">{L.t("form.name")}</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={L.t("common.eg", { x: "Universe Club Ashdod" })} dir="auto" disabled={saving} className={input} />
          </label>
          <label className="block">
            <span className="text-xs text-[var(--sb-text-tertiary)]">{L.t("form.number")}</span>
            <input value={branchNumber} onChange={(e) => setBranchNumber(e.target.value)} placeholder={L.t("common.eg", { x: "192" })} dir="ltr" disabled={saving} className={input} />
          </label>
        </div>

        {brands && brands.length > 0 ? (
          <label className="block">
            <span className="text-xs text-[var(--sb-text-tertiary)]">{L.t("form.brand")}</span>
            <div className="mt-1 flex items-center gap-2">
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: brands.find((b) => b.id === brandId)?.color ?? "#8e8e93" }} aria-hidden />
              <select value={brandId} onChange={(e) => setBrandId(e.target.value)} disabled={saving} className={`${input} mt-0`} style={{ colorScheme: "dark" }}>
                {brands.map((b) => <option key={b.id} value={b.id} className="bg-[#1c1c1e] text-white">{b.name}{b.isDefault ? ` ${L.t("form.defaultBrand")}` : ""}</option>)}
              </select>
            </div>
          </label>
        ) : null}

        <div>
          <span className="text-xs text-[var(--sb-text-tertiary)]">{L.t("form.location")}</span>
          {!changingLocation ? (
            <div className="mt-1 flex items-center justify-between gap-3 rounded-lg border border-[color:var(--sb-border)] bg-white/[0.02] px-3 py-2">
              <span className="truncate text-sm text-[var(--sb-text)]" dir="auto">{initial?.currentLocation}</span>
              <button type="button" onClick={() => setChangingLocation(true)} className="shrink-0 text-xs text-[var(--sb-accent)] hover:underline">{L.t("common.change")}</button>
            </div>
          ) : !googleReady ? (
            <p className="mt-1 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-200">
              {cfg === null ? L.t("form.loadingSearch") : L.t("form.googleMissing")}
            </p>
          ) : (
            <>
              <div ref={acHostRef} className="mt-1" />
              <p className="mt-1 text-xs text-[var(--sb-text-tertiary)]">{L.t("form.locationHint")}</p>
            </>
          )}
        </div>

        {picked ? (
          <div className="space-y-2">
            <p className="text-sm text-[var(--sb-text)]" dir="auto">📍 {picked.label}</p>
            <BranchMap
              branches={[{ id: "preview", name: name || L.t("form.newBranch"), city: "", status: "idle", latitude: picked.latitude, longitude: picked.longitude }]}
              selectedId="preview"
              onSelect={() => {}}
              height={200}
              fit="branches"
            />
          </div>
        ) : null}

        {error ? <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-200" role="alert">{error}</p> : null}
      </div>

      <div className="mt-auto flex items-center justify-end gap-3 border-t border-[color:var(--sb-border)] px-6 py-4">
        <button type="button" onClick={onCancel} disabled={saving} className="rounded-full px-4 py-2 text-sm text-[var(--sb-text-secondary)] hover:text-[var(--sb-text)]">{L.t("common.cancel")}</button>
        <button type="button" onClick={() => void save()} disabled={!complete || saving} className="rounded-full bg-white px-5 py-2 text-sm font-semibold text-black transition-transform active:scale-95 disabled:opacity-40">
          {saving ? L.t("common.saving") : L.t(mode === "add" ? "form.add" : "common.save")}
        </button>
      </div>
    </div>
  );
}
