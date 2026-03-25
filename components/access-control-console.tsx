"use client";

import type { ReactNode } from "react";
import { useMemo, useState } from "react";

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

export function AccessControlConsole() {
  type AccessMode = "OWNER" | "BRANCH_USER";
  type CapabilityState = "allowed" | "protected" | "locked" | "disabled";
  type Workflow = "idle" | "found" | "create";
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

  type MockUser = {
    id: string;
    name: string;
    email: string;
    phone: string;
    baseAccessMode: AccessMode;
    branchIds: string[];
    status: "active" | "disabled" | "pending";
  };

  const branches = useMemo(() => {
    return [
      { id: "a", name: "Branch A" },
      { id: "b", name: "Branch B" },
      { id: "c", name: "Branch C" },
    ] as const;
  }, []);

  const [unlocked, setUnlocked] = useState(false);
  const [workflow, setWorkflow] = useState<Workflow>("idle");
  const [lookupEmail, setLookupEmail] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  const [users, setUsers] = useState<MockUser[]>(() => [
    {
      id: "u-owner",
      name: "Avery Owner",
      email: "owner@demo.com",
      phone: "555-0100",
      baseAccessMode: "OWNER",
      branchIds: branches.map((b) => b.id),
      status: "active",
    },
    {
      id: "u-branch",
      name: "Noam Branch User",
      email: "branch@demo.com",
      phone: "555-0110",
      baseAccessMode: "BRANCH_USER",
      branchIds: ["a", "b"],
      status: "active",
    },
  ]);

  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const selectedUser = useMemo(() => users.find((u) => u.id === selectedUserId) ?? null, [users, selectedUserId]);

  const [accessMode, setAccessMode] = useState<AccessMode>("OWNER");
  const [selectedBranchIds, setSelectedBranchIds] = useState<string[]>([]);

  const [createForm, setCreateForm] = useState<{ name: string; phone: string; email: string }>({
    name: "",
    phone: "",
    email: "",
  });

  const capabilityGroups = useMemo(() => {
    return [
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
        hint: "Protected actions with a confirmation step (UI only).",
        items: [
          { id: "PROTECTED_ACTIONS" as const, label: "Protected Actions", description: "Extra-protection administrative actions." },
          { id: "DELETE_MEDIA" as const, label: "Delete Media", description: "Destructive action (UI only)." },
        ],
      },
    ];
  }, []);

  const onAirBranchId = "a";
  const onlineBranchIds = useMemo(() => ["a", "b", "c"], []);
  const alertTone: "green" | "amber" | "red" = unlocked ? "green" : "amber";
  const controllerHealthTone: "green" | "amber" | "red" = unlocked ? "green" : "amber";

  const selectedBranchNames = useMemo(() => {
    if (accessMode === "OWNER") return "All branches";
    const names = selectedBranchIds.map((id) => branches.find((b) => b.id === id)?.name).filter(Boolean);
    return names.length ? names.join(", ") : "None (scope required)";
  }, [accessMode, branches, selectedBranchIds]);

  const branchScopeInvalid = useMemo(() => accessMode === "BRANCH_USER" && selectedBranchIds.length === 0, [accessMode, selectedBranchIds]);

  const userIsDisabled = workflow === "found" && selectedUser?.status === "disabled";

  const capabilityState = useMemo(() => {
    const mk = (s: CapabilityState) => s;

    const isLocked = !unlocked;
    if (isLocked) return new Map<CapabilityId, CapabilityState>(capabilityGroups.flatMap((g) => g.items.map((i) => [i.id, "locked" as const])));

    const isOwner = accessMode === "OWNER";

    const map = new Map<CapabilityId, CapabilityState>();

    // User Management
    map.set("MANAGE_USERS", isOwner ? mk("allowed") : mk("disabled"));
    map.set("EDIT_BRANCH_RULES", isOwner ? mk("protected") : mk("locked"));

    // Branch Access
    map.set("VIEW_BRANCH", mk("allowed"));
    map.set("ASSIGN_BRANCHES", isOwner ? mk("allowed") : mk("protected"));

    // Playback Control
    map.set("CONTROL_PLAYBACK", isOwner ? mk("allowed") : mk("allowed"));
    map.set("EDIT_SOURCES", isOwner ? mk("allowed") : mk("allowed"));
    map.set("EDIT_SCHEDULES", isOwner ? mk("allowed") : mk("locked"));

    // Sensitive Actions
    map.set("PROTECTED_ACTIONS", isOwner ? mk("protected") : mk("locked"));
    map.set("DELETE_MEDIA", isOwner ? mk("protected") : mk("locked"));

    // Branch scope gating for Branch User (UI-only validation)
    if (accessMode === "BRANCH_USER" && branchScopeInvalid) {
      map.set("ASSIGN_BRANCHES", "locked");
      map.set("VIEW_BRANCH", "protected");
      map.set("CONTROL_PLAYBACK", "protected");
      map.set("EDIT_SOURCES", "protected");
      map.set("EDIT_SCHEDULES", "locked");
    }

    return map;
  }, [accessMode, branchScopeInvalid, capabilityGroups, unlocked]);

  const [pendingSensitive, setPendingSensitive] = useState<CapabilityId | null>(null);

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

  const normalizeEmail = (v: string) => v.trim().toLowerCase();

  const doLookup = () => {
    if (!unlocked) return;
    const email = normalizeEmail(lookupEmail);
    if (!email) return;

    const found = users.find((u) => normalizeEmail(u.email) === email);
    if (!found) {
      setWorkflow("create");
      setSelectedUserId(null);
      setAccessMode("BRANCH_USER");
      setSelectedBranchIds([]);
      setCreateForm({ name: "", phone: "", email });
      setToast(null);
      return;
    }

    setWorkflow("found");
    setSelectedUserId(found.id);
    setAccessMode(found.baseAccessMode);
    setSelectedBranchIds(found.baseAccessMode === "OWNER" ? branches.map((b) => b.id) : found.branchIds);
    setToast(null);
  };

  const createUserPrototype = () => {
    if (!unlocked) return;
    if (!createForm.name.trim() || !createForm.phone.trim() || !createForm.email.trim()) return;

    const email = normalizeEmail(createForm.email);
    const exists = users.some((u) => normalizeEmail(u.email) === email);
    if (exists) return;

    const newUser: MockUser = {
      id: `u-${Date.now()}`,
      name: createForm.name.trim(),
      phone: createForm.phone.trim(),
      email,
      baseAccessMode: "BRANCH_USER",
      branchIds: [], // Explicit: no fallback branch scope for UI validation.
      status: "active",
    };

    setUsers((prev) => [newUser, ...prev]);
    setSelectedUserId(newUser.id);
    setAccessMode(newUser.baseAccessMode);
    setSelectedBranchIds([]); // keep empty to show scope validation.
    setWorkflow("found");
    setToast("Created new user.");
  };

  const applyPrototypeChanges = () => {
    if (!unlocked) return;
    if (workflow !== "found" || !selectedUser) return;

    if (accessMode === "BRANCH_USER" && selectedBranchIds.length === 0) {
      setToast("Branch scope requires at least one assigned branch.");
      return;
    }

    setUsers((prev) =>
      prev.map((u) => {
        if (u.id !== selectedUser.id) return u;
        const nextBranches = accessMode === "OWNER" ? branches.map((b) => b.id) : selectedBranchIds;
        return {
          ...u,
          baseAccessMode: accessMode,
          branchIds: nextBranches,
        };
      })
    );
    setToast("Access updated.");
  };

  const setUserStatus = (nextStatus: MockUser["status"]) => {
    if (!unlocked) return;
    if (workflow !== "found" || !selectedUser) return;
    setUsers((prev) => prev.map((u) => (u.id === selectedUser.id ? { ...u, status: nextStatus } : u)));
    setToast(nextStatus === "active" ? "User set to Active." : nextStatus === "disabled" ? "User set to Disabled." : "User set to Pending.");
  };

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

  const capabilityScopeText = (id: CapabilityId) => {
    if (!unlocked) return "Protected (locked).";
    if (accessMode === "OWNER") {
      if (id === "VIEW_BRANCH") return "Scope: All branches.";
      if (id === "ASSIGN_BRANCHES") return "Scope: Route targets across all branches.";
      return "Scope: Full tenant.";
    }

    // Branch User
    if (branchScopeInvalid) return "Scope: Not configured yet (required).";

    if (userIsDisabled) return "Scope: User disabled.";

    const names = selectedBranchIds.map((bid) => branches.find((b) => b.id === bid)?.name).filter(Boolean);
    if (id === "VIEW_BRANCH") return `Scope: ${names.join(", ")}.`;
    if (id === "ASSIGN_BRANCHES") return `Scope: Assignment within ${names.join(", ")}.`;
    return `Scope: ${names.join(", ")}.`;
  };

  const StatusStrip = () => {
    const branchesOnline = onlineBranchIds.length;
    const onAirName = branches.find((b) => b.id === onAirBranchId)?.name ?? "On-air";

    return (
      <div className="rounded-2xl border border-slate-800/80 bg-slate-950/40 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className={`inline-flex h-2.5 w-2.5 rounded-full ${ledClasses("green")}`} aria-hidden />
            <div className="text-xs">
              <span className="font-semibold text-slate-100">Branches online</span>{" "}
              <span className="text-slate-400">{branchesOnline}</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className={`inline-flex h-2.5 w-2.5 rounded-full ${ledClasses(unlocked ? "green" : "amber")}`} aria-hidden />
            <div className="text-xs">
              <span className="font-semibold text-slate-100">On-air</span> <span className="text-slate-400">{onAirName}</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className={`inline-flex h-2.5 w-2.5 rounded-full ${ledClasses(controllerHealthTone)}`} aria-hidden />
            <div className="text-xs">
              <span className="font-semibold text-slate-100">Control health</span>{" "}
              <span className="text-slate-400">{unlocked ? "Ready" : "Protected"}</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className={`inline-flex h-2.5 w-2.5 rounded-full ${ledClasses(alertTone)}`} aria-hidden />
            <div className="text-xs">
              <span className="font-semibold text-slate-100">Alerts</span>{" "}
              <span className="text-slate-400">{unlocked ? "None" : "Limited access"}</span>
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
    const isClickable = unlocked && !userIsDisabled && (rawState === "allowed" || rawState === "protected");

    return (
      <button
        type="button"
        disabled={!isClickable}
        onClick={() => {
          if (!isClickable) return;
          if (state === "protected") setPendingSensitive(id);
          else setPendingSensitive(id);
        }}
        className={`group w-full rounded-2xl border px-4 py-4 text-left transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-slate-400/30 disabled:opacity-60 disabled:pointer-events-none
          ${state === "allowed" ? "border-sky-500/35 bg-slate-900/25 hover:border-sky-500/55" : ""}
          ${state === "protected" ? "border-amber-500/35 bg-amber-500/5 hover:border-amber-500/60" : ""}
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
      </button>
    );
  };

  const BranchCard = ({ id, name }: { id: string; name: string }) => {
    const assigned = accessMode === "OWNER" ? true : selectedBranchIds.includes(id);
    const state: "assigned" | "protected" | "locked" = assigned ? "assigned" : branchScopeInvalid ? "locked" : "protected";

    const tone =
      userIsDisabled
        ? "border-slate-800/80 bg-slate-900/30 text-slate-500"
        :
      state === "assigned"
        ? "border-emerald-500/35 bg-emerald-500/5 text-emerald-200"
        : state === "protected"
          ? "border-amber-500/35 bg-amber-500/5 text-amber-200"
          : "border-slate-800/80 bg-slate-900/30 text-slate-500";

    const canToggle =
      unlocked &&
      !userIsDisabled &&
      accessMode === "BRANCH_USER" &&
      (assigned ? selectedBranchIds.length > 0 : true) &&
      !branchScopeInvalid;

    return (
      <button
        type="button"
        disabled={
          !unlocked ||
          accessMode === "OWNER" ||
          userIsDisabled ||
          (!assigned && branchScopeInvalid) ||
          (!canToggle && !assigned) ||
          (assigned && selectedBranchIds.length === 0)
        }
        onClick={() => {
          if (!unlocked) return;
          if (accessMode !== "BRANCH_USER") return;
          if (branchScopeInvalid && !assigned) return;
          setSelectedBranchIds((prev) => {
            if (prev.includes(id)) return prev.filter((x) => x !== id);
            return [...prev, id];
          });
          setToast(null);
        }}
        className={`h-full rounded-2xl border px-4 py-4 text-left transition-all hover:border-slate-600/90
          ${tone}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-100">{name}</div>
            <div className="mt-1 text-xs text-slate-400">
                {userIsDisabled
                  ? "Disabled"
                  : assigned
                    ? accessMode === "OWNER"
                      ? "Included"
                      : "Assigned (scope)"
                    : state === "locked"
                      ? "Locked"
                      : "Protected"}
            </div>
          </div>
          <span className={`shrink-0 inline-flex h-2.5 w-2.5 rounded-full ${assigned ? "bg-emerald-400" : "bg-amber-400"} `} aria-hidden />
        </div>
      </button>
    );
  };

  const lookupDisabled = !unlocked;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-50">Access Control Console</h1>
          <p className="mt-0.5 text-xs text-slate-400">
            Premium operational shell for tenant access. UI-only in this phase.
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
            onClick={() => setUnlocked(false)}
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
                    Manager re-auth will connect later. This screen remains UI-only for now.
                  </div>
                </div>
                <div className="text-xs text-slate-400">
                  Tip: unlock to configure scope and access pads.
                </div>
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
                    Search by email to open the user’s access console.
                  </div>
                </div>
                <div className="text-[11px] text-slate-500">Demo users: <span className="text-slate-200 font-semibold">owner@demo.com</span>, <span className="text-slate-200 font-semibold">branch@demo.com</span></div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-500">Email</label>
                  <input
                    value={lookupEmail}
                    onChange={(e) => setLookupEmail(e.target.value)}
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

              <div className="mt-4 rounded-xl border border-slate-800/80 bg-slate-900/25 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Optional entry (visual only)</div>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs text-slate-500">Name</label>
                    <input disabled className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900/30 px-3 py-2 text-sm text-slate-500" defaultValue="Preview field" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500">Phone</label>
                    <input disabled className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900/30 px-3 py-2 text-sm text-slate-500" defaultValue="Preview field" />
                  </div>
                </div>
              </div>
            </ConsoleCard>
          ) : null}

          {unlocked && workflow === "create" ? (
            <ConsoleCard>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold text-slate-100">Create New User</div>
                  <div className="mt-1 text-xs text-slate-400">
                    Identity fields are visual entry only. Access is configured via pads.
                  </div>
                </div>
                <div className="text-[11px] text-slate-500">Email: <span className="text-slate-200 font-semibold">{createForm.email || "—"}</span></div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-500">Full name</label>
                  <input
                    value={createForm.name}
                    onChange={(e) => setCreateForm((p) => ({ ...p, name: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm text-slate-200 outline-none focus:border-sky-500/50"
                    placeholder="Full name"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500">Phone</label>
                  <input
                    value={createForm.phone}
                    onChange={(e) => setCreateForm((p) => ({ ...p, phone: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm text-slate-200 outline-none focus:border-sky-500/50"
                    placeholder="Phone"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-500">Email</label>
                  <input
                    value={createForm.email}
                    onChange={(e) => setCreateForm((p) => ({ ...p, email: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm text-slate-200 outline-none focus:border-sky-500/50"
                    placeholder="user@company.com"
                    inputMode="email"
                  />
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setWorkflow("idle");
                    setSelectedUserId(null);
                    setLookupEmail(createForm.email);
                    setCreateForm({ name: "", phone: "", email: createForm.email });
                    setToast(null);
                  }}
                  className="rounded-xl border border-slate-800/80 bg-slate-900/30 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-slate-800/60 hover:border-slate-600/90 transition-all"
                >
                  Back to lookup
                </button>
                <button
                  type="button"
                  onClick={createUserPrototype}
                  disabled={!createForm.name.trim() || !createForm.phone.trim() || !createForm.email.trim()}
                  className="rounded-xl border border-sky-500/40 bg-sky-500/10 px-4 py-2.5 text-sm font-semibold text-sky-200 hover:bg-sky-500/15 hover:border-sky-500/60 disabled:opacity-60 disabled:pointer-events-none transition-all"
                >
                  Create user
                </button>
              </div>

              <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-200/80">Next step</div>
                <div className="mt-1 text-xs text-amber-100">
                  This new user will be created as <span className="font-semibold">Branch User</span> with explicit scope required.
                </div>
              </div>
            </ConsoleCard>
          ) : null}

          {unlocked && workflow === "found" ? (
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
                      {selectedUser?.status === "active"
                        ? "Active"
                        : selectedUser?.status === "disabled"
                          ? "Disabled"
                          : "Pending"}
                    </span>
                  </div>
                </div>

                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-100 truncate">{selectedUser?.name ?? "—"}</div>
                    <div className="mt-1 text-xs text-slate-400 truncate">
                      {selectedUser?.email ?? "—"} • {selectedUser?.phone ?? "—"}
                    </div>
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
                        setSelectedBranchIds(branches.map((b) => b.id));
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
                        setSelectedBranchIds([]); // explicit: require scope routing
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
                    <div className="mt-1 text-xs text-slate-400">Operational enablement for this identity.</div>
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Current:{" "}
                    <span className="text-slate-200 font-semibold">
                      {selectedUser?.status === "active"
                        ? "Active"
                        : selectedUser?.status === "disabled"
                          ? "Disabled"
                          : "Pending"}
                    </span>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <PadButton
                    label="Active"
                    description="Identity is enabled."
                    tone="primary"
                    active={selectedUser?.status === "active"}
                    disabled={!unlocked}
                    onClick={() => setUserStatus("active")}
                  />
                  <PadButton
                    label="Disabled"
                    description="Access and pads are blocked."
                    tone="danger"
                    active={selectedUser?.status === "disabled"}
                    disabled={!unlocked}
                    onClick={() => setUserStatus("disabled")}
                  />
                </div>
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
                    disabled={branchScopeInvalid || userIsDisabled}
                    onClick={applyPrototypeChanges}
                    className="rounded-xl border border-sky-500/40 bg-sky-500/10 px-4 py-2.5 text-sm font-semibold text-sky-200 hover:bg-sky-500/15 hover:border-sky-500/60 disabled:opacity-60 disabled:pointer-events-none transition-all"
                  >
                    Apply access
                  </button>
                  <div className="text-xs text-slate-400">
                    UI shell only. Backend wiring connects later.
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
                      <span className="text-slate-100 font-semibold">{workflow === "found" ? selectedUser?.name ?? "—" : "—"}</span>
                    </div>
                    <div className="mt-1">
                      Email:{" "}
                      <span className="text-slate-100 font-semibold">
                        {workflow === "found" ? selectedUser?.email ?? "—" : workflow === "create" ? createForm.email || "—" : "—"}
                      </span>
                    </div>
                    <div className="mt-1">
                      Phone:{" "}
                      <span className="text-slate-100 font-semibold">
                        {workflow === "found" ? selectedUser?.phone ?? "—" : workflow === "create" ? createForm.phone || "—" : "—"}
                      </span>
                    </div>
                    {workflow === "found" ? (
                      <div className="mt-1">
                        Status:{" "}
                        <span className="text-slate-100 font-semibold">
                          {selectedUser?.status === "active"
                            ? "Active"
                            : selectedUser?.status === "disabled"
                              ? "Disabled"
                              : "Pending"}
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
                      <div className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1 text-[11px] font-semibold ${
                        unlocked ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-200" : "border-amber-500/25 bg-amber-500/10 text-amber-200"
                      }`}>
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
                      {workflow === "found" || workflow === "create"
                        ? accessMode === "OWNER"
                          ? "Full Network"
                          : "Assigned Scope"
                        : accessMode === "OWNER"
                          ? "Full Network"
                          : "Assigned Scope"}
                    </span>
                    <br />
                    Scope: <span className="text-slate-100 font-semibold">{workflow === "found" ? selectedBranchNames : "—"}</span>
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
                          <span className={`rounded-lg border px-2 py-0.5 text-[11px] font-semibold ${badgeTone(s)}`}>{stateLabel(s)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </ConsoleCard>

            {toast ? (
              <ConsoleCard className="border-slate-800/80 bg-slate-950/30">
                <div className="text-xs text-slate-300">{toast}</div>
              </ConsoleCard>
            ) : null}
          </div>
        </div>
      </div>

      {pendingSensitive ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setPendingSensitive(null)}
            aria-hidden
          />
          <div className="relative w-full max-w-lg rounded-2xl border border-slate-800/80 bg-slate-950 p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.03)]">
            <div className="text-sm font-semibold text-slate-100">Operational confirmation</div>
            <div className="mt-1 text-xs text-slate-400">
              This is a UI foundation step. No backend action will be executed.
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
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setPendingSensitive(null);
                  setToast("Confirmed. No backend action performed.");
                }}
                className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm font-semibold text-amber-200 hover:bg-amber-500/15 hover:border-amber-500/60 transition-all"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

