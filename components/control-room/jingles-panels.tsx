"use client";

/**
 * CONTROL ROOM — Jingles surfaces (owner 2026-10-12, Stage 1 UI). ONE library, ONE Studio, ONE backend:
 *  - BranchJingles: inside the branch panel — two groups only: "Branch jingles" (LOCAL of this branch) and
 *    "Available to this branch" (everything else it is eligible for). Name · audience badge · duration · Preview ·
 *    Play now (explicit target = this branch, confirmed). HQ: Share (promote LOCAL → brand / region / network).
 *  - JinglesHqPanel: HQ view — "Pending assignment" (UNASSIGNED, never playable) + the library with audience badges +
 *    Create jingle, which opens the SAME JinglesWorkspacePanel (Control Room surface) with the audience pre-filled.
 * Preview is local audio on THIS computer only (useAudioPreview) — it never sends a command. Eligibility = the server
 * (GET ?branchId=) + lib/jingles/audience.ts; nothing is re-implemented here.
 */
import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import type { RemoteCommand } from "@/lib/remote-control/types";
import { useAudioPreview } from "@/components/jingles-control/use-audio-preview";
import { JinglesWorkspacePanel } from "@/components/jingles-control/JinglesShell";
import type { Mgmt } from "@/lib/i18n/management";
import {
  AudienceBadge,
  AudienceEditor,
  draftAudience,
  EMPTY_DRAFT,
  fmtDuration,
  patchAudience,
  type AudienceDeps,
  type AudienceDraft,
  type JingleItem,
} from "@/components/control-room/jingle-audience";

type Ack = (targetBranchId: string, command: RemoteCommand, payload?: { url?: string }) => Promise<{ delivered: boolean; reason?: string }>;

/** inside the Electron desktop all sound goes to the branch (MPV) — local Preview is not available there */
function useIsDesktop(): boolean {
  return useSyncExternalStore(() => () => {}, () => "syncbizDesktop" in window, () => false);
}

function useJingles(url: string) {
  const [items, setItems] = useState<JingleItem[] | null>(null);
  const [error, setError] = useState(false);
  const reload = useCallback(() => {
    let cancelled = false;
    fetch(url, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { items?: JingleItem[] }) => { if (!cancelled) { setItems(d.items ?? []); setError(false); } })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [url]);
  useEffect(() => reload(), [reload]);
  return { items, error, reload };
}

/** one jingle row: name · badge · duration · Preview · (actions) */
function JingleRow({ j, deps, L, preview, isDesktop, actions, below }: {
  j: JingleItem; deps: AudienceDeps; L: Mgmt; preview: ReturnType<typeof useAudioPreview>; isDesktop: boolean; actions?: ReactNode; below?: ReactNode;
}) {
  const playing = preview.previewUrl === j.url;
  return (
    <li className="border-b border-[color:var(--vx-line)]">
      <div className="flex min-h-[64px] items-center gap-3 px-1 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-semibold text-[var(--sb-text)]" dir="auto">{j.title || "—"}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-[var(--sb-text-secondary)]">
            <AudienceBadge a={j} deps={deps} L={L} />
            {fmtDuration(j.durationSec) ? <span className="tabular-nums" dir="ltr">{fmtDuration(j.durationSec)}</span> : null}
          </div>
        </div>
        <button
          type="button"
          className="vx-btn vx-btn-ghost shrink-0"
          disabled={!j.url || isDesktop}
          title={isDesktop ? L.t("jg.previewDesktopOff") : undefined}
          onClick={() => preview.toggle(j.url)}
        >
          {playing ? `■ ${L.t("jg.stop")}` : `▶ ${L.t("jg.preview")}`}
        </button>
        {actions}
      </div>
      {below}
    </li>
  );
}

