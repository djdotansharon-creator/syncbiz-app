"use client";

import { useState } from "react";

/**
 * CONTROL ROOM — add / edit a branch (owner). Name, branch number and the REAL address (country, city, street, house
 * number). On save the server geocodes the address to an exact map position; if it is not found exactly, the branch is
 * NOT saved and the server's clear message is shown so the address can be corrected (no guessed location).
 */

export type BranchFormValues = { name: string; branchNumber: string; country: string; city: string; street: string; houseNumber: string };

export function BranchForm({
  mode,
  branchId,
  initial,
  onDone,
  onCancel,
}: {
  mode: "add" | "edit";
  branchId?: string;
  initial?: Partial<BranchFormValues>;
  onDone: (branchId: string | null) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState<BranchFormValues>({
    name: initial?.name ?? "",
    branchNumber: initial?.branchNumber ?? "",
    country: initial?.country || "Israel",
    city: initial?.city ?? "",
    street: initial?.street ?? "",
    houseNumber: initial?.houseNumber ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof BranchFormValues) => (e: React.ChangeEvent<HTMLInputElement>) => setV((s) => ({ ...s, [k]: e.target.value }));
  const complete = v.name.trim() && v.branchNumber.trim() && v.city.trim() && v.street.trim() && v.houseNumber.trim();

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(mode === "add" ? "/api/control-room/branches" : `/api/control-room/branches/${encodeURIComponent(branchId ?? "")}`, {
        method: mode === "add" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(v),
      });
      const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok) {
        setError(data.error ?? `Could not save (HTTP ${res.status}).`);
        return;
      }
      onDone(mode === "add" ? data.id ?? null : branchId ?? null);
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const field = (label: string, key: keyof BranchFormValues, placeholder: string, extra?: { dir?: "auto" }) => (
    <label className="block">
      <span className="text-xs text-[var(--sb-text-tertiary)]">{label}</span>
      <input
        value={v[key]}
        onChange={set(key)}
        placeholder={placeholder}
        dir={extra?.dir ?? "auto"}
        disabled={saving}
        className="mt-1 w-full rounded-lg border border-[color:var(--sb-border)] bg-white/[0.04] px-3 py-2 text-sm text-[var(--sb-text)] placeholder:text-[var(--sb-text-tertiary)] focus:border-[color:var(--sb-accent)] focus:outline-none"
      />
    </label>
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-[color:var(--sb-border)] px-6 py-4">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--sb-text-secondary)] transition-colors hover:bg-white/[0.06] hover:text-[var(--sb-text)]"
          aria-label="Cancel"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m15 18-6-6 6-6" /></svg>
        </button>
        <h2 className="text-base font-semibold text-[var(--sb-text)]">{mode === "add" ? "Add branch" : "Edit branch"}</h2>
      </div>

      <div className="space-y-4 px-6 py-5">
        <div className="grid grid-cols-[2fr_1fr] gap-3">
          {field("Branch name", "name", "e.g. Aroma Ashdod")}
          {field("Branch number", "branchNumber", "e.g. 192")}
        </div>
        <div className="text-xs text-[var(--sb-text-tertiary)]">Address — used to place the branch exactly on the map</div>
        <div className="grid grid-cols-2 gap-3">
          {field("Country", "country", "Israel")}
          {field("City", "city", "e.g. Ashdod / אשדוד")}
        </div>
        <div className="grid grid-cols-[2fr_1fr] gap-3">
          {field("Street", "street", "e.g. Herzl / הרצל")}
          {field("House number", "houseNumber", "e.g. 10")}
        </div>
        {error ? (
          <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-200" role="alert">{error}</p>
        ) : null}
      </div>

      <div className="mt-auto flex items-center justify-end gap-3 border-t border-[color:var(--sb-border)] px-6 py-4">
        <button type="button" onClick={onCancel} disabled={saving} className="rounded-full px-4 py-2 text-sm text-[var(--sb-text-secondary)] hover:text-[var(--sb-text)]">
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!complete || saving}
          className="rounded-full bg-white px-5 py-2 text-sm font-semibold text-black transition-transform active:scale-95 disabled:opacity-40"
        >
          {saving ? "Finding the address…" : mode === "add" ? "Add branch" : "Save"}
        </button>
      </div>
    </div>
  );
}
