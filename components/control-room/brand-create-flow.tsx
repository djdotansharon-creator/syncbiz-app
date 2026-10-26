"use client";

/**
 * BrandCreateFlow — creating a NEW brand (owner 2026-10-21: "the text in the centre, big, a writing design; the brand name and the dashed line; the placeholder is typed, erased and typed again
 * until the first key; a ✓ in our design jumps in calmly underneath; then the next step slides away to the right in Hebrew / to the left in English and the next one comes from the other side").
 *  Step 1 — the NAME: one huge centred line on a dashed rule. Until a key is pressed the name hint types itself, waits, erases and types again (a blinking caret); the first real letter replaces it.
 *  Step 2 — the LOGO (optional): a big dashed tile — click or drop an image.   Step 3 — the COLOUR: big rounded swatches.
 * The ✓ is the Face-ID-style check of the new-playlist window (a ring draws, the tick turns green). The brand code is derived from the name (Latin letters, else BRAND; a clash adds a number).
 * Editing a brand still uses the glass wizard in brand-manager.tsx. Styles: `.bcf-*` in globals.css.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from "react";
import { createPortal } from "react-dom";
import { useMgmt } from "@/lib/i18n/use-mgmt";
import { LogoTile } from "@/components/control-room/logo-tile";

type Props = {
  brands: ReadonlyArray<{ code: string; color: string | null }>;
  palette: readonly string[];
  /** the flow finished or was cancelled (after its exit animation) */
  onClose: () => void;
  /** a brand was created */
  onChanged: () => void;
};

const OUT_MS = 340;
const IN_MS = 480;
const DONE_MS = 760; // the ✓ draws its ring, the tick turns green
const EXIT_MS = 260;

/** the hint that types itself, waits, erases and starts again (while `active`) */
export function useTypewriter(text: string, active: boolean): string {
  const [n, setN] = useState(0);
  const st = useRef({ n: 0, dir: 1, hold: 0 });
  useEffect(() => {
    if (!active) return;
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    st.current = { n: 0, dir: 1, hold: 6 };
    const id = setInterval(() => {
      const s = st.current;
      if (reduce) { s.n = text.length; setN(s.n); return; }
      if (s.hold > 0) { s.hold--; return; }
      if (s.dir === 1) {
        if (s.n < text.length) s.n++;
        else { s.dir = -1; s.hold = 22; }
      } else if (s.n > 0) {
        s.n = Math.max(0, s.n - 1);
      } else {
        s.dir = 1; s.hold = 9;
      }
      setN(s.n);
    }, 70);
    return () => clearInterval(id);
  }, [text, active]);
  return active ? text.slice(0, n) : "";
}


function hexToHue(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0;
  const n = parseInt(m[1]!, 16), r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d === 0) return 0;
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}
function hueToHex(h: number, s = 0.85, l = 0.58): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => { const k = (n + h / 30) % 12; const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); return Math.round(255 * c).toString(16).padStart(2, "0"); };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** a colour STRIP: drag the knob, scroll the wheel over it, or use the arrow keys — the hue runs left to right (the strip stays left-to-right in Hebrew too, like a media slider) */
function HueBar({ color, onPick, disabled, label }: { color: string; onPick: (hex: string) => void; disabled: boolean; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [hue, setHue] = useState(() => hexToHue(color));
  // the knob follows an outside change of the colour (a used-colour circle) without an effect: if the colour is not the one this hue makes, read the hue off the colour
  const shown = hueToHex(hue).toLowerCase() === color.toLowerCase() ? hue : hexToHue(color);
  const latest = useRef({ shown, disabled, onPick });
  useEffect(() => { latest.current = { shown, disabled, onPick }; });
  const set = (h: number) => { const v = ((h % 360) + 360) % 360; setHue(v); onPick(hueToHex(v)); };
  const fromX = (clientX: number) => { const r = ref.current?.getBoundingClientRect(); if (!r) return; set(Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * 359.9); };
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const cur = latest.current;
      if (cur.disabled) return;
      e.preventDefault();
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      const v = Math.max(0, Math.min(359.9, cur.shown + d * 0.35));
      setHue(v);
      cur.onPick(hueToHex(v));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
  return (
    <div
      ref={ref}
      className="bcf-hue"
      dir="ltr"
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={360}
      aria-valuenow={Math.round(shown)}
      onPointerDown={(e) => { if (disabled) return; e.currentTarget.setPointerCapture(e.pointerId); fromX(e.clientX); }}
      onPointerMove={(e) => { if (!disabled && e.currentTarget.hasPointerCapture(e.pointerId)) fromX(e.clientX); }}
      onKeyDown={(e) => {
        if (disabled) return;
        const step = e.shiftKey ? 12 : 3;
        if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); set(Math.min(359.9, shown + step)); }
        else if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); set(Math.max(0, shown - step)); }
        else if (e.key === "Home") { e.preventDefault(); set(0); }
        else if (e.key === "End") { e.preventDefault(); set(359.9); }
      }}
    >
      <span className="bcf-hue-knob" style={{ left: `${(shown / 360) * 100}%`, background: color }} />
    </div>
  );
}

