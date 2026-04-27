"use client";

/**
 * Entitlement editor for `/admin/platform/workspaces/[id]`.
 *
 * Drives the PATCH endpoint at
 * `/api/admin/platform/workspaces/[id]/entitlement`. The form mirrors
 * the strict server-side validation (integers, hard caps, non-empty
 * planCode) so users hit obvious errors locally and only the
 * subtle / race-y ones round-trip.
 *
 * UX notes:
 * - Keeps the form collapsed by default; clicking "Edit limits" expands
 *   it. The drill-down page still renders the current values in plain
 *   text above the form, so the read view is identical until edit is
 *   clicked.
 * - Empty `notes` is sent as `null` (matches server behavior), letting
 *   the admin clear an existing note by simply deleting the text and
 *   saving.
 * - On success we call `router.refresh()` so the server-rendered
 *   workspace card and audit list re-read Postgres.
 */

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type Props = {
  workspaceId: string;
  workspaceName: string;
  initial: {
    maxBranches: number;
    maxDevices: number;
    maxUsers: number;
    maxPlaylists: number;
    planCode: string;
    notes: string | null;
  };
};

const HARD_CAPS = {
  maxBranches: 100,
  maxDevices: 1000,
  maxUsers: 1000,
  maxPlaylists: 5000,
} as const;

export default function EntitlementForm({ workspaceId, workspaceName, initial }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [maxBranches, setMaxBranches] = useState(String(initial.maxBranches));
  const [maxDevices, setMaxDevices] = useState(String(initial.maxDevices));
  const [maxUsers, setMaxUsers] = useState(String(initial.maxUsers));
  const [maxPlaylists, setMaxPlaylists] = useState(String(initial.maxPlaylists));
  const [planCode, setPlanCode] = useState(initial.planCode);
  const [notes, setNotes] = useState(initial.notes ?? "");

  function reset() {
    setMaxBranches(String(initial.maxBranches));
    setMaxDevices(String(initial.maxDevices));
    setMaxUsers(String(initial.maxUsers));
    setMaxPlaylists(String(initial.maxPlaylists));
    setPlanCode(initial.planCode);
    setNotes(initial.notes ?? "");
    setError(null);
    setInfo(null);
  }

  function parseIntField(name: string, raw: string, cap: number): number | string {
    const trimmed = raw.trim();
    if (trimmed === "") return `${name} is required`;
    const n = Number(trimmed);
    if (!Number.isInteger(n) || n < 0 || n > cap) {
      return `${name} must be an integer 0–${cap}`;
    }
    return n;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);

    const branches = parseIntField("Branches", maxBranches, HARD_CAPS.maxBranches);
    const devices = parseIntField("Devices", maxDevices, HARD_CAPS.maxDevices);
    const users = parseIntField("Users", maxUsers, HARD_CAPS.maxUsers);
    const playlists = parseIntField("Playlists", maxPlaylists, HARD_CAPS.maxPlaylists);

    for (const v of [branches, devices, users, playlists]) {
      if (typeof v === "string") {
        setError(v);
        return;
      }
    }

    const trimmedPlan = planCode.trim();
    if (trimmedPlan.length === 0) {
      setError("Plan code cannot be empty");
      return;
    }

    const trimmedNotes = notes.trim();

    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/admin/platform/workspaces/${encodeURIComponent(workspaceId)}/entitlement`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({
            maxBranches: branches,
            maxDevices: devices,
            maxUsers: users,
            maxPlaylists: playlists,
            planCode: trimmedPlan,
            notes: trimmedNotes.length > 0 ? trimmedNotes : null,
          }),
        },
      );
      const data: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          (typeof data === "object" && data !== null && "error" in data
            ? String((data as { error?: unknown }).error)
            : null) ?? `HTTP ${res.status}`;
        setError(msg);
        return;
      }
      const noChanges =
        typeof data === "object" &&
        data !== null &&
        "noChanges" in data &&
        Boolean((data as { noChanges?: unknown }).noChanges);
      setInfo(noChanges ? "No changes — values match current entitlement." : "Saved.");
      startTransition(() => {
        router.refresh();
      });
      if (!noChanges) {
        setOpen(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded border border-neutral-700 bg-neutral-900 px-2.5 py-1 text-[12px] font-medium text-neutral-200 hover:bg-neutral-800"
      >
        Edit limits & plan
      </button>
    );
  }

  const disabled = submitting || isPending;

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-3 rounded-md border border-neutral-800 bg-neutral-900/40 p-3"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium text-neutral-200">
          Edit entitlement · <span className="text-neutral-400">{workspaceName}</span>
        </h3>
        <button
          type="button"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          className="text-[11px] text-neutral-500 hover:text-neutral-300"
        >
          Cancel
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <NumField label="Branches" value={maxBranches} setValue={setMaxBranches} max={HARD_CAPS.maxBranches} disabled={disabled} />
        <NumField label="Devices" value={maxDevices} setValue={setMaxDevices} max={HARD_CAPS.maxDevices} disabled={disabled} />
        <NumField label="Users" value={maxUsers} setValue={setMaxUsers} max={HARD_CAPS.maxUsers} disabled={disabled} />
        <NumField label="Playlists" value={maxPlaylists} setValue={setMaxPlaylists} max={HARD_CAPS.maxPlaylists} disabled={disabled} />
      </div>

      <div>
        <label className="block text-[11px] font-medium uppercase tracking-wide text-neutral-400">
          Plan code
        </label>
        <input
          type="text"
          value={planCode}
          onChange={(e) => setPlanCode(e.target.value)}
          disabled={disabled}
          maxLength={50}
          className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100 outline-none focus:border-neutral-500 disabled:opacity-50"
        />
      </div>

      <div>
        <label className="block text-[11px] font-medium uppercase tracking-wide text-neutral-400">
          Notes (free text, audit-visible)
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={disabled}
          rows={3}
          maxLength={2000}
          className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100 outline-none focus:border-neutral-500 disabled:opacity-50"
          placeholder="Internal note about this workspace's pilot terms…"
        />
        <p className="mt-1 text-[10px] text-neutral-500">{notes.length}/2000</p>
      </div>

      {error ? (
        <div className="rounded border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[12px] text-rose-300">
          {error}
        </div>
      ) : null}
      {info ? (
        <div className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[12px] text-emerald-300">
          {info}
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={disabled}
          className="rounded border border-neutral-600 bg-neutral-100 px-3 py-1 text-[12px] font-medium text-neutral-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "Saving…" : "Save changes"}
        </button>
        <button
          type="button"
          onClick={reset}
          disabled={disabled}
          className="rounded border border-neutral-700 bg-neutral-900 px-3 py-1 text-[12px] font-medium text-neutral-300 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Reset
        </button>
      </div>
    </form>
  );
}

function NumField({
  label,
  value,
  setValue,
  max,
  disabled,
}: {
  label: string;
  value: string;
  setValue: (v: string) => void;
  max: number;
  disabled: boolean;
}) {
  return (
    <div>
      <label className="block text-[11px] font-medium uppercase tracking-wide text-neutral-400">
        {label} <span className="text-neutral-600">(0–{max})</span>
      </label>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={max}
        step={1}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={disabled}
        className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100 outline-none focus:border-neutral-500 disabled:opacity-50"
      />
    </div>
  );
}
