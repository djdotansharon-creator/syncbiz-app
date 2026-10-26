"use client";

/**
 * BranchCreateFlow — adding a NEW branch, in the same writing-flow language as the brand creation (owner 2026-10-22: "make adding a branch comfortable and pretty"):
 * one big thing per step on the glass card, a ✓ that jumps in once there is something to confirm, an arrow at each side and the step circles between them.
 *  Name (the big writing line, the hint types itself) → Number → Brand (only when the organisation has brands; the default is already chosen) → Location (Google Places search, then a
 *  map preview — nothing that was not picked from Google is ever saved) → Logo (optional; it is uploaded right after the branch exists).
 * Editing a branch still uses the stepped glass dialog in branch-form.tsx. Styles: `.bcf-*` (+ the branch bits `.bcf-brands`, `.bcf-loc`) in globals.css.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from "react";
import { createPortal } from "react-dom";
import { useMgmt } from "@/lib/i18n/use-mgmt";
import { useMapsConfig } from "@/lib/google-maps-client";
import { BranchMap } from "@/components/control-room/branch-map";
import { LogoTile } from "@/components/control-room/logo-tile";
import { usePlaceAutocomplete, type FormBrand, type Picked } from "@/components/control-room/branch-form";
import { useTypewriter } from "@/components/control-room/brand-create-flow";

type Props = {
  /** the organization's brands (null = not available → the brand step is left out and nothing is sent) */
  brands: FormBrand[] | null;
  /** the flow finished or was cancelled (after its exit animation); `id` is the new branch when one was created */
  onDone: (branchId: string | null) => void;
};

type StepKey = "name" | "number" | "brand" | "location" | "logo";

/** the writing line is BIG (owner 2026-10-22: "make the branch name bigger") and shrinks a little as the name grows, so it stays inside the card */
function branchNameSize(len: number): string {
  return len > 26 ? "42px" : len > 18 ? "54px" : len > 12 ? "68px" : "84px";
}

const OUT_MS = 340;
const IN_MS = 480;
const DONE_MS = 760; // the ✓ draws its ring, the tick turns green
const EXIT_MS = 260;

