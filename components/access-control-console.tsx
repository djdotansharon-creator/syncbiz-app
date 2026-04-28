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
import { useCallback, useEffect, useMemo, useState } from "react";
import { DeleteConfirmModal } from "@/components/delete-confirm-modal";

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
      className={`w-full text-left rounded-2xl border px-4 py-4 transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-slate-400/30 focus:ring-offset-2 focus:ring-offset-slate-950 disabled:opacity-50 disabled:pointer-events-none
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
): string {
  switch (reason) {
    case "WORKSPACE_OWNER":
      return "Workspace owner cannot be removed from here.";
    case "LAST_WORKSPACE_ADMIN":
      return "Sole tenant-wide admin in this workspace — add another admin before removing this person.";
    default:
      return "";
  }
}

function pauseDeniedHint(
  reason: ApiUser["pauseDeniedReason"],
  isSelf: boolean,
): string {
  if (isSelf) return "You cannot pause your own membership.";
  switch (reason) {
    case "WORKSPACE_OWNER":
      return "Workspace owner cannot be paused. Transfer ownership first.";
    case "LAST_ACTIVE_WORKSPACE_ADMIN":
      return "Sole active tenant-wide admin — promote another admin before pausing this person.";
    case "SELF":
      return "You cannot pause your own membership.";
    default:
      return "";
  }
}

type BranchOption = { id: string; name: string };
type SessionSummary = { accessType?: AccessMode; branchIds?: string[]; userId?: string; email?: string };

// ─── Tiny local hook: real admin-users API client ─────────────────────────────

function useAdminUsers() {
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [me, setMe] = useState<SessionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);

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
      opts.unshift({ id: "default", name: "Default (legacy)" });
    }
    setBranches(opts.length > 0 ? opts : [{ id: "default", name: "Default (legacy)" }]);
  }, []);

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
        if (!cancelled) setBootstrapError("Could not load Access Control state.");
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
      if (!res.ok) throw new Error(data.error ?? `Create failed (${res.status})`);
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
      if (!res.ok) throw new Error(data.error ?? `Update failed (${res.status})`);
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
      if (!res.ok) throw new Error(data.error ?? `Disable failed (${res.status})`);
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
      if (!res.ok) throw new Error(data.error ?? `Activate failed (${res.status})`);
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
      if (!res.ok) throw new Error(data.error ?? `Remove failed (${res.status})`);
      await reload();
      return data;
    },
    [reload],
  );

  return { users, branches, me, loading, bootstrapError, reload, createUser, updateUser, pauseMembership, resumeMembership, removeFromWorkspace };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AccessControlConsole() {
  const { users, branches, me, loading, bootstrapError, reload, createUser, updateUser, pauseMembership, resumeMembership, removeFromWorkspace } = useAdminUsers();

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
        group: "User Management",
        hint: "Identity access management.",
        items: [
          { id: "MANAGE_USERS" as const, label: "Manage Users", description: "Access entry and admin scope." },
          { id: "EDIT_BRANCH_RULES" as const, label: "Edit Branch Rules", description: "Protected rule updates." },
        ],
      },
      {
        group: "Branch Access",
        hint: "Scope boundaries for locations (routing target bank).",
        items: [
          { id: "VIEW_BRANCH" as const, label: "View Branch", description: "Read-only branch visibility." },
          { id: "ASSIGN_BRANCHES" as const, label: "Assign Branches", description: "Scope management and routing targets." },
        ],
      },
      {
        group: "Playback Control",
        hint: "Operational sound-control permissions.",
        items: [
          { id: "CONTROL_PLAYBACK" as const, label: "Control Playback", description: "Play, pause, and route actions." },
          { id: "EDIT_SOURCES" as const, label: "Edit Sources", description: "Update playback inputs and feeds." },
          { id: "EDIT_SCHEDULES" as const, label: "Edit Schedules", description: "Schedule changes (scope-aware)." },
        ],
      },
      {
        group: "Sensitive Actions",
        hint: "Protected actions with a confirmation step.",
        items: [
          { id: "PROTECTED_ACTIONS" as const, label: "Protected Actions", description: "Extra-protection administrative actions." },
          { id: "DELETE_MEDIA" as const, label: "Delete Media", description: "Destructive action." },
        ],
      },
    ],
    [],
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
    if (accessMode === "OWNER") return "All branches";
    if (selectedBranchIds.length === 0) return "None (scope required)";
    const names = selectedBranchIds.map((id) => branches.find((b) => b.id === id)?.name ?? id);
    return names.join(", ");
  }, [accessMode, branches, selectedBranchIds]);

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
      setToast("Valid email required.");
      return;
    }
    if (!createForm.password || createForm.password.length < 6) {
      setToast("Password must be at least 6 characters.");
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
      setToast(`User ${email} created. Configure scope below.`);
      setSelectedUserEmail(email);
      setAccessMode("BRANCH_USER");
      setSelectedBranchIds([]);
      setCreateForm({ name: "", email: "", password: "" });
      setWorkflow("found");
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Failed to create user.");
    } finally {
      setBusy(null);
    }
  };

  const handleApplyAccess = async () => {
    if (!unlocked || !selectedUser || busy) return;
    if (accessMode === "BRANCH_USER" && selectedBranchIds.length === 0) {
      setToast("Branch scope requires at least one assigned branch.");
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
      setToast("Access updated.");
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Failed to update access.");
    } finally {
      setBusy(null);
    }
  };

  const handleDisable = async () => {
    if (!unlocked || !selectedUser || busy) return;
    if (pauseInWorkspaceBlocked) {
      setToast(pauseDeniedHint(selectedUser.pauseDeniedReason, isSelfTarget) || "Cannot pause this user.");
      return;
    }
    setBusy("disable");
    try {
      await pauseMembership(selectedUser.email);
      setToast(`${selectedUser.email} paused in this workspace. Their other workspaces are unaffected.`);
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Failed to pause user.");
    } finally {
      setBusy(null);
    }
  };

  const openRemoveConfirm = () => {
    if (!unlocked || !selectedUser || busy) return;
    if (selectedUser.canRemoveFromWorkspace === false) {
      setToast(tenantRemoveHint(selectedUser.tenantRemoveDeniedReason) || "Cannot remove this user from the workspace.");
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
      setToast(`${selectedUser.email} removed from this workspace.`);
      setWorkflow("idle");
      setSelectedUserEmail(null);
      setLookupEmail("");
    } catch (e) {
      setRemoveError(e instanceof Error ? e.message : "Failed to remove from workspace.");
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
        setToast(`${selectedUser.email} re-activated in this workspace.`);
      } else {
        // No-op when already active in workspace; PATCH still useful if `User.status`
        // was DISABLED globally (interpreted as un-disable inside updateUser).
        await updateUser({
          email: selectedUser.email,
          name: selectedUser.name,
          accessType: selectedUser.accessType,
          branchIds: selectedUser.accessType === "BRANCH_USER" ? selectedUser.branchIds : [],
        });
        setToast(`${selectedUser.email} is active.`);
      }
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Failed to activate user.");
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
    if (accessMode === "OWNER") return `${branches.length} (scope)`;
    return ids.length ? `${ids.length} selected` : "0 selected";
  };

  const stateLabel = (state: CapabilityState) => {
    if (state === "allowed") return "Enabled";
    if (state === "protected") return "Protected";
    if (state === "disabled") return "Disabled";
    return "Locked";
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
    if (!unlocked) return "Protected (locked).";
    if (!selectedUser) return "Scope: Open a user to configure.";
    if (accessMode === "OWNER") {
      if (id === "VIEW_BRANCH") return "Scope: All branches.";
      if (id === "ASSIGN_BRANCHES") return "Scope: Route targets across all branches.";
      return "Scope: Full tenant.";
    }
    if (branchScopeInvalid) return "Scope: Not configured yet (required).";
    if (userIsDisabled) return "Scope: User disabled.";
    const names = selectedBranchIds.map((bid) => branches.find((b) => b.id === bid)?.name).filter(Boolean);
    if (id === "VIEW_BRANCH") return `Scope: ${names.join(", ")}.`;
    if (id === "ASSIGN_BRANCHES") return `Scope: Assignment within ${names.join(", ")}.`;
    return `Scope: ${names.join(", ")}.`;
  };

  const StatusStrip = () => {
    const branchesOnline = branches.length;
    const activeUsers = users.filter((u) => u.status !== "DISABLED").length;
    const totalUsers = users.length;
    return (
      <div className="rounded-2xl border border-slate-800/80 bg-slate-950/40 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className={`inline-flex h-2.5 w-2.5 rounded-full ${ledClasses("green")}`} aria-hidden />
            <div className="text-xs">
              <span className="font-semibold text-slate-100">Workspace branches</span>{" "}
              <span className="text-slate-400">{branchesOnline}</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className={`inline-flex h-2.5 w-2.5 rounded-full ${ledClasses(unlocked ? "green" : "amber")}`} aria-hidden />
            <div className="text-xs">
              <span className="font-semibold text-slate-100">Console</span>{" "}
              <span className="text-slate-400">{unlocked ? "Unlocked" : "Locked"}</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className={`inline-flex h-2.5 w-2.5 rounded-full ${ledClasses(unlocked ? "green" : "amber")}`} aria-hidden />
            <div className="text-xs">
              <span className="font-semibold text-slate-100">Active users</span>{" "}
              <span className="text-slate-400">
                {activeUsers}/{totalUsers}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className={`inline-flex h-2.5 w-2.5 rounded-full ${ledClasses(unlocked ? "green" : "amber")}`} aria-hidden />
            <div className="text-xs">
              <span className="font-semibold text-slate-100">Signed in as</span>{" "}
              <span className="text-slate-400">{me?.email ?? "—"}</span>
            </div>
          </div>
        </div>
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
        aria-label={`${label} — informational status, not an action`}
        className={`group w-full cursor-default select-none rounded-2xl border px-4 py-4 text-left transition-all duration-150
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
            <div className="text-sm font-semibold text-slate-100">{name}</div>
            <div className="mt-1 text-xs text-slate-400">
              {userIsDisabled
                ? "User disabled"
                : assigned
                  ? accessMode === "OWNER"
                    ? "Included in full network scope (not a toggle here)"
                    : "Assigned (scope)"
                  : branchScopeInvalid
                    ? "Locked"
                    : "Available — tap to assign"}
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
          className={`h-full cursor-default select-none rounded-2xl border px-4 py-4 text-left ${tone}`}
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
        className={`h-full rounded-2xl border px-4 py-4 text-left transition-all hover:border-slate-600/90 disabled:opacity-60 disabled:hover:border-current ${tone}`}
      >
        {body}
      </button>
    );
  };

  const lookupDisabled = !unlocked;

  // ─── Loading + access gating ────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="rounded-2xl border border-slate-800/80 bg-slate-950/50 p-5">
          <div className="text-sm text-slate-300">Loading Access Control…</div>
        </div>
      </div>
    );
  }

  if (bootstrapError) {
    return (
      <div className="space-y-6">
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-5">
          <div className="text-sm font-semibold text-rose-200">Access Control unavailable</div>
          <div className="mt-1 text-xs text-rose-100/80">{bootstrapError}</div>
        </div>
      </div>
    );
  }

  if (me?.accessType !== "OWNER") {
    return (
      <div className="space-y-6">
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5">
          <div className="text-sm font-semibold text-amber-200">Owner access required</div>
          <div className="mt-1 text-xs text-amber-100/80">
            Access Control is only available to workspace owners. Your current session is a{" "}
            <span className="font-semibold">{me?.accessType ?? "guest"}</span> session.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-50">Access Control Console</h1>
          <p className="mt-0.5 text-xs text-slate-400">
            Premium operational shell wired to the live workspace database.
          </p>
        </div>

        {!unlocked ? (
          <button
            type="button"
            onClick={() => setUnlocked(true)}
            className="rounded-xl border border-amber-500/50 bg-amber-500/10 px-4 py-2 text-sm font-semibold text-amber-200 shadow-[0_0_24px_rgba(245,158,11,0.10)] hover:bg-amber-500/15 hover:border-amber-500/60 transition-all"
          >
            Unlock console
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
            Lock console
          </button>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <div className="lg:col-span-8 space-y-4">
          <StatusStrip />

          {!unlocked ? (
            <ConsoleCard>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="text-sm font-semibold text-slate-100">Protected Access Required</div>
                  <div className="mt-1 text-xs text-slate-400">
                    Unlock to manage real workspace users, branch scope, and account lifecycle.
                  </div>
                </div>
                <div className="text-xs text-slate-400">Tip: unlock to configure scope and access pads.</div>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-200/80">Access engine</div>
                  <div className="mt-1 text-sm font-semibold text-amber-100">Protected</div>
                </div>
                <div className="rounded-2xl border border-slate-800/80 bg-slate-900/30 px-4 py-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Capability layer</div>
                  <div className="mt-1 text-sm font-semibold text-slate-200">Locked</div>
                </div>
                <div className="rounded-2xl border border-slate-800/80 bg-slate-900/30 px-4 py-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Scope routing</div>
                  <div className="mt-1 text-sm font-semibold text-slate-200">Hidden</div>
                </div>
              </div>
            </ConsoleCard>
          ) : null}

          {unlocked && workflow === "idle" ? (
            <ConsoleCard>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold text-slate-100">User Access Entry</div>
                  <div className="mt-1 text-xs text-slate-400">
                    Search by email to open the user&apos;s access console.
                  </div>
                </div>
                <div className="text-[11px] text-slate-500">
                  Workspace users: <span className="text-slate-200 font-semibold">{users.length}</span>
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-500">Email</label>
                  <input
                    value={lookupEmail}
                    onChange={(e) => setLookupEmail(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && lookupEmail.trim()) doLookup();
                    }}
                    className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm text-slate-200 outline-none focus:border-sky-500/50"
                    placeholder="user@company.com"
                    inputMode="email"
                  />
                </div>
                <div className="sm:pt-5">
                  <button
                    type="button"
                    onClick={doLookup}
                    disabled={lookupDisabled || !lookupEmail.trim()}
                    className="w-full rounded-xl border border-sky-500/40 bg-sky-500/10 px-4 py-2.5 text-sm font-semibold text-sky-200 hover:bg-sky-500/15 hover:border-sky-500/60 disabled:opacity-60 disabled:pointer-events-none transition-all"
                  >
                    Find user
                  </button>
                </div>
              </div>

              {users.length === 0 ? (
                <div className="mt-4 rounded-xl border border-slate-800/80 bg-slate-900/25 p-3 text-xs text-slate-400">
                  No workspace users yet. Type a new email above and click <span className="text-slate-200 font-semibold">Find user</span> to open the create flow.
                </div>
              ) : (
                <div className="mt-4 rounded-xl border border-slate-800/80 bg-slate-900/25 p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Recent workspace users</div>
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
                        className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/30 px-3 py-2 text-left text-xs text-slate-200 hover:border-slate-600 hover:bg-slate-800/40 transition-all"
                      >
                        <span className="truncate">
                          <span className="font-semibold">{u.name?.trim() || u.email}</span>
                          <span className="text-slate-500"> · {u.accessType === "OWNER" ? "Owner" : "Branch User"}</span>
                        </span>
                        {u.status === "DISABLED" ? (
                          <span className="shrink-0 rounded-md border border-rose-500/30 bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-rose-200">
                            Disabled
                          </span>
                        ) : u.protected ? (
                          <span className="shrink-0 rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-200">
                            Protected
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
                  <div className="text-sm font-semibold text-slate-100">Create New User</div>
                  <div className="mt-1 text-xs text-slate-400">
                    Creates a real, login-capable Branch User. Configure branch scope after creation.
                  </div>
                </div>
                <div className="text-[11px] text-slate-500">
                  Email: <span className="text-slate-200 font-semibold">{createForm.email || "—"}</span>
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-500">Display name (optional)</label>
                  <input
                    value={createForm.name}
                    onChange={(e) => setCreateForm((p) => ({ ...p, name: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm text-slate-200 outline-none focus:border-sky-500/50"
                    placeholder="Full name"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500">Email</label>
                  <input
                    value={createForm.email}
                    onChange={(e) => setCreateForm((p) => ({ ...p, email: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm text-slate-200 outline-none focus:border-sky-500/50"
                    placeholder="user@company.com"
                    inputMode="email"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-500">Password (min. 6 characters)</label>
                  <input
                    type="password"
                    value={createForm.password}
                    onChange={(e) => setCreateForm((p) => ({ ...p, password: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm text-slate-200 outline-none focus:border-sky-500/50"
                    placeholder="Set initial password"
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
                  Back to lookup
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
                  {busy === "create" ? "Creating…" : "Create user"}
                </button>
              </div>

              <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-200/80">Next step</div>
                <div className="mt-1 text-xs text-amber-100">
                  This user will be created as <span className="font-semibold">Branch User</span>. After creation, assign at least one branch to grant access.
                </div>
              </div>
            </ConsoleCard>
          ) : null}

          {unlocked && workflow === "found" && selectedUser ? (
            <div className="space-y-4">
              <ConsoleCard>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="text-sm font-semibold text-slate-100">Access target</div>
                    <div className="mt-1 text-xs text-slate-400">
                      Identity lookup resolved. Configure access through pads and scope routing.
                    </div>
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Status:{" "}
                    <span className="text-slate-200 font-semibold">
                      {selectedUser.status === "DISABLED"
                        ? "Disabled"
                        : selectedUser.status === "PENDING"
                          ? "Pending"
                          : "Active"}
                    </span>
                    {selectedUser.protected ? (
                      <span className="ml-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-200">
                        Protected
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-100 truncate">{selectedUser.name?.trim() || "—"}</div>
                    <div className="mt-1 text-xs text-slate-400 truncate">{selectedUser.email}</div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 w-full sm:w-[420px]">
                    <PadButton
                      label="Full Network"
                      description="All branches scope."
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
                      label="Assigned Scope"
                      description="Only assigned branches."
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
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-200/80">Protected constraint</div>
                    <div className="mt-1 text-xs text-amber-100">
                      Assigned scope requires at least one branch target.
                    </div>
                  </div>
                ) : null}
              </ConsoleCard>

              <ConsoleCard>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="text-sm font-semibold text-slate-100">User status</div>
                    <div className="mt-1 text-xs text-slate-400">
                      <strong className="font-semibold text-slate-300">Active</strong> — full workspace access.{" "}
                      <strong className="font-semibold text-slate-300">Disable</strong> pauses access in this
                      workspace only (reversible, other workspaces unaffected).{" "}
                      <strong className="font-semibold text-slate-300">Remove</strong> deletes the membership and
                      branch assignments here.
                    </div>
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Current:{" "}
                    <span className="text-slate-200 font-semibold">
                      {selectedUser.status === "DISABLED"
                        ? "Login disabled"
                        : membershipSuspended
                          ? "Paused in workspace"
                          : "Active"}
                    </span>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <PadButton
                    label={busy === "activate" ? "Activating…" : "Active"}
                    description={
                      membershipSuspended
                        ? "Resume access in this workspace."
                        : userIsDisabled
                          ? "Login is globally disabled."
                          : "Identity is enabled."
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
                    label={busy === "disable" ? "Disabling…" : "Disable"}
                    description={
                      pauseInWorkspaceBlocked
                        ? pauseDeniedHint(selectedUser.pauseDeniedReason, isSelfTarget) || "Protected — cannot disable here."
                        : membershipSuspended
                          ? "Already paused in this workspace."
                          : "Pause access in this workspace (reversible, other workspaces unaffected)."
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
                    label={busy === "remove" ? "Removing…" : "Remove"}
                    description={
                      selectedUser.canRemoveFromWorkspace === false
                        ? tenantRemoveHint(selectedUser.tenantRemoveDeniedReason) || "Cannot remove from workspace."
                        : "Delete membership and branches in this workspace only."
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
                        Paused in this workspace
                        {selectedUser.membershipSuspendedAt
                          ? ` since ${new Date(selectedUser.membershipSuspendedAt).toLocaleDateString()}`
                          : ""}
                        . Login still works for other workspaces. Click <strong>Active</strong> to resume.
                      </div>
                    ) : null}
                    {pauseInWorkspaceBlocked ? (
                      <div>{pauseDeniedHint(selectedUser.pauseDeniedReason, isSelfTarget)}</div>
                    ) : null}
                    {selectedUser.canRemoveFromWorkspace === false ? (
                      <div>{tenantRemoveHint(selectedUser.tenantRemoveDeniedReason)}</div>
                    ) : null}
                  </div>
                ) : null}
              </ConsoleCard>

              <ConsoleCard>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-sm font-semibold text-slate-100">Capability pads</div>
                    <div className="mt-1 text-xs text-slate-400">
                      Access language: View, Control, Manage, Protected, Scope.
                    </div>
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Scope: <span className="text-slate-200 font-semibold">{selectedBranchNames}</span>
                  </div>
                </div>

                <div className="mt-3 rounded-xl border border-slate-700/40 bg-slate-900/40 px-3 py-2 text-[11px] leading-snug text-slate-400">
                  <strong className="font-semibold text-slate-300">Read-only preview.</strong>{" "}
                  Capabilities are derived from the access type and branch scope chosen above. To change them, switch
                  between <strong className="text-sky-300">Full Network</strong> and{" "}
                  <strong className="text-sky-300">Assigned Scope</strong>, adjust branch cards, and click{" "}
                  <strong className="text-emerald-300">Apply access</strong>.
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
                    <div className="text-sm font-semibold text-slate-100">Branch assignment routing bank</div>
                    <div className="mt-1 text-xs text-slate-400">
                      Treat branches as target pads. Assigned branches define the scope.
                    </div>
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Branch scope: <span className="text-slate-200 font-semibold">{formatBranchCount(selectedBranchIds)}</span>
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
                    {busy === "apply" ? "Applying…" : "Apply access"}
                  </button>
                  <div className="text-xs text-slate-400">
                    Saves access type and branch scope to the workspace.
                  </div>
                </div>
              </ConsoleCard>
            </div>
          ) : null}
        </div>

        <div className="lg:col-span-4">
          <div className="space-y-4">
            <ConsoleCard>
              <div className="text-sm font-semibold text-slate-100">Live access summary</div>
              <div className="mt-1 text-xs text-slate-400">
                Operational summary for the selected user and scope.
              </div>

              <div className="mt-4 space-y-3">
                <div className="rounded-xl border border-slate-800/80 bg-slate-900/25 p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Identity</div>
                  <div className="mt-2 text-xs text-slate-300">
                    <div>
                      Name:{" "}
                      <span className="text-slate-100 font-semibold">{selectedUser?.name?.trim() || "—"}</span>
                    </div>
                    <div className="mt-1">
                      Email:{" "}
                      <span className="text-slate-100 font-semibold">
                        {workflow === "found" ? selectedUser?.email ?? "—" : workflow === "create" ? createForm.email || "—" : "—"}
                      </span>
                    </div>
                    {selectedUser ? (
                      <div className="mt-1">
                        Status:{" "}
                        <span className="text-slate-100 font-semibold">
                          {selectedUser.status === "DISABLED"
                            ? "Disabled"
                            : selectedUser.status === "PENDING"
                              ? "Pending"
                              : "Active"}
                        </span>
                        {selectedUser.protected ? <span className="ml-2 text-amber-300">(protected)</span> : null}
                      </div>
                    ) : null}
                    {selectedUser?.deactivatedAt ? (
                      <div className="mt-1">
                        Disabled at:{" "}
                        <span className="text-slate-100 font-semibold">
                          {new Date(selectedUser.deactivatedAt).toLocaleString()}
                        </span>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-800/80 bg-slate-900/25 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Access state</div>
                    {userIsDisabled ? (
                      <div className="inline-flex items-center gap-2 rounded-lg border border-slate-800/80 bg-slate-900/30 px-3 py-1 text-[11px] font-semibold text-slate-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-slate-400" aria-hidden />
                        User disabled
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
                        {unlocked ? "Ready" : "Protected"}
                      </div>
                    )}
                  </div>
                  <div className="mt-2 text-xs text-slate-300">
                    Access level:{" "}
                    <span className="text-slate-100 font-semibold">
                      {accessMode === "OWNER" ? "Full Network" : "Assigned Scope"}
                    </span>
                    <br />
                    Scope: <span className="text-slate-100 font-semibold">{selectedUser ? selectedBranchNames : "—"}</span>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-800/80 bg-slate-900/25 p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Sensitive actions</div>
                  <div className="mt-2 space-y-2 text-xs text-slate-300">
                    {(["PROTECTED_ACTIONS", "DELETE_MEDIA"] as CapabilityId[]).map((id) => {
                      const raw = capabilityState.get(id) ?? "locked";
                      const s = userIsDisabled ? "disabled" : raw;
                      return (
                        <div key={id} className="flex items-center justify-between gap-3">
                          <span className="truncate">
                            {id === "PROTECTED_ACTIONS" ? "Protected Actions" : "Delete Media"}
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
                  <div className="text-sm font-semibold text-slate-100">Workspace users</div>
                  <div className="mt-1 text-xs text-slate-400">{users.length} total</div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void reload();
                    setToast("Refreshed.");
                  }}
                  className="rounded-lg border border-slate-700/80 bg-slate-900/30 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-slate-800/60 hover:border-slate-600/90 transition-all"
                >
                  Refresh
                </button>
              </div>

              <ul className="mt-3 max-h-[360px] space-y-1.5 overflow-y-auto pr-1 text-xs text-slate-300">
                {users.length === 0 ? (
                  <li className="rounded-lg border border-slate-800/80 bg-slate-900/30 p-3 text-slate-500">
                    No users in this workspace yet.
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
                          className={`w-full rounded-lg border px-3 py-2 text-left transition-all ${
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
                              {u.name?.trim() || u.email}
                            </span>
                            {u.status === "DISABLED" ? (
                              <span className="shrink-0 rounded-md border border-rose-500/30 bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-rose-200">
                                Disabled
                              </span>
                            ) : u.protected ? (
                              <span className="shrink-0 rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-200">
                                Protected
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-0.5 truncate text-[11px] text-slate-500">
                            {u.accessType === "OWNER" ? "Owner · all branches" : `Branch User · ${u.branchIds.join(", ") || "no branches"}`}
                          </div>
                        </button>
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
                    Dismiss
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
            <div className="text-sm font-semibold text-slate-100">Operational confirmation</div>
            <div className="mt-1 text-xs text-slate-400">
              Capability pads are visual representations of the access scope. Apply scope changes via{" "}
              <span className="font-semibold text-slate-200">Apply access</span> below.
            </div>

            <div className="mt-4 rounded-xl border border-slate-800/80 bg-slate-900/25 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Selected</div>
              <div className="mt-2 text-xs text-slate-200 font-semibold">
                {pendingSensitive === "PROTECTED_ACTIONS"
                  ? "Protected Actions"
                  : pendingSensitive === "DELETE_MEDIA"
                    ? "Delete Media"
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
                Close
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
        title="Remove from workspace"
        message={
          selectedUser
            ? `Remove ${selectedUser.email} from this workspace?\n\nTheir membership and branch assignments are deleted for this workspace only. Their global SyncBiz account is preserved (other workspaces, login).`
            : ""
        }
        errorHint={removeError}
        confirmLabel="Remove"
        cancelLabel="Cancel"
        loading={busy === "remove"}
        loadingLabel="Removing…"
      />
    </div>
  );
}
