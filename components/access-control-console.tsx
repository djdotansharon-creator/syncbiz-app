"use client";

/**
 * Access Control Console — connected.
 *
 * Premium dark / Tesla / DJ-controller shell, wired to real APIs:
 *   • GET    /api/admin/users    — list workspace users (with status & protected flag)
 *   • POST   /api/admin/users    — create a real login-capable user
 *   • PATCH  /api/admin/users    — update access type / branches / password
 *   • DELETE /api/admin/users    — soft-disable
 *   • GET    /api/branches       — workspace branches
 *   • GET    /api/auth/me        — gate access to the console
 *
 * The previous mock seeds (owner@demo.com / branch@demo.com / branches a/b/c)
 * are gone; the visual structure (StatusStrip, ConsoleCards, PadButtons,
 * Capability pads, Branch routing bank, Live access summary) is preserved.
 */

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DeleteConfirmModal } from "@/components/delete-confirm-modal";
import type { Mgmt, MgmtKey } from "@/lib/i18n/management";
import { useMgmt } from "@/lib/i18n/use-mgmt";

// ─── Visual primitives (unchanged from the design prototype) ──────────────────

function ConsoleCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={`rounded-2xl border border-slate-800/80 bg-slate-950/50 p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.03)] ${className}`}
    >
      {children}
    </section>
  );
}

const TENANT_AUDIT_LABELS: Record<string, { key: MgmtKey; tone: "neutral" | "warn" | "danger" | "ok" }> = {
  "member.create": { key: "ac.audit.create", tone: "ok" },
  "member.invite": { key: "ac.audit.invite", tone: "ok" },
  "member.update": { key: "ac.audit.update", tone: "neutral" },
  "member.password_set": { key: "ac.audit.passwordSet", tone: "warn" },
  "member.pause": { key: "ac.audit.pause", tone: "warn" },
  "member.resume": { key: "ac.audit.resume", tone: "ok" },
  "member.remove": { key: "ac.audit.remove", tone: "danger" },
  "member.global_disable": { key: "ac.audit.globalDisable", tone: "danger" },
  "member.platform_remove": { key: "ac.audit.platformRemove", tone: "danger" },
};

function AuditToneBadge({ tone, children }: { tone: "neutral" | "warn" | "danger" | "ok"; children: ReactNode }) {
  const cls =
    tone === "ok"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
      : tone === "warn"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
        : tone === "danger"
          ? "border-rose-500/30 bg-rose-500/10 text-rose-200"
          : "border-slate-700 bg-slate-900 text-slate-300";
  return <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}>{children}</span>;
}

function fmtRelative(iso: string, tr: Mgmt["t"]): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const ms = Date.now() - t;
  const sec = Math.round(ms / 1000);
  if (sec < 45) return tr("ac.justNow");
  const min = Math.round(sec / 60);
  if (min < 60) return tr("ac.minAgo", { n: min });
  const hr = Math.round(min / 60);
  if (hr < 24) return tr("ac.hoursAgo", { n: hr });
  const day = Math.round(hr / 24);
  if (day < 14) return tr("ac.daysAgo", { n: day });
  return new Date(iso).toLocaleDateString();
}

function PadButton({
  label,
  description,
  tone = "neutral",
  active = false,
  disabled = false,
  onClick,
}: {
  label: string;
  description?: string;
  tone?: "neutral" | "protected" | "primary" | "danger";
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  const toneStyles =
    tone === "primary"
      ? {
          base: "border-sky-500/40 bg-sky-500/15 text-sky-200 shadow-[0_0_24px_rgba(56,189,248,0.12)]",
          hover: "hover:border-sky-500/50 hover:bg-sky-500/20 hover:text-sky-100",
        }
      : tone === "danger"
        ? {
            base: "border-rose-500/40 bg-rose-500/10 text-rose-200 shadow-[0_0_24px_rgba(244,63,94,0.10)]",
            hover: "hover:border-rose-500/55 hover:bg-rose-500/15 hover:text-rose-100",
          }
        : tone === "protected"
          ? {
              base: "border-amber-500/40 bg-amber-500/10 text-amber-200 shadow-[0_0_24px_rgba(245,158,11,0.10)]",
              hover: "hover:border-amber-500/55 hover:bg-amber-500/15 hover:text-amber-100",
            }
          : {
              base: "border-slate-700/80 bg-slate-900/35 text-slate-200/90",
              hover: "hover:border-slate-600/90 hover:bg-slate-800/60 hover:text-slate-100",
            };

  const activeStyles = active ? "ring-2 ring-sky-400/30 border-sky-500/55" : "";

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`w-full text-start rounded-2xl border px-4 py-4 transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-slate-400/30 focus:ring-offset-2 focus:ring-offset-slate-950 disabled:opacity-50 disabled:pointer-events-none
        ${toneStyles.base} ${toneStyles.hover} ${activeStyles}`}
      aria-pressed={active}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold tracking-tight">{label}</div>
          {description ? <div className="mt-1 text-xs text-slate-300">{description}</div> : null}
        </div>
        <span
          className={`shrink-0 inline-flex h-2.5 w-2.5 mt-1 rounded-full ${
            active ? "bg-sky-400 shadow-[0_0_14px_rgba(56,189,248,0.35)]" : "bg-slate-500"
          }`}
          aria-hidden
        />
      </div>
    </button>
  );
}

// ─── Connected types ──────────────────────────────────────────────────────────

type AccessMode = "OWNER" | "BRANCH_USER";
type Workflow = "idle" | "found" | "create";
type CapabilityState = "allowed" | "protected" | "locked" | "disabled";
type CapabilityId =
  | "VIEW_BRANCH"
  | "CONTROL_PLAYBACK"
  | "MANAGE_USERS"
  | "ASSIGN_BRANCHES"
  | "EDIT_SOURCES"
  | "EDIT_SCHEDULES"
  | "EDIT_BRANCH_RULES"
  | "PROTECTED_ACTIONS"
  | "DELETE_MEDIA";

/** Shape returned by GET /api/admin/users (matches `listUsersWithScopeForTenant`). */
type ApiUser = {
  id: string;
  email: string;
  tenantId: string;
  createdAt: string;
  name?: string;
  accessType: AccessMode;
  branchIds: string[];
  status?: "ACTIVE" | "PENDING" | "DISABLED";
  deactivatedAt?: string;
  membershipStatus?: "ACTIVE" | "SUSPENDED";
  membershipSuspendedAt?: string;
  protected?: boolean;
  tenantRemoveDeniedReason?: "WORKSPACE_OWNER" | "LAST_WORKSPACE_ADMIN";
  pauseDeniedReason?: "WORKSPACE_OWNER" | "LAST_ACTIVE_WORKSPACE_ADMIN" | "SELF";
  isGlobalSuperAdmin?: boolean;
  canRemoveFromWorkspace?: boolean;
  canPauseInWorkspace?: boolean;
};

function tenantRemoveHint(
  reason: ApiUser["tenantRemoveDeniedReason"],
  t: Mgmt["t"],
): string {
  switch (reason) {
    case "WORKSPACE_OWNER":
      return t("ac.hint.ownerNoRemove");
    case "LAST_WORKSPACE_ADMIN":
      return t("ac.hint.lastAdminNoRemove");
    default:
      return "";
  }
}

function pauseDeniedHint(
  reason: ApiUser["pauseDeniedReason"],
  isSelf: boolean,
  t: Mgmt["t"],
): string {
  if (isSelf) return t("ac.hint.selfNoPause");
  switch (reason) {
    case "WORKSPACE_OWNER":
      return t("ac.hint.ownerNoPause");
    case "LAST_ACTIVE_WORKSPACE_ADMIN":
      return t("ac.hint.lastAdminNoPause");
    case "SELF":
      return t("ac.hint.selfNoPause");
    default:
      return "";
  }
}