/** the writing line shrinks a little as the name grows, so it stays inside the card */
export function nameSize(len: number): string {
  return len > 26 ? "30px" : len > 18 ? "38px" : len > 12 ? "46px" : "56px";
}

function makeCode(name: string, used: Set<string>): string {
  const base = name.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10) || "BRAND";
  let code = base;
  for (let i = 2; used.has(code); i++) code = `${base}${i}`;
  return code;
}

export function BrandCreateFlow({ brands, palette, onClose, onChanged }: Props) {
  const L = useMgmt();
  const rtl = L.dir === "rtl";
  const [step, setStep] = useState(0);
  const [slide, setSlide] = useState<{ phase: "idle" | "out" | "in"; fwd: boolean }>({ phase: "idle", fwd: true });
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [color, setColor] = useState(() => {
    const used = new Set(brands.map((b) => (b.color ?? "").toLowerCase()));
    return palette.find((c) => !used.has(c.toLowerCase())) ?? palette[0] ?? "#0a84ff";
  });
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState(0); // restarts the ✓ drawing
  const [doneStep, setDoneStep] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [xPress, setXPress] = useState(false);
  const timers = useRef<number[]>([]);
  const goRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { const t = timers.current; return () => t.forEach((x) => window.clearTimeout(x)); }, []);

  // up to 3 colours the other brands already use — the newest first
  const usedColors = useMemo(() => {
    const seen = new Set<string>(), out: string[] = [];
    for (let i = brands.length - 1; i >= 0 && out.length < 3; i--) {
      const c = (brands[i]!.color ?? "").toLowerCase();
      if (/^#[0-9a-f]{6}$/.test(c) && !seen.has(c)) { seen.add(c); out.push(c); }
    }
    return out;
  }, [brands]);
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const ready = step === 0 ? name.trim().length > 0 : true;
  const typed = useTypewriter(L.t("brand.name"), step === 0 && name.length === 0);
  const after = (ms: number, fn: () => void) => { timers.current.push(window.setTimeout(fn, ms)); };

  const requestClose = () => {
    if (busy || closing) return;
    setClosing(true);
    after(EXIT_MS, onClose);
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
      after(IN_MS, () => { setSlide({ phase: "idle", fwd }); goRef.current?.focus({ preventScroll: true }); });
    });
  };

  const save = async (): Promise<boolean> => {
    setError(null);
    const used = new Set(brands.map((b) => b.code.toUpperCase()));
    let code = makeCode(name, used);
    try {
      for (let attempt = 0; attempt < 5; attempt++) {
        const res = await fetch("/api/control-room/brands", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), code, color }) });
        const d = (await res.json().catch(() => ({}))) as { error?: string; id?: string };
        if (res.ok && d.id) {
          if (file) {
            try {
              const fd = new FormData();
              fd.append("file", file);
              await fetch(`/api/control-room/brands/${encodeURIComponent(d.id)}/logo`, { method: "POST", body: fd });
            } catch { /* the brand exists; its logo can be added from Edit */ }
          }
          return true;
        }
        if (res.status === 409) { used.add(code); code = makeCode(name, used); continue; } // that code is taken — try the next one
        setError(d.error ?? L.t("common.saveFailedHttp", { status: res.status }));
        return false;
      }
      setError(L.t("common.serverRetry"));
      return false;
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
    if (step < 2) {
      after(DONE_MS - 160, () => go(1));
      return;
    }
    const minAnim = new Promise<void>((resolve) => after(DONE_MS, resolve));
    void Promise.all([save(), minAnim]).then(([ok]) => {
      if (ok) {
        onChanged();
        setClosing(true);
        after(EXIT_MS + 120, onClose);
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
  const stepLabel = step === 1 ? L.t("brand.logo") : L.t("brand.color");

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className={`sb-wz-backdrop bcf${closing ? " is-closing" : ""}`}
      dir={L.dir}
      role="dialog"
      aria-modal="true"
      aria-label={L.t("brand.add")}
      onKeyDown={(e) => {
        if (e.key === "Escape") { e.stopPropagation(); requestClose(); return; }
        // the name step: a letter typed while the field lost focus (a click on the backdrop …) still lands in it
        if (step === 0 && !busy && e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey && document.activeElement !== inputRef.current) inputRef.current?.focus();
      }}
      onMouseDown={(e) => { if (step === 0 && !busy && !(e.target as HTMLElement).closest("button")) { e.preventDefault(); inputRef.current?.focus(); } }}
    >
      <div className={`sb-wz-panel bcf-card${closing ? " is-closing" : ""}`}>
        <div className="bcf-stage">
      <form
        className={`bcf-step${step === 0 ? " bcf-step--name" : ""}${slide.phase === "out" ? " is-out" : ""}${slide.phase === "in" ? " is-in" : ""}`}
        style={{ ["--bcf-x" as string]: `${sign * 130}px` } as CSSProperties}
        onSubmit={(e) => { e.preventDefault(); confirm(); }}
      >
        {step === 0 ? (
          <div className="bcf-field">
            <input
              ref={inputRef}
              autoFocus
              className={`bcf-input${name ? " has-value" : ""}`}
              dir="auto"
              type="text"
              value={name}
              maxLength={40}
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="next"
              aria-label={L.t("brand.name")}
              onChange={(e) => { setName(e.target.value); setError(null); }}
              readOnly={busy}
              style={{ fontSize: nameSize(name.length) } as CSSProperties}
            />
            {!name ? (
              <span className="bcf-hint" aria-hidden>
                <span>{typed}</span>
                <i className="bcf-caret" />
              </span>
            ) : null}
            <span className="bcf-rule" aria-hidden />
          </div>
        ) : (
          <>
            <p className="bcf-name" style={step === 2 ? ({ color } as CSSProperties) : undefined} dir="auto">{name.trim()}</p>
            <p className="bcf-sub">{stepLabel}</p>
            {step === 1 ? (
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
                      <span className="bcf-tile"><LogoTile src={preview} color={color} initial={initial} /></span>
                    ) : (
                      <svg viewBox="0 0 24 24" width="54" height="54" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg>
                    )}
                  </label>
                </div>
                {/* under the logo: a plain red ✕ (no frame) that pops in, swells under the pointer and gives a small press-and-release when it is clicked — then the logo goes */}
                <div className="bcf-note">
                  {preview ? (
                    <button key="x" type="button" className={`bcf-logo-x${xPress ? " is-press" : ""}`} onClick={removeLogo} disabled={busy} aria-label={L.t("brand.logoRemove")} title={L.t("brand.logoRemove")}>
                      <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden><path d="M18 6 6 18M6 6l12 12" /></svg>
                    </button>
                  ) : L.t("brand.logoHint")}
                </div>
              </div>
            ) : (
              <div className="bcf-colors">
                <HueBar color={color} onPick={setColor} disabled={busy} label={L.t("brand.color")} />
                {usedColors.length ? (
                  <div className="bcf-used" role="group" aria-label={L.t("brand.color")}>
                    {usedColors.map((c) => (
                      <button key={c} type="button" className={`bcf-used-dot${color.toLowerCase() === c ? " is-on" : ""}`} style={{ background: c }} onClick={() => setColor(c)} disabled={busy} aria-label={L.t("brand.colorAria", { c })} />
                    ))}
                  </div>
                ) : null}
              </div>
            )}
          </>
        )}

        {/* the ✓ (our Face-ID-style check): jumps in under the text once there is something to confirm, ring draws and tick turns green when pressed */}
        <button
          key={run}
          ref={goRef}
          type="submit"
          className={`bcf-go${ready && !closing ? " is-on" : ""}${doneStep ? " is-done" : ""}`}
          disabled={!ready || busy}
          aria-label={L.t(step < 2 ? "wz.next" : "brand.add")}
          title={L.t(step < 2 ? "wz.next" : "brand.add")}
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

      {/* the bottom line: an arrow at each side (Cancel / Back on the start side, Next on the end side) and the step circles between them — no words (owner 2026-10-21) */}
      <div className="bcf-nav" dir={L.dir}>
        <button type="button" className="bcf-arrow" onClick={() => { if (busy || slide.phase !== "idle") return; if (step === 0) requestClose(); else go(-1); }} disabled={busy} aria-label={L.t(step === 0 ? "common.cancel" : "common.back")} title={L.t(step === 0 ? "common.cancel" : "common.back")}>
          <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="rtl:rotate-180" aria-hidden><path d="m15 18-6-6 6-6" /></svg>
        </button>
        <div className="bcf-dots" aria-hidden>
          {[0, 1, 2].map((i) => <i key={i} className={i === step ? "is-on" : ""} />)}
        </div>
        <button type="button" className="bcf-arrow" onClick={confirm} disabled={busy || !ready || slide.phase !== "idle"} aria-label={L.t(step < 2 ? "wz.next" : "brand.add")} title={L.t(step < 2 ? "wz.next" : "brand.add")}>
          <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="rtl:rotate-180" aria-hidden><path d="m9 18 6-6-6-6" /></svg>
        </button>
      </div>
      </div>
    </div>,
    document.body,
  );
}