export function BranchCreateFlow({ brands, onDone }: Props) {
  const L = useMgmt();
  const cfg = useMapsConfig();
  const rtl = L.dir === "rtl";
  const keys = useMemo<StepKey[]>(() => ["name", "number", ...(brands && brands.length > 0 ? (["brand"] as StepKey[]) : []), "location", "logo"], [brands]);
  const [step, setStep] = useState(0);
  const [slide, setSlide] = useState<{ phase: "idle" | "out" | "in"; fwd: boolean }>({ phase: "idle", fwd: true });
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");
  const [brandChoice, setBrandChoice] = useState<string | null>(null);
  const brandId = brandChoice ?? brands?.find((b) => b.isDefault)?.id ?? brands?.[0]?.id ?? "";
  const brand = brands?.find((b) => b.id === brandId) ?? null;
  const [picked, setPicked] = useState<Picked | null>(null);
  const [googleError, setGoogleError] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState(0); // restarts the ✓ drawing
  const [doneStep, setDoneStep] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [xPress, setXPress] = useState(false);
  const timers = useRef<number[]>([]);
  const goRef = useRef<HTMLButtonElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const numberRef = useRef<HTMLInputElement>(null);
  const acHostRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { const t = timers.current; return () => t.forEach((x) => window.clearTimeout(x)); }, []);

  const cur = keys[Math.min(step, keys.length - 1)]!;
  const last = step === keys.length - 1;
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  usePlaceAutocomplete(acHostRef, cur === "location" ? cfg?.browserKey ?? null : null, (p) => { setPicked(p); setError(null); }, () => setGoogleError(true));
  const googleReady = !!cfg?.browserKey && !googleError;

  const ready = cur === "name" ? name.trim().length > 0 : cur === "number" ? number.trim().length > 0 : cur === "location" ? !!picked : true;
  const typedName = useTypewriter(L.t("form.name"), cur === "name" && name.length === 0);
  const typedNumber = useTypewriter("192", cur === "number" && number.length === 0);
  const after = (ms: number, fn: () => void) => { timers.current.push(window.setTimeout(fn, ms)); };

  const requestClose = () => {
    if (busy || closing) return;
    setClosing(true);
    after(EXIT_MS, () => onDone(null));
  };

  /** slide to another step: the current one leaves toward the reading direction (right in Hebrew, left in English), the next comes from the other side */
  const go = (delta: 1 | -1) => {
    const fwd = delta === 1;
    setSlide({ phase: "out", fwd });
    after(OUT_MS, () => {
      setStep((s) => s + delta);
      setDoneStep(false);
      setBusy(false);
      setSlide({ phase: "in", fwd });
      after(IN_MS, () => {
        setSlide({ phase: "idle", fwd });
        // the writing steps get the caret back; the others put the ✓ in focus
        const next = keys[Math.min(step + delta, keys.length - 1)];
        if (next === "name") nameRef.current?.focus({ preventScroll: true });
        else if (next === "number") numberRef.current?.focus({ preventScroll: true });
        else goRef.current?.focus({ preventScroll: true });
      });
    });
  };

  const save = async (): Promise<string | null | false> => {
    setError(null);
    try {
      const res = await fetch("/api/control-room/branches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), branchNumber: number.trim(), ...(picked ? { placeId: picked.placeId } : {}), ...(brands?.length && brandId ? { brandId } : {}), language: "he" }),
      });
      const d = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok) { setError(d.error ?? L.t("common.saveFailedHttp", { status: res.status })); return false; }
      if (d.id && file) {
        try {
          const fd = new FormData();
          fd.append("file", file);
          await fetch(`/api/control-room/branches/${encodeURIComponent(d.id)}/logo`, { method: "POST", body: fd });
        } catch { /* the branch exists; its logo can be added from Edit */ }
      }
      return d.id ?? null;
    } catch {
      setError(L.t("common.serverRetry"));
      return false;
    }
  };

  const confirm = () => {
    if (busy || closing || slide.phase !== "idle" || !ready) return;
    setBusy(true);
    setError(null);
    setRun((n) => n + 1);
    setDoneStep(true);
    if (!last) {
      after(DONE_MS - 160, () => go(1));
      return;
    }
    const minAnim = new Promise<void>((resolve) => after(DONE_MS, resolve));
    void Promise.all([save(), minAnim]).then(([id]) => {
      if (id !== false) {
        setClosing(true);
        after(EXIT_MS + 120, () => onDone(id));
      } else {
        setBusy(false);
        setDoneStep(false);
      }
    });
  };

  /** the red ✕: a small press-and-release plays, then the logo goes */
  const removeLogo = () => {
    if (xPress) return;
    setXPress(true);
    after(320, () => { setFile(null); setXPress(false); });
  };
  const pick = (f: File | undefined | null) => { if (f && /^image\//.test(f.type)) { setFile(f); setError(null); } };
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDragOver(false); pick(e.dataTransfer.files?.[0]); };

  // direction: the leaving step goes to the reading direction (+x in Hebrew, −x in English); going BACK mirrors it
  const sign = (rtl ? 1 : -1) * (slide.fwd ? 1 : -1);
  const initial = ((name.trim().split(/\s+/).pop() ?? "").charAt(0) || "·").toUpperCase();
  const stepLabel = cur === "number" ? L.t("form.number") : cur === "brand" ? L.t("form.brand") : cur === "location" ? L.t("form.location") : L.t("brand.logo");
  const brandColor = brand?.color ?? "#8e8e93";

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className={`sb-wz-backdrop bcf${closing ? " is-closing" : ""}`}
      dir={L.dir}
      role="dialog"
      aria-modal="true"
      aria-label={L.t("form.add")}
      onKeyDown={(e) => {
        if (e.key === "Escape") { e.stopPropagation(); requestClose(); return; }
        // a writing step: a letter typed while the field lost focus (a click on the backdrop …) still lands in it
        const field = cur === "name" ? nameRef.current : cur === "number" ? numberRef.current : null;
        if (field && !busy && e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey && document.activeElement !== field) field.focus();
      }}
      onMouseDown={(e) => {
        const field = cur === "name" ? nameRef.current : cur === "number" ? numberRef.current : null;
        if (field && !busy && !(e.target as HTMLElement).closest("button")) { e.preventDefault(); field.focus(); }
      }}
    >
      <div className={`sb-wz-panel bcf-card${closing ? " is-closing" : ""}`}>
        <div className="bcf-stage">
          <form
            className={`bcf-step${cur === "name" ? " bcf-step--name" : ""}${cur === "location" ? " bcf-step--loc" : ""}${slide.phase === "out" ? " is-out" : ""}${slide.phase === "in" ? " is-in" : ""}`}
            style={{ ["--bcf-x" as string]: `${sign * 130}px` } as CSSProperties}
            onSubmit={(e) => { e.preventDefault(); confirm(); }}
          >
            {cur === "name" ? (
              <div className="bcf-field">
                <input
                  ref={nameRef}
                  autoFocus
                  className={`bcf-input${name ? " has-value" : ""}`}
                  dir="auto"
                  type="text"
                  value={name}
                  maxLength={60}
                  autoComplete="off"
                  spellCheck={false}
                  enterKeyHint="next"
                  aria-label={L.t("form.name")}
                  onChange={(e) => { setName(e.target.value); setError(null); }}
                  readOnly={busy}
                  style={{ fontSize: branchNameSize(name.length) } as CSSProperties}
                />
                {!name ? (
                  <span className="bcf-hint" style={{ fontSize: branchNameSize(0) } as CSSProperties} aria-hidden>
                    <span>{typedName}</span>
                    <i className="bcf-caret" />
                  </span>
                ) : null}
                <span className="bcf-rule" aria-hidden />
              </div>
            ) : (
              <>
                <p className="bcf-name" dir="auto">{name.trim()}</p>
                <p className="bcf-sub">{stepLabel}</p>
                {cur === "number" ? (
                  <div className="bcf-field bcf-field--num">
                    <input
                      ref={numberRef}
                      className={`bcf-input${number ? " has-value" : ""}`}
                      dir="ltr"
                      type="text"
                      inputMode="numeric"
                      value={number}
                      maxLength={12}
                      autoComplete="off"
                      spellCheck={false}
                      enterKeyHint="next"
                      aria-label={L.t("form.number")}
                      onChange={(e) => { setNumber(e.target.value); setError(null); }}
                      readOnly={busy}
                      style={{ fontSize: "76px" } as CSSProperties}
                    />
                    {!number ? (
                      <span className="bcf-hint" style={{ fontSize: "76px" } as CSSProperties} aria-hidden>
                        <span>{typedNumber}</span>
                        <i className="bcf-caret" />
                      </span>
                    ) : null}
                    <span className="bcf-rule" aria-hidden />
                  </div>
                ) : null}

                {cur === "brand" && brands ? (
                  <div className="bcf-brands" role="radiogroup" aria-label={L.t("form.brand")}>
                    {brands.map((b) => (
                      <button key={b.id} type="button" role="radio" aria-checked={brandId === b.id} disabled={busy} onClick={() => setBrandChoice(b.id)} className={`bcf-brand${brandId === b.id ? " is-on" : ""}`}>
                        <i style={{ background: b.color ?? "#8e8e93" }} aria-hidden />
                        <span dir="auto">{b.name}{b.isDefault ? ` ${L.t("form.defaultBrand")}` : ""}</span>
                      </button>
                    ))}
                  </div>
                ) : null}

                {cur === "location" ? (
                  <div className="bcf-loc">
                    {!googleReady ? (
                      <p className="cr-note">
                        <span className="cr-note-dot" aria-hidden />
                        {cfg === null ? L.t("form.loadingSearch") : L.t("form.googleMissing")}
                      </p>
                    ) : (
                      <>
                        <div ref={acHostRef} className="bcf-loc-search" dir={L.dir} />
                        {!picked ? <p className="bcf-note">{L.t("form.locationHint")}</p> : null}
                      </>
                    )}
                    {picked ? (
                      <div className="bcf-loc-pick">
                        <p dir="auto">📍 {picked.label}</p>
                        <div className="bcf-loc-map">
                          <BranchMap
                            branches={[{ id: "preview", name: name || L.t("form.newBranch"), city: "", status: "idle", latitude: picked.latitude, longitude: picked.longitude }]}
                            selectedId="preview"
                            onSelect={() => {}}
                            height={150}
                            fit="branches"
                          />
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {cur === "logo" ? (
                  <div className="bcf-logo">
                    <div className="bcf-logo-row">
                      <label
                        className={`bcf-drop${dragOver ? " is-over" : ""}${preview ? " has-logo" : ""}`}
                        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                        onDragLeave={() => setDragOver(false)}
                        onDrop={onDrop}
                      >
                        <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="sr-only" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; pick(f); }} />
                        {preview ? (
                          <span className="bcf-tile"><LogoTile src={preview} color={brandColor} initial={initial} /></span>
                        ) : (
                          <svg viewBox="0 0 24 24" width="54" height="54" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg>
                        )}
                      </label>
                    </div>
                    {/* under the logo: a plain red ✕ (no frame) — same as the brand's */}
                    <div className="bcf-note">
                      {preview ? (
                        <button key="x" type="button" className={`bcf-logo-x${xPress ? " is-press" : ""}`} onClick={removeLogo} disabled={busy} aria-label={L.t("brand.logoRemove")} title={L.t("brand.logoRemove")}>
                          <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden><path d="M18 6 6 18M6 6l12 12" /></svg>
                        </button>
                      ) : L.t("brand.logoHint")}
                    </div>
                  </div>
                ) : null}
              </>
            )}

            {/* the ✓ (our Face-ID-style check): jumps in under the text once there is something to confirm, ring draws and tick turns green when pressed */}
            <button
              key={run}
              ref={goRef}
              type="submit"
              className={`bcf-go${ready && !closing ? " is-on" : ""}${doneStep ? " is-done" : ""}`}
              disabled={!ready || busy}
              aria-label={L.t(last ? "form.add" : "wz.next")}
              title={L.t(last ? "form.add" : "wz.next")}
              tabIndex={ready ? 0 : -1}
            >
              <svg viewBox="0 0 40 40" fill="none" aria-hidden>
                <circle className="bcf-ring" cx="20" cy="20" r="17" pathLength="1" />
                <path className="bcf-tick" d="M12.5 20.8l5.2 5.2 9.8-11.2" pathLength="1" />
              </svg>
            </button>
            <p className="bcf-error" role="alert">{error ?? ""}</p>
          </form>
        </div>

        {/* the bottom line: an arrow at each side (Cancel / Back on the start side, Next on the end side) and the step circles between them — no words */}
        <div className="bcf-nav" dir={L.dir}>
          <button type="button" className="bcf-arrow" onClick={() => { if (busy || slide.phase !== "idle") return; if (step === 0) requestClose(); else go(-1); }} disabled={busy} aria-label={L.t(step === 0 ? "common.cancel" : "common.back")} title={L.t(step === 0 ? "common.cancel" : "common.back")}>
            <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="rtl:rotate-180" aria-hidden><path d="m15 18-6-6 6-6" /></svg>
          </button>
          <div className="bcf-dots" aria-hidden>
            {keys.map((k, i) => <i key={k} className={i === step ? "is-on" : ""} />)}
          </div>
          <button type="button" className="bcf-arrow" onClick={confirm} disabled={busy || !ready || slide.phase !== "idle"} aria-label={L.t(last ? "form.add" : "wz.next")} title={L.t(last ? "form.add" : "wz.next")}>
            <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="rtl:rotate-180" aria-hidden><path d="m9 18 6-6-6-6" /></svg>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