type BranchOption = { id: string; name: string };
type SessionSummary = { accessType?: AccessMode; branchIds?: string[]; userId?: string; email?: string };

// ─── Tiny local hook: real admin-users API client ─────────────────────────────

/** Shape returned by GET /api/admin/audit. */
type ApiAuditEvent = {
  id: string;
  action: string;
  entity: string;
  createdAt: string;
  ipAddress: string | null;
  metadata: unknown;
  actor: { id: string; email: string; name: string | null } | null;
  target: { id: string; email: string | null; name: string | null } | null;
};

function useAdminUsers(t: Mgmt["t"]) {
  // Translator held in a ref so the callbacks / bootstrap effect keep their identities (no refetch on a locale switch).
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [me, setMe] = useState<SessionSummary | null>(null);
  const [auditEvents, setAuditEvents] = useState<ApiAuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);

  const reloadAudit = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/audit?limit=50", { cache: "no-store" });
      if (!res.ok) {
        setAuditEvents([]);
        return;
      }
      const json = await res.json();
      setAuditEvents(Array.isArray(json) ? (json as ApiAuditEvent[]) : []);
    } catch {
      setAuditEvents([]);
    }
  }, []);

  const reload = useCallback(async () => {
    const [usersRes, branchesRes] = await Promise.all([
      fetch("/api/admin/users", { cache: "no-store" }),
      fetch("/api/branches", { cache: "no-store" }),
    ]);
    const usersJson = usersRes.ok ? await usersRes.json() : [];
    const branchesJson = branchesRes.ok ? await branchesRes.json() : [];
    setUsers(Array.isArray(usersJson) ? usersJson : []);
    const opts: BranchOption[] = Array.isArray(branchesJson)
      ? branchesJson
          .filter((b: unknown): b is { id: string; name: string } => {
            return !!b && typeof (b as { id?: unknown }).id === "string" && typeof (b as { name?: unknown }).name === "string";
          })
          .map((b) => ({ id: b.id, name: b.name }))
      : [];
    if (opts.length > 0 && !opts.some((b) => b.id === "default")) {
      opts.unshift({ id: "default", name: tRef.current("ac.defaultLegacy") });
    }
    setBranches(opts.length > 0 ? opts : [{ id: "default", name: tRef.current("ac.defaultLegacy") }]);
    // Audit log refresh runs in parallel-ish; failure here is non-fatal so we
    // do not block the rest of the console on it.
    void reloadAudit();
  }, [reloadAudit]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const meRes = await fetch("/api/auth/me", { cache: "no-store" });
        const meJson: SessionSummary = meRes.ok ? await meRes.json() : {};
        if (cancelled) return;
        setMe(meJson);
        // Only OWNER-scope sessions can see /api/admin/users; load conditionally.
        if (meJson.accessType === "OWNER") {
          await reload();
        }
      } catch {
        if (!cancelled) setBootstrapError(tRef.current("ac.loadStateError"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const createUser = useCallback(
    async (params: { email: string; password: string; accessType: AccessMode; branchIds: string[] }) => {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: params.email,
          password: params.password,
          accessType: params.accessType,
          branchIds: params.accessType === "BRANCH_USER" ? params.branchIds : undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
      if (!res.ok) throw new Error(data.error ?? tRef.current("ac.createFailed", { status: res.status }));
      await reload();
      return data;
    },
    [reload],
  );

  const updateUser = useCallback(
    async (params: {
      email: string;
      name?: string;
      accessType: AccessMode;
      branchIds: string[];
      newPassword?: string;
    }) => {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: params.email,
          name: params.name,
          accessType: params.accessType,
          branchIds: params.accessType === "BRANCH_USER" ? params.branchIds : undefined,
          ...(params.newPassword && params.newPassword.length >= 6 ? { newPassword: params.newPassword } : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? tRef.current("ac.updateFailed", { status: res.status }));
      await reload();
      return data;
    },
    [reload],
  );

  const pauseMembership = useCallback(
    async (email: string) => {
      const res = await fetch("/api/admin/users/pause-member", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
      if (!res.ok) throw new Error(data.error ?? tRef.current("ac.disableFailed", { status: res.status }));
      await reload();
      return data;
    },
    [reload],
  );

  const resumeMembership = useCallback(
    async (email: string) => {
      const res = await fetch("/api/admin/users/resume-member", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
      if (!res.ok) throw new Error(data.error ?? tRef.current("ac.activateFailed", { status: res.status }));
      await reload();
      return data;
    },
    [reload],
  );

  const removeFromWorkspace = useCallback(
    async (email: string) => {
      const res = await fetch("/api/admin/users/remove-member", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
      if (!res.ok) throw new Error(data.error ?? tRef.current("ac.removeFailed", { status: res.status }));
      await reload();
      return data;
    },
    [reload],
  );

  return { users, branches, me, auditEvents, loading, bootstrapError, reload, reloadAudit, createUser, updateUser, pauseMembership, resumeMembership, removeFromWorkspace };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AccessControlConsole() {
  const L = useMgmt();
  const { users, branches, me, auditEvents, loading, bootstrapError, reload, reloadAudit, createUser, updateUser, pauseMembership, resumeMembership, removeFromWorkspace } = useAdminUsers(L.t);

  const [unlocked, setUnlocked] = useState(false);
  const [workflow, setWorkflow] = useState<Workflow>("idle");
  const [lookupEmail, setLookupEmail] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "create" | "apply" | "disable" | "activate" | "remove">(null);
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const [selectedUserEmail, setSelectedUserEmail] = useState<string | null>(null);
  const selectedUser = useMemo(
    () => (selectedUserEmail ? users.find((u) => u.email.toLowerCase() === selectedUserEmail.toLowerCase()) ?? null : null),
    [users, selectedUserEmail],
  );

  const [accessMode, setAccessMode] = useState<AccessMode>("OWNER");
  const [selectedBranchIds, setSelectedBranchIds] = useState<string[]>([]);
  const [createForm, setCreateForm] = useState<{ name: string; email: string; password: string }>({
    name: "",
    email: "",
    password: "",
  });

  const [pendingSensitive, setPendingSensitive] = useState<CapabilityId | null>(null);

  // Capability matrix is purely informational: derived from the access type
  // we are configuring; backend has no per-capability ACL yet.
  const capabilityGroups = useMemo(
    () => [
      {
        group: L.t("ac.cap.userMgmt"),
        hint: L.t("ac.cap.userMgmtHint"),
        items: [
          { id: "MANAGE_USERS" as const, label: L.t("ac.cap.manageUsers"), description: L.t("ac.cap.manageUsersDesc") },
          { id: "EDIT_BRANCH_RULES" as const, label: L.t("ac.cap.editBranchRules"), description: L.t("ac.cap.editBranchRulesDesc") },
        ],
      },
      {
        group: L.t("ac.cap.branchAccess"),
        hint: L.t("ac.cap.branchAccessHint"),
        items: [
          { id: "VIEW_BRANCH" as const, label: L.t("ac.cap.viewBranch"), description: L.t("ac.cap.viewBranchDesc") },
          { id: "ASSIGN_BRANCHES" as const, label: L.t("ac.cap.assignBranches"), description: L.t("ac.cap.assignBranchesDesc") },
        ],
      },
      {
        group: L.t("ac.cap.playback"),
        hint: L.t("ac.cap.playbackHint"),
        items: [
          { id: "CONTROL_PLAYBACK" as const, label: L.t("ac.cap.controlPlayback"), description: L.t("ac.cap.controlPlaybackDesc") },
          { id: "EDIT_SOURCES" as const, label: L.t("ac.cap.editSources"), description: L.t("ac.cap.editSourcesDesc") },
          { id: "EDIT_SCHEDULES" as const, label: L.t("ac.cap.editSchedules"), description: L.t("ac.cap.editSchedulesDesc") },
        ],
      },
      {
        group: L.t("ac.cap.sensitive"),
        hint: L.t("ac.cap.sensitiveHint"),
        items: [
          { id: "PROTECTED_ACTIONS" as const, label: L.t("ac.cap.protectedActions"), description: L.t("ac.cap.protectedActionsDesc") },
          { id: "DELETE_MEDIA" as const, label: L.t("ac.cap.deleteMedia"), description: L.t("ac.cap.deleteMediaDesc") },
        ],
      },
    ],
    [L],
  );

  const branchScopeInvalid = accessMode === "BRANCH_USER" && selectedBranchIds.length === 0;
  /**
   * Membership-paused (workspace-scoped). Distinct from `selectedUser.status`,
   * which is the global User.status (managed only by Platform Admin).
   */
  const membershipSuspended =
    workflow === "found" && selectedUser?.membershipStatus === "SUSPENDED";
  const userIsDisabled = workflow === "found" && selectedUser?.status === "DISABLED";
  const isSelfTarget =
    workflow === "found" && !!selectedUser && me?.userId === selectedUser.id;
  /** True when this row's workspace-scoped pause is server-blocked (e.g. owner, last admin, self). */
  const pauseInWorkspaceBlocked =
    workflow === "found" && (
      selectedUser?.canPauseInWorkspace === false || isSelfTarget
    );

  const selectedBranchNames = useMemo(() => {
    if (accessMode === "OWNER") return L.t("ac.allBranches");
    if (selectedBranchIds.length === 0) return L.t("ac.noneScopeRequired");
    const names = selectedBranchIds.map((id) => branches.find((b) => b.id === id)?.name ?? id);
    return names.join(", ");
  }, [L, accessMode, branches, selectedBranchIds]);

  const capabilityState = useMemo(() => {
    if (!unlocked || !selectedUser) {
      return new Map<CapabilityId, CapabilityState>(
        capabilityGroups.flatMap((g) => g.items.map((i) => [i.id, "locked" as const])),
      );
    }
    const isOwner = accessMode === "OWNER";
    const map = new Map<CapabilityId, CapabilityState>();
    map.set("MANAGE_USERS", isOwner ? "allowed" : "disabled");
    map.set("EDIT_BRANCH_RULES", isOwner ? "protected" : "locked");
    map.set("VIEW_BRANCH", "allowed");
    map.set("ASSIGN_BRANCHES", isOwner ? "allowed" : "protected");
    map.set("CONTROL_PLAYBACK", "allowed");
    map.set("EDIT_SOURCES", "allowed");
    map.set("EDIT_SCHEDULES", isOwner ? "allowed" : "locked");
    map.set("PROTECTED_ACTIONS", isOwner ? "protected" : "locked");
    map.set("DELETE_MEDIA", isOwner ? "protected" : "locked");
    if (accessMode === "BRANCH_USER" && branchScopeInvalid) {
      map.set("ASSIGN_BRANCHES", "locked");
      map.set("VIEW_BRANCH", "protected");
      map.set("CONTROL_PLAYBACK", "protected");
      map.set("EDIT_SOURCES", "protected");
      map.set("EDIT_SCHEDULES", "locked");
    }
    return map;
  }, [accessMode, branchScopeInvalid, capabilityGroups, selectedUser, unlocked]);

  // ─── Helpers ────────────────────────────────────────────────────────────────

  const normalizeEmail = (v: string) => v.trim().toLowerCase();

  const adoptUserIntoForm = useCallback((u: ApiUser) => {
    setSelectedUserEmail(u.email);
    setAccessMode(u.accessType);
    setSelectedBranchIds(u.accessType === "OWNER" ? [] : [...u.branchIds]);
  }, []);

  const doLookup = () => {
    if (!unlocked) return;
    const email = normalizeEmail(lookupEmail);
    if (!email) return;
    const found = users.find((u) => u.email.toLowerCase() === email);
    if (!found) {
      setWorkflow("create");
      setSelectedUserEmail(null);
      setAccessMode("BRANCH_USER");
      setSelectedBranchIds([]);
      setCreateForm({ name: "", email, password: "" });
      setToast(null);
      return;
    }
    setWorkflow("found");
    adoptUserIntoForm(found);
    setToast(null);
  };

  const handleCreateUser = async () => {
    if (!unlocked) return;
    if (busy) return;
    const email = normalizeEmail(createForm.email);
    if (!email || !email.includes("@")) {
      setToast(L.t("ac.toast.validEmail"));
      return;
    }
    if (!createForm.password || createForm.password.length < 6) {
      setToast(L.t("ac.toast.passwordMin"));
      return;
    }
    setBusy("create");
    try {
      await createUser({
        email,
        password: createForm.password,
        accessType: "BRANCH_USER",
        branchIds: [],
      });
      setToast(L.t("ac.toast.userCreated", { email }));
      setSelectedUserEmail(email);
      setAccessMode("BRANCH_USER");
      setSelectedBranchIds([]);
      setCreateForm({ name: "", email: "", password: "" });
      setWorkflow("found");
    } catch (e) {
      setToast(e instanceof Error ? e.message : L.t("ac.toast.createFailed"));
    } finally {
      setBusy(null);
    }
  };

  const handleApplyAccess = async () => {
    if (!unlocked || !selectedUser || busy) return;
    if (accessMode === "BRANCH_USER" && selectedBranchIds.length === 0) {
      setToast(L.t("ac.toast.scopeRequired"));
      return;
    }
    setBusy("apply");
    try {
      await updateUser({
        email: selectedUser.email,
        name: selectedUser.name,
        accessType: accessMode,
        branchIds: selectedBranchIds,
      });
      setToast(L.t("ac.toast.accessUpdated"));
    } catch (e) {
      setToast(e instanceof Error ? e.message : L.t("ac.toast.updateFailed"));
    } finally {
      setBusy(null);
    }
  };

  const handleDisable = async () => {
    if (!unlocked || !selectedUser || busy) return;
    if (pauseInWorkspaceBlocked) {
      setToast(pauseDeniedHint(selectedUser.pauseDeniedReason, isSelfTarget, L.t) || L.t("ac.toast.cannotPause"));
      return;
    }
    setBusy("disable");
    try {
      await pauseMembership(selectedUser.email);
      setToast(L.t("ac.toast.paused", { email: selectedUser.email }));
    } catch (e) {
      setToast(e instanceof Error ? e.message : L.t("ac.toast.pauseFailed"));
    } finally {
      setBusy(null);
    }
  };

  const openRemoveConfirm = () => {
    if (!unlocked || !selectedUser || busy) return;
    if (selectedUser.canRemoveFromWorkspace === false) {
      setToast(tenantRemoveHint(selectedUser.tenantRemoveDeniedReason, L.t) || L.t("ac.toast.cannotRemove"));
      return;
    }
    setRemoveError(null);
    setRemoveConfirmOpen(true);
  };

  const performRemoveFromWorkspace = async () => {
    if (!unlocked || !selectedUser) return;
    setBusy("remove");
    setRemoveError(null);
    try {
      await removeFromWorkspace(selectedUser.email);
      setRemoveConfirmOpen(false);
      setToast(L.t("ac.toast.removed", { email: selectedUser.email }));
      setWorkflow("idle");
      setSelectedUserEmail(null);
      setLookupEmail("");
    } catch (e) {
      setRemoveError(e instanceof Error ? e.message : L.t("ac.toast.removeFailed"));
      throw e; // keep modal open
    } finally {
      setBusy(null);
    }
  };

  const handleActivate = async () => {
    // Resume a paused workspace membership. Idempotent for ACTIVE rows.
    // (Global `User.status` reactivation lives in Platform Admin and is handled
    //  via PATCH side-effects in updateUser.)
    if (!unlocked || !selectedUser || busy) return;
    setBusy("activate");
    try {
      if (selectedUser.membershipStatus === "SUSPENDED") {
        await resumeMembership(selectedUser.email);
        setToast(L.t("ac.toast.reactivated", { email: selectedUser.email }));
      } else {
        // No-op when already active in workspace; PATCH still useful if `User.status`
        // was DISABLED globally (interpreted as un-disable inside updateUser).
        await updateUser({
          email: selectedUser.email,
          name: selectedUser.name,
          accessType: selectedUser.accessType,
          branchIds: selectedUser.accessType === "BRANCH_USER" ? selectedUser.branchIds : [],
        });
        setToast(L.t("ac.toast.active", { email: selectedUser.email }));
      }
    } catch (e) {
      setToast(e instanceof Error ? e.message : L.t("ac.toast.activateFailed"));
    } finally {
      setBusy(null);
    }
  };

  // After every reload, keep the selected user in sync with refreshed data.
  useEffect(() => {
    if (workflow !== "found" || !selectedUserEmail) return;
    const fresh = users.find((u) => u.email.toLowerCase() === selectedUserEmail.toLowerCase());
    if (!fresh) return;
    setAccessMode(fresh.accessType);
    if (fresh.accessType === "OWNER") setSelectedBranchIds([]);
    else if (selectedBranchIds.length === 0) setSelectedBranchIds([...fresh.branchIds]);
  }, [users, workflow, selectedUserEmail, selectedBranchIds.length]);

  // ─── Visual sub-components ──────────────────────────────────────────────────

  const formatBranchCount = (ids: string[]) => {
    if (accessMode === "OWNER") return L.t("ac.scopeCount", { n: branches.length });
    return L.t("ac.selectedCount", { n: ids.length });
  };

  const stateLabel = (state: CapabilityState) => {
    if (state === "allowed") return L.t("ac.state.enabled");
    if (state === "protected") return L.t("ac.state.protected");
    if (state === "disabled") return L.t("ac.state.disabled");
    return L.t("ac.state.locked");
  };

  const badgeTone = (state: CapabilityState) => {
    if (state === "allowed") return "border-emerald-500/25 bg-emerald-500/10 text-emerald-200";
    if (state === "protected") return "border-amber-500/25 bg-amber-500/10 text-amber-200";
    if (state === "disabled") return "border-slate-800/80 bg-slate-900/30 text-slate-400";
    return "border-slate-800/80 bg-slate-900/30 text-slate-500";
  };

  const ledClasses = (tone: "green" | "amber" | "red") => {
    if (tone === "green") return "bg-emerald-400 shadow-[0_0_18px_rgba(52,211,153,0.35)]";
    if (tone === "red") return "bg-rose-400 shadow-[0_0_18px_rgba(244,63,94,0.30)]";
    return "bg-amber-400 shadow-[0_0_18px_rgba(245,158,11,0.28)]";
  };

  const capabilityScopeText = (id: CapabilityId) => {
    if (!unlocked) return L.t("ac.scope.lockedConsole");
    if (!selectedUser) return L.t("ac.scope.openUser");
    if (accessMode === "OWNER") {
      if (id === "VIEW_BRANCH") return L.t("ac.scope.allBranches");
      if (id === "ASSIGN_BRANCHES") return L.t("ac.scope.routeAll");
      return L.t("ac.scope.fullTenant");
    }
    if (branchScopeInvalid) return L.t("ac.scope.notConfigured");
    if (userIsDisabled) return L.t("ac.scope.userDisabled");
    const names = selectedBranchIds.map((bid) => branches.find((b) => b.id === bid)?.name).filter(Boolean);
    if (id === "VIEW_BRANCH") return L.t("ac.scope.names", { names: names.join(", ") });
    if (id === "ASSIGN_BRANCHES") return L.t("ac.scope.assignWithin", { names: names.join(", ") });
    return L.t("ac.scope.names", { names: names.join(", ") });
  };

  const StatusStrip = () => {
    const branchesOnline = branches.length;
    const activeUsers = users.filter((u) => u.status !== "DISABLED").length;
    const totalUsers = users.length;
    // the first row: flat counters (owner 2026-10-20 — no frame, no box): the title above, the value below, the LED beside the title
    const item = (tone: "green" | "amber", label: string, value: ReactNode, dirAttr?: "ltr") => (
      <div className="cr-stat cr-stat--static">
        <span className="cr-stat-label">
          <span className={`inline-flex h-2 w-2 rounded-full ${ledClasses(tone)}`} aria-hidden />
          {label}
        </span>
        <span className="cr-stat-value cr-stat-value--text" dir={dirAttr}>{value}</span>
      </div>
    );
    return (
      <div className="cr-stats grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {item("green", L.t("ac.strip.branches"), branchesOnline, "ltr")}
        {item(unlocked ? "green" : "amber", L.t("ac.strip.console"), unlocked ? L.t("ac.strip.unlocked") : L.t("ac.state.locked"))}
        {item(unlocked ? "green" : "amber", L.t("ac.strip.activeUsers"), `${activeUsers}/${totalUsers}`, "ltr")}
        {item(unlocked ? "green" : "amber", L.t("ac.strip.signedInAs"), me?.email ?? "—", "ltr")}
      </div>
    );
  };

  const CapabilityPad = ({
    id,
    label,
    description,
  }: {
    id: CapabilityId;
    label: string;
    description: string;
  }) => {
    const rawState = capabilityState.get(id) ?? "locked";
    const state: CapabilityState = userIsDisabled ? "disabled" : rawState;
    return (
      <div
        role="note"
        aria-label={L.t("ac.capAria", { label })}
        className={`group w-full cursor-default select-none rounded-2xl border px-4 py-4 text-start transition-all duration-150
          ${state === "allowed" ? "border-sky-500/35 bg-slate-900/25" : ""}
          ${state === "protected" ? "border-amber-500/35 bg-amber-500/5" : ""}
          ${state === "locked" || state === "disabled" ? "border-slate-800/80 bg-slate-900/30" : ""}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-100">{label}</div>
            <div className="mt-1 text-xs text-slate-400">{description}</div>
          </div>
          <div className={`shrink-0 rounded-lg border px-3 py-1 text-[11px] font-semibold ${badgeTone(state)}`}>
            {stateLabel(state)}
          </div>
        </div>
        <div className="mt-3 text-[11px] text-slate-500">{capabilityScopeText(id)}</div>
      </div>
    );
  };

  const BranchCard = ({ id, name }: { id: string; name: string }) => {
    const assigned = accessMode === "OWNER" ? true : selectedBranchIds.includes(id);
    const tone = userIsDisabled
      ? "border-slate-800/80 bg-slate-900/30 text-slate-500"
      : assigned
        ? "border-emerald-500/35 bg-emerald-500/5 text-emerald-200"
        : branchScopeInvalid
          ? "border-slate-800/80 bg-slate-900/30 text-slate-500"
          : "border-amber-500/35 bg-amber-500/5 text-amber-200";

    const body = (
      <>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-100" dir="auto">{name}</div>
            <div className="mt-1 text-xs text-slate-400">
              {userIsDisabled
                ? L.t("ac.branch.userDisabled")
                : assigned
                  ? accessMode === "OWNER"
                    ? L.t("ac.branch.fullNetwork")
                    : L.t("ac.branch.assigned")
                  : branchScopeInvalid
                    ? L.t("ac.state.locked")
                    : L.t("ac.branch.available")}
            </div>
          </div>
          <span
            className={`shrink-0 inline-flex h-2.5 w-2.5 rounded-full ${assigned ? "bg-emerald-400" : "bg-amber-400"} `}
            aria-hidden
          />
        </div>
      </>
    );

    if (accessMode === "OWNER") {
      return (
        <div
          role="note"
          className={`h-full cursor-default select-none rounded-2xl border px-4 py-4 text-start ${tone}`}
        >
          {body}
        </div>
      );
    }

    return (
      <button
        type="button"
        disabled={!unlocked || userIsDisabled}
        onClick={() => {
          if (!unlocked || accessMode !== "BRANCH_USER") return;
          setSelectedBranchIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
          setToast(null);
        }}
        className={`h-full rounded-2xl border px-4 py-4 text-start transition-all hover:border-slate-600/90 disabled:opacity-60 disabled:hover:border-current ${tone}`}
      >
        {body}
      </button>
    );
  };

  const lookupDisabled = !unlocked;

  // ─── Loading + access gating ────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-6" dir={L.dir}>
        <div className="rounded-2xl border border-slate-800/80 bg-slate-950/50 p-5">
          <div className="text-sm text-slate-300">{L.t("ac.loading")}</div>
        </div>
      </div>
    );
  }

  if (bootstrapError) {
    return (
      <div className="space-y-6" dir={L.dir}>
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-5">
          <div className="text-sm font-semibold text-rose-200">{L.t("ac.unavailable")}</div>
          <div className="mt-1 text-xs text-rose-100/80">{bootstrapError}</div>
        </div>
      </div>
    );
  }

  if (me?.accessType !== "OWNER") {
    return (
      <div className="space-y-6" dir={L.dir}>
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5">
          <div className="text-sm font-semibold text-amber-200">{L.t("ac.ownerRequired")}</div>
          <div className="mt-1 text-xs text-amber-100/80">
            {L.t("ac.ownerOnly")} {L.t("ac.sessionPre")}{" "}
            <span className="font-semibold">{me?.accessType ?? L.t("ac.guest")}</span>{L.t("ac.sessionPost")}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6" dir={L.dir}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-50">{L.t("ac.title")}</h1>
          <p className="mt-0.5 text-xs text-slate-400">
            {L.t("ac.subtitle")}
          </p>
        </div>

        {!unlocked ? (
          <button
            type="button"
            onClick={() => setUnlocked(true)}
            className="rounded-xl border border-amber-500/50 bg-amber-500/10 px-4 py-2 text-sm font-semibold text-amber-200 shadow-[0_0_24px_rgba(245,158,11,0.10)] hover:bg-amber-500/15 hover:border-amber-500/60 transition-all"
          >
            {L.t("ac.unlock")}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              setUnlocked(false);
              setWorkflow("idle");
              setSelectedUserEmail(null);
              setSelectedBranchIds([]);
              setLookupEmail("");
              setToast(null);
            }}
            className="rounded-xl border border-slate-700/80 bg-slate-900/30 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800/60 hover:border-slate-600/90 transition-all"
          >
            {L.t("ac.lock")}
          </button>
        )}
      </div>

      {/* Single stacked column — the console lives inside the workspace CENTER
          pane (rails on both sides), so it must NOT run its own wide-page 8/4
          split (that cramped it to half width). Opens like Settings. */}
      <div className="space-y-4">
        <div className="space-y-4">
          <StatusStrip />

          {!unlocked ? (
            <ConsoleCard>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="text-sm font-semibold text-slate-100">{L.t("ac.protectedRequired")}</div>
                  <div className="mt-1 text-xs text-slate-400">
                    {L.t("ac.unlockHint")}
                  </div>
                </div>
                <div className="text-xs text-slate-400">{L.t("ac.tip")}</div>
              </div>
              <div className="cr-stats mt-3 grid gap-2 sm:grid-cols-3">
                <div className="cr-stat cr-stat--static">
                  <span className="cr-stat-label">{L.t("ac.accessEngine")}</span>
                  <span className="cr-stat-value cr-stat-value--text cr-stat-value--warn">{L.t("ac.state.protected")}</span>
                </div>
                <div className="cr-stat cr-stat--static">
                  <span className="cr-stat-label">{L.t("ac.capabilityLayer")}</span>
                  <span className="cr-stat-value cr-stat-value--text">{L.t("ac.state.locked")}</span>
                </div>
                <div className="cr-stat cr-stat--static">
                  <span className="cr-stat-label">{L.t("ac.scopeRouting")}</span>
                  <span className="cr-stat-value cr-stat-value--text">{L.t("ac.hidden")}</span>
                </div>
              </div>
            </ConsoleCard>
          ) : null}

          {unlocked && workflow === "idle" ? (
            <ConsoleCard>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold text-slate-100">{L.t("ac.entry.title")}</div>
                  <div className="mt-1 text-xs text-slate-400">
                    {L.t("ac.entry.hint")}
                  </div>
                </div>
                <div className="text-[11px] text-slate-500">
                  {L.t("ac.workspaceUsersLabel")} <span className="text-slate-200 font-semibold" dir="ltr">{users.length}</span>
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-500">{L.t("ac.email")}</label>
                  <input
                    value={lookupEmail}
                    onChange={(e) => setLookupEmail(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && lookupEmail.trim()) doLookup();
                    }}
                    className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm text-slate-200 outline-none focus:border-sky-500/50"
                    placeholder="user@company.com"
                    inputMode="email"
                    dir="ltr"
                  />
                </div>
                <div className="sm:pt-5">
                  <button
                    type="button"
                    onClick={doLookup}
                    disabled={lookupDisabled || !lookupEmail.trim()}
                    className="w-full rounded-xl border border-sky-500/40 bg-sky-500/10 px-4 py-2.5 text-sm font-semibold text-sky-200 hover:bg-sky-500/15 hover:border-sky-500/60 disabled:opacity-60 disabled:pointer-events-none transition-all"
                  >
                    {L.t("ac.findUser")}
                  </button>
                </div>
              </div>

              {users.length === 0 ? (
                <div className="mt-4 rounded-xl border border-slate-800/80 bg-slate-900/25 p-3 text-xs text-slate-400">
                  {L.t("ac.noUsersPre")} <span className="text-slate-200 font-semibold">{L.t("ac.findUser")}</span> {L.t("ac.noUsersPost")}
                </div>
              ) : (
                <div className="mt-4 rounded-xl border border-slate-800/80 bg-slate-900/25 p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{L.t("ac.recentUsers")}</div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {users.slice(0, 6).map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => {
                          setLookupEmail(u.email);
                          setWorkflow("found");
                          adoptUserIntoForm(u);
                          setToast(null);
                        }}
                        className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/30 px-3 py-2 text-start text-xs text-slate-200 hover:border-slate-600 hover:bg-slate-800/40 transition-all"
                      >
                        <span className="truncate">
                          <span className="font-semibold" dir="auto">{u.name?.trim() || u.email}</span>
                          <span className="text-slate-500"> · {u.accessType === "OWNER" ? L.t("ac.owner") : L.t("ac.branchUser")}</span>
                        </span>
                        {u.status === "DISABLED" ? (
                          <span className="shrink-0 rounded-md border border-rose-500/30 bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-rose-200">
                            {L.t("ac.state.disabled")}
                          </span>
                        ) : u.protected ? (
                          <span className="shrink-0 rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-200">
                            {L.t("ac.state.protected")}
                          </span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </ConsoleCard>
          ) : null}

          {unlocked && workflow === "create" ? (
            <ConsoleCard>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold text-slate-100">{L.t("ac.create.title")}</div>
                  <div className="mt-1 text-xs text-slate-400">
                    {L.t("ac.create.hint")}
                  </div>
                </div>
                <div className="text-[11px] text-slate-500">
                  {L.t("ac.emailLabel")} <span className="text-slate-200 font-semibold" dir="ltr">{createForm.email || "—"}</span>
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-500">{L.t("ac.displayName")}</label>
                  <input
                    value={createForm.name}
                    onChange={(e) => setCreateForm((p) => ({ ...p, name: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm text-slate-200 outline-none focus:border-sky-500/50"
                    placeholder={L.t("ac.fullName")}
                    dir="auto"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500">{L.t("ac.email")}</label>
                  <input
                    value={createForm.email}
                    onChange={(e) => setCreateForm((p) => ({ ...p, email: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm text-slate-200 outline-none focus:border-sky-500/50"
                    placeholder="user@company.com"
                    inputMode="email"
                    dir="ltr"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-500">{L.t("ac.passwordLabel")}</label>
                  <input
                    type="password"
                    value={createForm.password}
                    onChange={(e) => setCreateForm((p) => ({ ...p, password: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm text-slate-200 outline-none focus:border-sky-500/50"
                    placeholder={L.t("ac.passwordPlaceholder")}
                    dir="ltr"
                    autoComplete="new-password"
                  />
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setWorkflow("idle");
                    setSelectedUserEmail(null);
                    setLookupEmail(createForm.email);
                    setCreateForm({ name: "", email: createForm.email, password: "" });
                    setToast(null);
                  }}
                  className="rounded-xl border border-slate-800/80 bg-slate-900/30 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-slate-800/60 hover:border-slate-600/90 transition-all"
                >
                  {L.t("ac.backToLookup")}
                </button>
                <button
                  type="button"
                  onClick={handleCreateUser}
                  disabled={
                    busy === "create" ||
                    !createForm.email.trim() ||
                    !createForm.password ||
                    createForm.password.length < 6
                  }
                  className="rounded-xl border border-sky-500/40 bg-sky-500/10 px-4 py-2.5 text-sm font-semibold text-sky-200 hover:bg-sky-500/15 hover:border-sky-500/60 disabled:opacity-60 disabled:pointer-events-none transition-all"
                >
                  {busy === "create" ? L.t("ac.creating") : L.t("ac.createUser")}
                </button>
              </div>

              <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-200/80">{L.t("ac.nextStep")}</div>
                <div className="mt-1 text-xs text-amber-100">
                  {L.t("ac.nextStepPre")} <span className="font-semibold">{L.t("ac.branchUser")}</span>{L.t("ac.nextStepPost")}
                </div>
              </div>
            </ConsoleCard>
          ) : null}

          {unlocked && workflow === "found" && selectedUser ? (
            <div className="space-y-4">
              <ConsoleCard>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="text-sm font-semibold text-slate-100">{L.t("ac.target.title")}</div>
                    <div className="mt-1 text-xs text-slate-400">
                      {L.t("ac.target.hint")}
                    </div>
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {L.t("ac.statusLabel")}{" "}
                    <span className="text-slate-200 font-semibold">
                      {selectedUser.status === "DISABLED"
                        ? L.t("ac.state.disabled")
                        : selectedUser.status === "PENDING"
                          ? L.t("ac.status.pending")
                          : L.t("ac.status.active")}
                    </span>
                    {selectedUser.protected ? (
                      <span className="ms-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-200">
                        {L.t("ac.state.protected")}
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-100 truncate" dir="auto">{selectedUser.name?.trim() || "—"}</div>
                    <div className="mt-1 text-xs text-slate-400 truncate" dir="ltr">{selectedUser.email}</div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 w-full sm:w-[420px]">
                    <PadButton
                      label={L.t("ac.fullNetwork")}
                      description={L.t("ac.fullNetworkDesc")}
                      tone="primary"
                      active={accessMode === "OWNER"}
                      disabled={!unlocked || userIsDisabled}
                      onClick={() => {
                        setAccessMode("OWNER");
                        setSelectedBranchIds([]);
                        setToast(null);
                      }}
                    />
                    <PadButton
                      label={L.t("ac.assignedScope")}
                      description={L.t("ac.assignedScopeDesc")}
                      tone="neutral"
                      active={accessMode === "BRANCH_USER"}
                      disabled={!unlocked || userIsDisabled}
                      onClick={() => {
                        setAccessMode("BRANCH_USER");
                        setSelectedBranchIds([]);
                        setToast(null);
                      }}
                    />
                  </div>
                </div>

                {branchScopeInvalid ? (
                  <div className="mt-4 rounded-xl border border-amber-500/35 bg-amber-500/10 p-3">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-200/80">{L.t("ac.protectedConstraint")}</div>
                    <div className="mt-1 text-xs text-amber-100">
                      {L.t("ac.constraintHint")}
                    </div>
                  </div>
                ) : null}
              </ConsoleCard>

              <ConsoleCard>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="text-sm font-semibold text-slate-100">{L.t("ac.userStatus")}</div>
                    <div className="mt-1 text-xs text-slate-400">
                      <strong className="font-semibold text-slate-300">{L.t("ac.status.active")}</strong>{L.t("ac.us.activeDesc")}{" "}
                      <strong className="font-semibold text-slate-300">{L.t("ac.us.disable")}</strong>{L.t("ac.us.disableDesc")}{" "}
                      <strong className="font-semibold text-slate-300">{L.t("ac.us.remove")}</strong>{L.t("ac.us.removeDesc")}
                    </div>
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {L.t("ac.currentLabel")}{" "}
                    <span className="text-slate-200 font-semibold">
                      {selectedUser.status === "DISABLED"
                        ? L.t("ac.loginDisabled")
                        : membershipSuspended
                          ? L.t("ac.pausedInWorkspace")
                          : L.t("ac.status.active")}
                    </span>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <PadButton
                    label={busy === "activate" ? L.t("ac.activating") : L.t("ac.status.active")}
                    description={
                      membershipSuspended
                        ? L.t("ac.pad.resume")
                        : userIsDisabled
                          ? L.t("ac.pad.globallyDisabled")
                          : L.t("ac.pad.identityEnabled")
                    }
                    tone="primary"
                    active={!membershipSuspended && !userIsDisabled}
                    disabled={
                      !unlocked ||
                      busy !== null ||
                      (!membershipSuspended && !userIsDisabled)
                    }
                    onClick={handleActivate}
                  />
                  <PadButton
                    label={busy === "disable" ? L.t("ac.disabling") : L.t("ac.us.disable")}
                    description={
                      pauseInWorkspaceBlocked
                        ? pauseDeniedHint(selectedUser.pauseDeniedReason, isSelfTarget, L.t) || L.t("ac.pad.cannotDisable")
                        : membershipSuspended
                          ? L.t("ac.pad.alreadyPaused")
                          : L.t("ac.pad.pauseDesc")
                    }
                    tone="protected"
                    active={membershipSuspended === true}
                    disabled={
                      !unlocked ||
                      busy !== null ||
                      membershipSuspended === true ||
                      pauseInWorkspaceBlocked
                    }
                    onClick={handleDisable}
                  />
                  <PadButton
                    label={busy === "remove" ? L.t("ac.removing") : L.t("ac.us.remove")}
                    description={
                      selectedUser.canRemoveFromWorkspace === false
                        ? tenantRemoveHint(selectedUser.tenantRemoveDeniedReason, L.t) || L.t("ac.pad.cannotRemove")
                        : L.t("ac.pad.removeDesc")
                    }
                    tone="danger"
                    active={false}
                    disabled={
                      !unlocked ||
                      busy !== null ||
                      selectedUser.canRemoveFromWorkspace === false
                    }
                    onClick={openRemoveConfirm}
                  />
                </div>

                {(membershipSuspended || pauseInWorkspaceBlocked || selectedUser.canRemoveFromWorkspace === false) ? (
                  <div className="mt-3 rounded-xl border border-slate-700/40 bg-slate-900/40 p-3 text-[11px] leading-snug text-slate-400">
                    {membershipSuspended ? (
                      <div className="text-amber-200/85">
                        {L.t("ac.pausedNote")}
                        {selectedUser.membershipSuspendedAt
                          ? L.t("ac.pausedSince", { date: new Date(selectedUser.membershipSuspendedAt).toLocaleDateString() })
                          : ""}
                        {L.t("ac.pausedNoteMid")} <strong>{L.t("ac.status.active")}</strong> {L.t("ac.pausedNotePost")}
                      </div>
                    ) : null}
                    {pauseInWorkspaceBlocked ? (
                      <div>{pauseDeniedHint(selectedUser.pauseDeniedReason, isSelfTarget, L.t)}</div>
                    ) : null}
                    {selectedUser.canRemoveFromWorkspace === false ? (
                      <div>{tenantRemoveHint(selectedUser.tenantRemoveDeniedReason, L.t)}</div>
                    ) : null}
                  </div>
                ) : null}
              </ConsoleCard>

              <ConsoleCard>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-sm font-semibold text-slate-100">{L.t("ac.capPads")}</div>
                    <div className="mt-1 text-xs text-slate-400">
                      {L.t("ac.capPadsHint")}
                    </div>
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {L.t("ac.scopeLabel")} <span className="text-slate-200 font-semibold" dir="auto">{selectedBranchNames}</span>
                  </div>
                </div>

                <div className="mt-3 rounded-xl border border-slate-700/40 bg-slate-900/40 px-3 py-2 text-[11px] leading-snug text-slate-400">
                  <strong className="font-semibold text-slate-300">{L.t("ac.readOnlyPreview")}</strong>{" "}
                  {L.t("ac.previewPre")} <strong className="text-sky-300">{L.t("ac.fullNetwork")}</strong> {L.t("ac.and")}{" "}
                  <strong className="text-sky-300">{L.t("ac.assignedScope")}</strong>{L.t("ac.previewPost")}{" "}
                  <strong className="text-emerald-300">{L.t("ac.applyAccess")}</strong>.
                </div>

                <div className="mt-4 space-y-5">
                  {capabilityGroups.map((g) => (
                    <div key={g.group} className="space-y-3">
                      <div className="flex items-baseline justify-between gap-4">
                        <div className="text-sm font-semibold text-slate-100">{g.group}</div>
                        <div className="text-xs text-slate-400">{g.hint}</div>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {g.items.map((i) => (
                          <CapabilityPad key={i.id} id={i.id} label={i.label} description={i.description} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </ConsoleCard>

              <ConsoleCard>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-sm font-semibold text-slate-100">{L.t("ac.bank.title")}</div>
                    <div className="mt-1 text-xs text-slate-400">
                      {L.t("ac.bank.hint")}
                    </div>
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {L.t("ac.branchScopeLabel")} <span className="text-slate-200 font-semibold">{formatBranchCount(selectedBranchIds)}</span>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  {branches.map((b) => (
                    <BranchCard key={b.id} id={b.id} name={b.name} />
                  ))}
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <button
                    type="button"
                    disabled={
                      branchScopeInvalid ||
                      userIsDisabled ||
                      busy !== null
                    }
                    onClick={handleApplyAccess}
                    className="rounded-xl border border-sky-500/40 bg-sky-500/10 px-4 py-2.5 text-sm font-semibold text-sky-200 hover:bg-sky-500/15 hover:border-sky-500/60 disabled:opacity-60 disabled:pointer-events-none transition-all"
                  >
                    {busy === "apply" ? L.t("ac.applying") : L.t("ac.applyAccess")}
                  </button>
                  <div className="text-xs text-slate-400">
                    {L.t("ac.applyHint")}
                  </div>
                </div>
              </ConsoleCard>
            </div>
          ) : null}
        </div>

        <div>
          <div className="space-y-4">
            <ConsoleCard>
              <div className="text-sm font-semibold text-slate-100">{L.t("ac.summary.title")}</div>
              <div className="mt-1 text-xs text-slate-400">
                {L.t("ac.summary.hint")}
              </div>

              <div className="mt-4 space-y-3">
                <div className="rounded-xl border border-slate-800/80 bg-slate-900/25 p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{L.t("ac.identity")}</div>
                  <div className="mt-2 text-xs text-slate-300">
                    <div>
                      {L.t("ac.nameLabel")}{" "}
                      <span className="text-slate-100 font-semibold" dir="auto">{selectedUser?.name?.trim() || "—"}</span>
                    </div>
                    <div className="mt-1">
                      {L.t("ac.emailLabel")}{" "}
                      <span className="text-slate-100 font-semibold" dir="ltr">
                        {workflow === "found" ? selectedUser?.email ?? "—" : workflow === "create" ? createForm.email || "—" : "—"}
                      </span>
                    </div>
                    {selectedUser ? (
                      <div className="mt-1">
                        {L.t("ac.statusLabel")}{" "}
                        <span className="text-slate-100 font-semibold">
                          {selectedUser.status === "DISABLED"
                            ? L.t("ac.state.disabled")
                            : selectedUser.status === "PENDING"
                              ? L.t("ac.status.pending")
                              : L.t("ac.status.active")}
                        </span>
                        {selectedUser.protected ? <span className="ms-2 text-amber-300">{L.t("ac.protectedParen")}</span> : null}
                      </div>
                    ) : null}
                    {selectedUser?.deactivatedAt ? (
                      <div className="mt-1">
                        {L.t("ac.disabledAt")}{" "}
                        <span className="text-slate-100 font-semibold" dir="ltr">
                          {new Date(selectedUser.deactivatedAt).toLocaleString()}
                        </span>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-800/80 bg-slate-900/25 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{L.t("ac.accessState")}</div>
                    {userIsDisabled ? (
                      <div className="inline-flex items-center gap-2 rounded-lg border border-slate-800/80 bg-slate-900/30 px-3 py-1 text-[11px] font-semibold text-slate-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-slate-400" aria-hidden />
                        {L.t("ac.branch.userDisabled")}
                      </div>
                    ) : (
                      <div
                        className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1 text-[11px] font-semibold ${
                          unlocked
                            ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-200"
                            : "border-amber-500/25 bg-amber-500/10 text-amber-200"
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${unlocked ? "bg-emerald-400" : "bg-amber-400"}`}
                          aria-hidden
                        />
                        {unlocked ? L.t("ac.ready") : L.t("ac.state.protected")}
                      </div>
                    )}
                  </div>
                  <div className="mt-2 text-xs text-slate-300">
                    {L.t("ac.accessLevel")}{" "}
                    <span className="text-slate-100 font-semibold">
                      {accessMode === "OWNER" ? L.t("ac.fullNetwork") : L.t("ac.assignedScope")}
                    </span>
                    <br />
                    {L.t("ac.scopeLabel")} <span className="text-slate-100 font-semibold" dir="auto">{selectedUser ? selectedBranchNames : "—"}</span>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-800/80 bg-slate-900/25 p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{L.t("ac.sensitiveActions")}</div>
                  <div className="mt-2 space-y-2 text-xs text-slate-300">
                    {(["PROTECTED_ACTIONS", "DELETE_MEDIA"] as CapabilityId[]).map((id) => {
                      const raw = capabilityState.get(id) ?? "locked";
                      const s = userIsDisabled ? "disabled" : raw;
                      return (
                        <div key={id} className="flex items-center justify-between gap-3">
                          <span className="truncate">
                            {id === "PROTECTED_ACTIONS" ? L.t("ac.cap.protectedActions") : L.t("ac.cap.deleteMedia")}
                          </span>
                          <span className={`rounded-lg border px-2 py-0.5 text-[11px] font-semibold ${badgeTone(s)}`}>
                            {stateLabel(s)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </ConsoleCard>

            <ConsoleCard>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-100">{L.t("ac.workspaceUsers")}</div>
                  <div className="mt-1 text-xs text-slate-400">{L.t("ac.total", { n: users.length })}</div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void reload();
                    setToast(L.t("ac.toast.refreshed"));
                  }}
                  className="rounded-lg border border-slate-700/80 bg-slate-900/30 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-slate-800/60 hover:border-slate-600/90 transition-all"
                >
                  {L.t("ac.refresh")}
                </button>
              </div>

              <ul className="mt-3 max-h-[260px] space-y-1.5 overflow-y-auto pe-1 text-xs text-slate-300">
                {users.length === 0 ? (
                  <li className="rounded-lg border border-slate-800/80 bg-slate-900/30 p-3 text-slate-500">
                    {L.t("ac.noUsers")}
                  </li>
                ) : (
                  users.map((u) => {
                    const isSelected = selectedUserEmail?.toLowerCase() === u.email.toLowerCase();
                    return (
                      <li key={u.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setLookupEmail(u.email);
                            setWorkflow("found");
                            adoptUserIntoForm(u);
                            setToast(null);
                          }}
                          className={`w-full rounded-lg border px-3 py-2 text-start transition-all ${
                            isSelected
                              ? "border-sky-500/45 bg-sky-500/5 text-sky-100"
                              : "border-slate-800 bg-slate-900/30 text-slate-200 hover:border-slate-600 hover:bg-slate-800/40"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span
                              className={`truncate font-semibold ${
                                u.status === "DISABLED" ? "text-slate-500 line-through" : ""
                              }`}
                            >
                              <bdi>{u.name?.trim() || u.email}</bdi>
                            </span>
                            {u.status === "DISABLED" ? (
                              <span className="shrink-0 rounded-md border border-rose-500/30 bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-rose-200">
                                {L.t("ac.state.disabled")}
                              </span>
                            ) : u.protected ? (
                              <span className="shrink-0 rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-200">
                                {L.t("ac.state.protected")}
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-0.5 truncate text-[11px] text-slate-500">
                            {u.accessType === "OWNER" ? L.t("ac.ownerAll") : L.t("ac.branchUserList", { branches: u.branchIds.join(", ") || L.t("ac.noBranchesShort") })}
                          </div>
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
            </ConsoleCard>

            <ConsoleCard>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-100">{L.t("ac.activity")}</div>
                  <div className="mt-1 text-xs text-slate-400">{L.t("ac.activityHint")}</div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void reloadAudit();
                  }}
                  className="rounded-lg border border-slate-700/80 bg-slate-900/30 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-slate-800/60 hover:border-slate-600/90 transition-all"
                >
                  {L.t("ac.refresh")}
                </button>
              </div>

              <ul className="mt-3 max-h-[300px] space-y-1.5 overflow-y-auto pe-1 text-xs text-slate-300">
                {auditEvents.length === 0 ? (
                  <li className="rounded-lg border border-slate-800/80 bg-slate-900/30 p-3 text-slate-500">
                    {L.t("ac.noActivity")}
                  </li>
                ) : (
                  auditEvents.map((ev) => {
                    const known = TENANT_AUDIT_LABELS[ev.action];
                    const meta = known ? { label: L.t(known.key), tone: known.tone } : { label: ev.action, tone: "neutral" as const };
                    const actorEmail = ev.actor?.email ?? L.t("ac.deletedUser");
                    const targetEmail =
                      ev.target?.email ??
                      (ev.metadata && typeof ev.metadata === "object" && ev.metadata !== null
                        ? ((ev.metadata as { targetEmail?: unknown }).targetEmail as string | undefined) ?? null
                        : null);
                    return (
                      <li
                        key={ev.id}
                        className="rounded-lg border border-slate-800 bg-slate-900/30 px-3 py-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <AuditToneBadge tone={meta.tone}>{meta.label}</AuditToneBadge>
                          <span
                            className="text-[11px] text-slate-500"
                            title={new Date(ev.createdAt).toLocaleString()}
                          >
                            {fmtRelative(ev.createdAt, L.t)}
                          </span>
                        </div>
                        <div className="mt-1 truncate text-[11px] text-slate-300">
                          <span className="text-slate-500">{L.t("ac.by")}</span>
                          <span className="font-semibold text-slate-200" dir="ltr">{actorEmail}</span>
                          {targetEmail ? (
                            <>
                              <span className="text-slate-500">{L.t("ac.targetSep")}</span>
                              <span className="font-semibold text-slate-200" dir="ltr">{targetEmail}</span>
                            </>
                          ) : null}
                        </div>
                      </li>
                    );
                  })
                )}
              </ul>
            </ConsoleCard>

            {toast ? (
              <ConsoleCard className="border-slate-800/80 bg-slate-950/30">
                <div className="flex items-start justify-between gap-3">
                  <div className="text-xs text-slate-300">{toast}</div>
                  <button
                    type="button"
                    onClick={() => setToast(null)}
                    className="text-[11px] text-slate-500 hover:text-slate-300"
                  >
                    {L.t("ac.dismiss")}
                  </button>
                </div>
              </ConsoleCard>
            ) : null}
          </div>
        </div>
      </div>

      {pendingSensitive ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setPendingSensitive(null)} aria-hidden />
          <div className="relative w-full max-w-lg rounded-2xl border border-slate-800/80 bg-slate-950 p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.03)]">
            <div className="text-sm font-semibold text-slate-100">{L.t("ac.confirm.title")}</div>
            <div className="mt-1 text-xs text-slate-400">
              {L.t("ac.confirm.pre")}{" "}
              <span className="font-semibold text-slate-200">{L.t("ac.applyAccess")}</span> {L.t("ac.confirm.post")}
            </div>

            <div className="mt-4 rounded-xl border border-slate-800/80 bg-slate-900/25 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{L.t("ac.selected")}</div>
              <div className="mt-2 text-xs text-slate-200 font-semibold">
                {pendingSensitive === "PROTECTED_ACTIONS"
                  ? L.t("ac.cap.protectedActions")
                  : pendingSensitive === "DELETE_MEDIA"
                    ? L.t("ac.cap.deleteMedia")
                    : pendingSensitive}
              </div>
              <div className="mt-1 text-xs text-slate-400">{capabilityScopeText(pendingSensitive)}</div>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setPendingSensitive(null)}
                className="rounded-xl border border-slate-800/80 bg-slate-900/30 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-slate-800/60 hover:border-slate-600/90 transition-all"
              >
                {L.t("ac.close")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <DeleteConfirmModal
        isOpen={removeConfirmOpen}
        onClose={() => {
          if (busy === "remove") return;
          setRemoveConfirmOpen(false);
          setRemoveError(null);
        }}
        onConfirm={performRemoveFromWorkspace}
        title={L.t("ac.remove.title")}
        message={
          selectedUser
            ? L.t("ac.remove.message", { email: selectedUser.email })
            : ""
        }
        errorHint={removeError}
        confirmLabel={L.t("ac.us.remove")}
        cancelLabel={L.t("common.cancel")}
        loading={busy === "remove"}
        loadingLabel={L.t("ac.removing")}
      />
    </div>
  );
}
