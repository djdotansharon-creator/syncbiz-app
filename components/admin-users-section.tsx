"use client";

import { useState, useEffect } from "react";

type UserSummary = {
  id: string;
  email: string;
  tenantId: string;
  createdAt: string;
  name?: string;
  accessType: "OWNER" | "BRANCH_USER";
  branchIds: string[];
};
type BranchOption = { id: string; name: string };
type SessionSummary = { accessType?: "OWNER" | "BRANCH_USER"; branchIds?: string[] };

export function AdminUsersSection() {
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [myAccessType, setMyAccessType] = useState<"OWNER" | "BRANCH_USER" | null>(null);
  const [myBranchIds, setMyBranchIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accessType, setAccessType] = useState<"OWNER" | "BRANCH_USER">("BRANCH_USER");
  // No default pre-selection: for BRANCH_USER the admin must explicitly choose branches.
  const [selectedBranchIds, setSelectedBranchIds] = useState<string[]>([]);
  const [status, setStatus] = useState<"idle" | "creating" | "error" | "ok">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [newBranchName, setNewBranchName] = useState("");
  const [newBranchId, setNewBranchId] = useState("");
  const [branchCreateStatus, setBranchCreateStatus] = useState<"idle" | "creating" | "error" | "ok">("idle");
  const [branchCreateError, setBranchCreateError] = useState("");
  const [editEmail, setEditEmail] = useState<string | null>(null);
  const [editName, setEditName] = useState<string>("");
  const [editAccessType, setEditAccessType] = useState<"OWNER" | "BRANCH_USER">("BRANCH_USER");
  const [editSelectedBranchIds, setEditSelectedBranchIds] = useState<string[]>([]);
  const [editStatus, setEditStatus] = useState<"idle" | "saving" | "error" | "ok">("idle");
  const [editErrorMsg, setEditErrorMsg] = useState<string>("");
  /** Optional: set a new password for the user (never shown back; stored as hash only). */
  const [editNewPassword, setEditNewPassword] = useState("");

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/auth/me").then((r) => r.json()),
      fetch("/api/admin/users").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/branches").then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([me, list, branchList]) => {
        if (cancelled) return;
        const meData = me as SessionSummary;
        const at = meData.accessType;
        setCanManage(at === "OWNER");
        setMyAccessType(at ?? null);
        setMyBranchIds(Array.isArray(meData.branchIds) ? meData.branchIds : []);
        setUsers(Array.isArray(list) ? list : []);
        const branchOpts = Array.isArray(branchList)
          ? branchList.map((b: { id: string; name: string }) => ({ id: b.id, name: b.name }))
          : [];
        if (branchOpts.length > 0 && !branchOpts.some((b) => b.id === "default")) {
          branchOpts.unshift({ id: "default", name: "Default (legacy)" });
        }
        setBranches(
          branchOpts.length > 0 ? branchOpts : [{ id: "default", name: "Default (legacy)" }]
        );
      })
      .catch(() => {
        if (!cancelled) setCanManage(false);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const toggleBranch = (id: string) => {
    setSelectedBranchIds((prev) =>
      prev.includes(id) ? prev.filter((b) => b !== id) : [...prev, id]
    );
  };

  const toggleEditBranch = (id: string) => {
    setEditSelectedBranchIds((prev) =>
      prev.includes(id) ? prev.filter((b) => b !== id) : [...prev, id]
    );
  };

  const reloadUsers = async () => {
    const res = await fetch("/api/admin/users");
    const next = res.ok ? await res.json() : [];
    setUsers(Array.isArray(next) ? next : []);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("creating");
    setErrorMsg("");
    try {
      if (accessType === "BRANCH_USER" && selectedBranchIds.length === 0) {
        setStatus("error");
        setErrorMsg("Please select at least one branch for Branch User.");
        return;
      }
      const branchIds = accessType === "OWNER" ? [] : selectedBranchIds;
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          password,
          accessType,
          branchIds: accessType === "BRANCH_USER" ? branchIds : undefined,
        }),
      });
      const data = (await res.json()) as { error?: string; code?: string };
      if (!res.ok) {
        setStatus("error");
        setErrorMsg(data.error ?? "Failed");
        if (res.status === 409 && data.code === "USER_EXISTS") {
          // Switch to edit mode for existing user.
          const existing = users.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
          setEditEmail(email.trim());
          setEditName(existing?.name ?? "");
          setEditAccessType(existing?.accessType ?? "BRANCH_USER");
          setEditSelectedBranchIds(existing?.branchIds?.length ? existing.branchIds : []);
          setEditStatus("idle");
          setEditErrorMsg("");
        }
        return;
      }
      await reloadUsers();
      setStatus("ok");
      setEmail("");
      setPassword("");
      setAccessType("BRANCH_USER");
      setSelectedBranchIds([]);
    } catch {
      setStatus("error");
      setErrorMsg("Network error");
    }
  };

  const reloadBranches = async () => {
    const res = await fetch("/api/branches");
    const branchList = res.ok ? await res.json() : [];
    const branchOpts = Array.isArray(branchList)
      ? branchList.map((b: { id: string; name: string }) => ({ id: b.id, name: b.name }))
      : [];
    if (branchOpts.length > 0 && !branchOpts.some((b) => b.id === "default")) {
      branchOpts.unshift({ id: "default", name: "Default (legacy)" });
    }
    const next =
      branchOpts.length > 0 ? branchOpts : [{ id: "default", name: "Default (legacy)" }];
    setBranches(next);
    setSelectedBranchIds((prev) => prev.filter((id) => next.some((b) => b.id === id)));
  };

  const handleCreateBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    setBranchCreateStatus("creating");
    setBranchCreateError("");
    try {
      const payload = {
        name: newBranchName.trim(),
        id: newBranchId.trim() || undefined,
      };
      const res = await fetch("/api/branches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setBranchCreateStatus("error");
        setBranchCreateError(data.error ?? "Failed to create branch");
        return;
      }
      setBranchCreateStatus("ok");
      setNewBranchName("");
      setNewBranchId("");
      await reloadBranches();
    } catch {
      setBranchCreateStatus("error");
      setBranchCreateError("Network error");
    }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editEmail) return;
    if (editAccessType === "BRANCH_USER" && editSelectedBranchIds.length === 0) {
      setEditStatus("error");
      setEditErrorMsg("Please select at least one branch for Branch User.");
      return;
    }
    setEditStatus("saving");
    setEditErrorMsg("");
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: editEmail,
          name: editName,
          accessType: editAccessType,
          branchIds: editAccessType === "BRANCH_USER" ? editSelectedBranchIds : undefined,
          ...(editNewPassword.trim().length > 0 ? { newPassword: editNewPassword } : {}),
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setEditStatus("error");
        setEditErrorMsg(data.error ?? "Failed");
        return;
      }
      await reloadUsers();
      setEditStatus("ok");
      setEditNewPassword("");
      setTimeout(() => {
        setEditEmail(null);
        setEditName("");
        setEditAccessType("BRANCH_USER");
        setEditSelectedBranchIds([]);
        setEditStatus("idle");
        setEditErrorMsg("");
      }, 400);
    } catch {
      setEditStatus("error");
      setEditErrorMsg("Network error");
    }
  };

  if (loading || !canManage) return null;

  return (
    <section className="rounded-2xl border border-slate-800/80 bg-slate-950/50 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-50">User Access Control</h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Manage tenant users and their branch permissions.
          </p>
          <p className="mt-2 text-xs text-slate-500">
            Session scope: {myAccessType ?? "UNKNOWN"} | branches:{" "}
            {myBranchIds.length > 0 ? myBranchIds.join(", ") : "none"}
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-4">
        <div className="rounded-lg border border-slate-800/60 bg-slate-900/30 p-3">
          <p className="text-xs font-medium text-slate-300">Branch creation (validation)</p>
          <form onSubmit={handleCreateBranch} className="mt-3 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs text-slate-500">Branch name</label>
                <input
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value)}
                  required
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 placeholder-slate-500"
                  placeholder="Branch A"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500">Branch id (optional)</label>
                <input
                  value={newBranchId}
                  onChange={(e) => setNewBranchId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 placeholder-slate-500"
                  placeholder="branch-a"
                />
              </div>
            </div>
            {branchCreateStatus === "error" && <p className="text-xs text-red-400">{branchCreateError}</p>}
            {branchCreateStatus === "ok" && <p className="text-xs text-emerald-400">Branch created</p>}
            <button
              type="submit"
              disabled={branchCreateStatus === "creating"}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-medium text-slate-100 hover:bg-slate-700 disabled:opacity-50"
            >
              {branchCreateStatus === "creating" ? "Creating…" : "Create branch"}
            </button>
          </form>
        </div>

        <div className="rounded-lg border border-slate-800/60 bg-slate-900/30 p-3">
          <p className="text-xs font-medium text-slate-300">Create user</p>
          <form onSubmit={handleCreate} className="mt-3 space-y-3">
            <div>
              <label className="block text-xs text-slate-500">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 placeholder-slate-500"
                placeholder="user@example.com"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-100"
                placeholder="Min 6 characters"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500">Access type</label>
              <select
                value={accessType}
                onChange={(e) => setAccessType(e.target.value as "OWNER" | "BRANCH_USER")}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-200"
              >
                <option value="OWNER">Owner (full tenant access)</option>
                <option value="BRANCH_USER">Branch User (assigned branches only)</option>
              </select>
            </div>
            {accessType === "BRANCH_USER" && (
              <div>
                <label className="block text-xs text-slate-500">Assigned branches</label>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {branches.map((b) => {
                    const checked = selectedBranchIds.includes(b.id);
                    return (
                      <label
                        key={b.id}
                        className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-1 text-sm transition ${
                          checked
                            ? "border-sky-500/50 bg-sky-500/10 text-sky-200"
                            : "border-slate-800 bg-slate-900/40 text-slate-300 hover:bg-slate-900/60"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleBranch(b.id)}
                          className="rounded border-slate-600 bg-slate-800"
                        />
                        {b.name}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
            {status === "error" && <p className="text-xs text-red-400">{errorMsg}</p>}
            {status === "ok" && <p className="text-xs text-emerald-400">User added</p>}
            <button
              type="submit"
              disabled={status === "creating"}
              className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
            >
              {status === "creating" ? "Creating…" : "Create user"}
            </button>
          </form>
        </div>
      </div>
      {editEmail && (
        <div className="mt-6 rounded-lg border border-slate-800/60 bg-slate-900/30 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-50">Edit user</h3>
              <p className="mt-1 text-xs text-slate-500">Email (id): {editEmail}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setEditEmail(null);
                setEditName("");
                setEditAccessType("BRANCH_USER");
                setEditSelectedBranchIds([]);
                setEditNewPassword("");
                setEditStatus("idle");
                setEditErrorMsg("");
              }}
              className="shrink-0 rounded-lg border border-slate-700/80 bg-slate-800/60 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-800/40"
            >
              Cancel
            </button>
          </div>

          <form onSubmit={handleSaveEdit} className="mt-4 space-y-3">
            <div>
              <label className="block text-xs text-slate-500">Display name</label>
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 placeholder-slate-500"
                placeholder="Display name"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-500">New password (optional)</label>
              <input
                type="password"
                value={editNewPassword}
                onChange={(e) => setEditNewPassword(e.target.value)}
                minLength={6}
                autoComplete="new-password"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 placeholder-slate-500"
                placeholder="Leave blank to keep current"
              />
              <p className="mt-1 text-xs text-slate-500">
                You cannot view a user&apos;s current password — only set a new one (min. 6 characters).
              </p>
            </div>

            <div>
              <label className="block text-xs text-slate-500">Access type</label>
              <select
                value={editAccessType}
                onChange={(e) => {
                  const next = e.target.value as "OWNER" | "BRANCH_USER";
                  setEditAccessType(next);
                  if (next === "OWNER") setEditSelectedBranchIds([]);
                }}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-200"
              >
                <option value="OWNER">Owner (full tenant access)</option>
                <option value="BRANCH_USER">Branch User (assigned branches only)</option>
              </select>
            </div>

            {editAccessType === "BRANCH_USER" && (
              <div>
                <label className="block text-xs text-slate-500">Assigned branches</label>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {branches.map((b) => (
                    (() => {
                      const checked = editSelectedBranchIds.includes(b.id);
                      return (
                        <label
                          key={b.id}
                          className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-1 text-sm transition ${
                            checked
                              ? "border-sky-500/50 bg-sky-500/10 text-sky-200"
                              : "border-slate-800 bg-slate-900/40 text-slate-300 hover:bg-slate-900/60"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleEditBranch(b.id)}
                            className="rounded border-slate-600 bg-slate-800"
                          />
                          {b.name}
                        </label>
                      );
                    })()
                  ))}
                </div>
              </div>
            )}

            {editStatus === "error" && <p className="text-xs text-red-400">{editErrorMsg}</p>}
            {editStatus === "ok" && <p className="text-xs text-emerald-400">Update saved</p>}

            <button
              type="submit"
              disabled={editStatus === "saving"}
              className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
            >
              {editStatus === "saving" ? "Saving…" : "Save changes"}
            </button>
          </form>
        </div>
      )}
      {users.length > 0 && (
        <div className="mt-6 border-t border-slate-800/60 pt-4">
          <p className="text-xs text-slate-500">Active users</p>
          <ul className="mt-2 space-y-1 text-sm text-slate-300">
            {users.map((u) => (
              <li key={u.id}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <span className="truncate font-medium text-slate-200">{u.name?.trim() ? u.name : u.email}</span>
                    <span className="text-slate-600">
                      {" "}
                      · {u.accessType === "OWNER" ? "Owner" : "Branch User"}
                      {u.accessType === "BRANCH_USER"
                        ? ` (${u.branchIds.length ? u.branchIds.join(", ") : "no branches"})`
                        : " (all branches)"}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setEditEmail(u.email);
                      setEditName(u.name ?? "");
                      setEditAccessType(u.accessType);
                      setEditSelectedBranchIds(u.branchIds?.length ? u.branchIds : []);
                      setEditNewPassword("");
                      setEditStatus("idle");
                      setEditErrorMsg("");
                    }}
                    className="shrink-0 rounded-lg border border-slate-700 bg-slate-800/50 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-slate-800/30"
                  >
                    Edit
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
