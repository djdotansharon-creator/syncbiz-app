"use client";

/**
 * ConfirmDelete — "are you sure?" for deleting a branch or a brand (owner 2026-10-22), in the glass dialog of the design line: what will go, Cancel, and a red Delete. The DELETE call
 * is made by the host (`onConfirm` answers an error text, or null when it worked); a refusal from the server (a station is installed, branches still belong to the brand …) is shown in the
 * dialog, in the interface language, and nothing is closed. Styles: `.sb-wz-*` (+ `.cr-del-*`) in globals.css.
 */
import { useState } from "react";
import { GlassModal } from "@/components/glass-modal";
import { useMgmt } from "@/lib/i18n/use-mgmt";

export type DeleteRefusal = { code?: string; count?: number; error?: string };

/** the server's refusal worded in the interface language */
export function deleteRefusalText(L: ReturnType<typeof useMgmt>, d: DeleteRefusal): string {
  switch (d.code) {
    case "default": return L.t("del.err.default");
    case "station": return L.t("del.err.station");
    case "scope": return L.t("del.err.scope");
    case "branches": return L.t("del.err.branches", { n: L.branches(d.count ?? 0) });
    case "assignment": return L.t("del.err.assignment");
    case "confirm": return L.t("del.err.confirm");
    case "busy": return L.t("del.err.busy");
    default: return L.t("del.err.generic");
  }
}

export function ConfirmDelete({ kind, name, typeToConfirm, onConfirm, onClose }: { kind: "branch" | "brand"; name: string; /** the name the owner must type (a branch — the server checks it too) */ typeToConfirm?: string; onConfirm: (typed: string) => Promise<string | null>; onClose: () => void }) {
  const L = useMgmt();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const ready = typeToConfirm === undefined || typed.trim() === typeToConfirm.trim();
  const run = async () => {
    if (busy || !ready) return;
    setBusy(true);
    setError(null);
    const err = await onConfirm(typed);
    if (err) { setError(err); setBusy(false); return; }
    // success: the host closes everything (the row is gone)
  };
  return (
    <GlassModal
      title={L.t(kind === "branch" ? "del.branchTitle" : "del.brandTitle")}
      subtitle={name}
      showInitial
      width={460}
      closeOnBackdrop={!busy}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="sb-wz-btn" onClick={onClose} disabled={busy}>{L.t("common.cancel")}</button>
          <span className="sb-wz-spacer" />
          <button type="button" className="sb-wz-btn cr-del-btn" onClick={() => void run()} disabled={busy || !ready}>{busy ? "…" : L.t("common.delete")}</button>
        </>
      }
    >
      <p className="cr-del-body" dir="auto">{L.t(kind === "branch" ? "del.branchBody" : "del.brandBody", { name })}</p>
      {typeToConfirm !== undefined ? (
        <input
          className="sb-wz-input"
          style={{ marginTop: 14 }}
          value={typed}
          onChange={(e) => { setTyped(e.target.value); setError(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void run(); } }}
          placeholder={L.t("del.typeName")}
          aria-label={L.t("del.typeName")}
          dir="auto"
          disabled={busy}
          autoFocus
        />
      ) : null}
      {error ? <p className="sb-wz-error" role="alert">{error}</p> : null}
    </GlassModal>
  );
}