/** inline audience editor + Save (assign / share) — PATCH the SAME row */
function AudienceForm({ j, deps, L, types, initial, onDone }: { j: JingleItem; deps: AudienceDeps; L: Mgmt; types?: AudienceDraft["audience"][]; initial?: AudienceDraft; onDone: (changed: boolean) => void }) {
  const [draft, setDraft] = useState<AudienceDraft>(initial ?? EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const complete = draftAudience(draft);
  return (
    <div className="space-y-3 border-t border-[color:var(--vx-line)] px-1 py-4">
      <AudienceEditor value={draft} onChange={setDraft} deps={deps} L={L} types={types?.filter((x): x is NonNullable<typeof x> => !!x)} />
      {err ? <p className="text-sm text-amber-200" role="alert">{err}</p> : null}
      <div className="flex gap-2">
        <button
          type="button"
          className="vx-btn-primary"
          disabled={!complete || busy}
          onClick={async () => {
            if (!complete) return;
            setBusy(true); setErr(null);
            const r = await patchAudience(j.id, complete);
            setBusy(false);
            if (r.ok) onDone(true); else setErr(r.error ?? "error");
          }}
        >
          {L.t("jg.save")}
        </button>
        <button type="button" className="vx-btn vx-btn-ghost" onClick={() => onDone(false)}>{L.t("common.cancel")}</button>
      </div>
    </div>
  );
}

export function BranchJingles({ branch, deps, isHQ, L, sendCommandWithAck }: {
  branch: { id: string; name: string; branchNumber: string | null; liveBranchId: string | null };
  deps: AudienceDeps; isHQ: boolean; L: Mgmt; sendCommandWithAck: Ack;
}) {
  const { items, error, reload } = useJingles(`/api/jingles/library?branchId=${encodeURIComponent(branch.id)}`);
  const preview = useAudioPreview();
  const isDesktop = useIsDesktop();
  const [arming, setArming] = useState<string | null>(null);
  const [sharing, setSharing] = useState<string | null>(null);
  const [status, setStatus] = useState<Record<string, string>>({});
  const stopPreview = preview.stop; // stable (useCallback) — stop the local audition when the panel closes
  useEffect(() => () => stopPreview(), [stopPreview]);

  const target = branch.branchNumber ? L.t("common.branchNumber", { n: branch.branchNumber }) : branch.name;
  const playNow = async (j: JingleItem) => {
    setArming(null);
    if (!branch.liveBranchId) { setStatus((s) => ({ ...s, [j.id]: L.t("jg.offline") })); return; }
    // explicit target = THIS branch only (the same PLAY_INTERRUPT path as Broadcast)
    const r = await sendCommandWithAck(branch.liveBranchId, "PLAY_INTERRUPT", { url: j.url });
    setStatus((s) => ({ ...s, [j.id]: r.delivered ? L.t("jg.sent") : L.t("jg.offline") }));
  };
  const local = (items ?? []).filter((j) => j.audience === "LOCAL" && j.audienceBranchId === branch.id);
  const available = (items ?? []).filter((j) => !(j.audience === "LOCAL" && j.audienceBranchId === branch.id));

  const row = (j: JingleItem) => (
    <JingleRow
      key={j.id}
      j={j}
      deps={deps}
      L={L}
      preview={preview}
      isDesktop={isDesktop}
      actions={
        <>
          {arming === j.id ? (
            <span className="flex shrink-0 items-center gap-2">
              <span className="text-sm text-[var(--sb-text-secondary)]" dir="auto">{L.t("jg.playConfirm", { branch: target })}</span>
              <button type="button" className="vx-btn-primary" onClick={() => void playNow(j)}>{L.t("jg.play")}</button>
              <button type="button" className="vx-btn vx-btn-ghost" onClick={() => setArming(null)}>{L.t("common.cancel")}</button>
            </span>
          ) : (
            <button type="button" className="vx-btn shrink-0" disabled={!j.playable || !j.url || !branch.liveBranchId} title={!branch.liveBranchId ? L.t("jg.offline") : undefined} onClick={() => setArming(j.id)}>
              {L.t("jg.playNow")}
            </button>
          )}
          {isHQ && j.audience === "LOCAL" && sharing !== j.id ? (
            <button type="button" className="vx-btn vx-btn-ghost shrink-0" onClick={() => setSharing(j.id)}>{L.t("jg.share")}</button>
          ) : null}
        </>
      }
      below={
        <>
          {status[j.id] ? <p className="px-1 pb-2 text-sm text-[var(--sb-text-secondary)]" aria-live="polite">{status[j.id]}</p> : null}
          {sharing === j.id ? (
            <AudienceForm j={j} deps={deps} L={L} types={["BRAND", "REGION", "BRAND_REGION", "NETWORK"]} onDone={(changed) => { setSharing(null); if (changed) reload(); }} />
          ) : null}
        </>
      }
    />
  );

  return (
    <section className="border-t border-[color:var(--sb-border)] px-6 py-5">
      <div className="text-lg font-semibold text-[var(--sb-text)]">{L.t("jg.title")}</div>
      {error ? <p className="mt-3 text-sm text-[var(--sb-text-secondary)]">{L.t("jg.loadError")}</p> : items === null ? <p className="mt-3 text-sm text-[var(--sb-text-secondary)]">{L.t("jg.loading")}</p> : (
        <>
          <p className="vx-label mt-4">{L.t("jg.ofBranch")}</p>
          {local.length ? <ul className="mt-1 border-t border-[color:var(--vx-line)]">{local.map(row)}</ul> : <p className="mt-2 text-sm text-[var(--sb-text-tertiary)]">{L.t("jg.empty")}</p>}
          <p className="vx-label mt-6">{L.t("jg.available")}</p>
          {available.length ? <ul className="mt-1 border-t border-[color:var(--vx-line)]">{available.map(row)}</ul> : <p className="mt-2 text-sm text-[var(--sb-text-tertiary)]">{L.t("jg.empty")}</p>}
        </>
      )}
    </section>
  );
}

export function JinglesHqPanel({ deps, L, suggestion, onClose }: { deps: AudienceDeps; L: Mgmt; suggestion: AudienceDraft; onClose: () => void }) {
  const { items, error, reload } = useJingles("/api/jingles/library");
  const preview = useAudioPreview();
  const isDesktop = useIsDesktop();
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<AudienceDraft>(suggestion);
  const stopPreview = preview.stop; // stable (useCallback) — stop the local audition when the panel closes
  useEffect(() => () => stopPreview(), [stopPreview]);

  const pending = (items ?? []).filter((j) => j.audience === "UNASSIGNED");
  const library = (items ?? []).filter((j) => j.audience !== "UNASSIGNED");
  const complete = draftAudience(draft);

  const backBtn = (onClick: () => void) => (
    <button type="button" onClick={onClick} className="inline-flex h-11 w-11 items-center justify-center text-[var(--sb-text-secondary)] hover:bg-white/[0.06] hover:text-[var(--sb-text)]" aria-label={L.t("common.back")}>
      <svg className="h-4 w-4 rtl:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m15 18-6-6 6-6" /></svg>
    </button>
  );

  if (creating) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-2 border-b border-[color:var(--sb-border)] px-4 py-3">
          {backBtn(() => { setCreating(false); reload(); })}
          <h2 className="text-xl font-semibold text-[var(--sb-text)]">{L.t("jg.create")}</h2>
        </div>
        <div className="px-4 py-3">
          {/* the SAME Studio — Control Room surface: Create + the Audience card; no local On-Air / Pads / Schedule */}
          <JinglesWorkspacePanel
            onClose={() => setCreating(false)}
            controlRoom={{
              audienceCard: (
                <div className="space-y-2 pb-2">
                  <p className="vx-label">{L.t("jg.audience")}</p>
                  <AudienceEditor value={draft} onChange={setDraft} deps={deps} L={L} />
                </div>
              ),
              audience: complete,
              saveBlockedText: L.t("jg.choose"),
              onSaved: () => reload(),
            }}
          />
        </div>
      </div>
    );
  }

  const row = (j: JingleItem) => (
    <JingleRow
      key={j.id}
      j={j}
      deps={deps}
      L={L}
      preview={preview}
      isDesktop={isDesktop}
      actions={editing !== j.id ? (
        <button type="button" className="vx-btn vx-btn-ghost shrink-0" onClick={() => setEditing(j.id)}>
          {j.audience === "UNASSIGNED" ? L.t("jg.assign") : j.audience === "LOCAL" ? L.t("jg.share") : L.t("jg.audience")}
        </button>
      ) : null}
      below={editing === j.id ? (
        <AudienceForm
          j={j}
          deps={deps}
          L={L}
          types={j.audience === "LOCAL" ? ["BRAND", "REGION", "BRAND_REGION", "NETWORK"] : undefined}
          initial={j.audience === "UNASSIGNED" ? EMPTY_DRAFT : { audience: j.audience, audienceBrandId: j.audienceBrandId, audienceRegion: j.audienceRegion, audienceBranchId: j.audienceBranchId }}
          onDone={(changed) => { setEditing(null); if (changed) reload(); }}
        />
      ) : null}
    />
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-[color:var(--sb-border)] px-4 py-3">
        <div className="flex items-center gap-2">
          {backBtn(onClose)}
          <h2 className="text-xl font-semibold text-[var(--sb-text)]">{L.t("jg.title")}</h2>
        </div>
        <button type="button" className="vx-btn-primary" onClick={() => { setDraft(suggestion); setCreating(true); }}>+ {L.t("jg.create")}</button>
      </div>
      <div className="px-6 py-4">
        {error ? <p className="text-sm text-[var(--sb-text-secondary)]">{L.t("jg.loadError")}</p> : items === null ? <p className="text-sm text-[var(--sb-text-secondary)]">{L.t("jg.loading")}</p> : (
          <>
            {pending.length ? (
              <>
                <p className="vx-label">{L.t("jg.pending")}</p>
                <p className="mt-1 text-sm text-[var(--sb-text-secondary)]">{L.t("jg.pendingHint")}</p>
                <ul className="mt-2 border-t border-[color:var(--vx-line)]">{pending.map(row)}</ul>
              </>
            ) : null}
            <p className={`vx-label ${pending.length ? "mt-8" : ""}`}>{L.t("jg.library")}</p>
            {library.length ? <ul className="mt-2 border-t border-[color:var(--vx-line)]">{library.map(row)}</ul> : <p className="mt-2 text-sm text-[var(--sb-text-tertiary)]">{L.t("jg.empty")}</p>}
          </>
        )}
      </div>
    </div>
  );
}
