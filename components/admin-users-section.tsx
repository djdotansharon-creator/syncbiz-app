"use client";

import { useState, useEffect } from "react";

type UserSummary = { id: string; email: string; tenantId: string; createdAt: string };
type BranchOption = { id: string; name: string };

export function AdminUsersSection() {
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accessType, setAccessType] = useState<"OWNER" | "BRANCH_USER">("BRANCH_USER");
  const [selectedBranchIds, setSelectedBranchIds] = useState<string[]>(["default"]);
  const [status, setStatus] = useState<"idle" | "creating" | "error" | "ok">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/auth/me").then((r) => r.json()),
      fetch("/api/admin/users").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/branches").then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([me, list, branchList]) => {
        if (cancelled) return;
        const at = (me as { accessType?: string }).accessType;
        setCanManage(at === "OWNER");
        setUsers(Array.isArray(list) ? list : []);
        const branchOpts = Array.isArray(branchList)
          ? branchList.map((b: { id: string; name: string }) => ({ id: b.id, name: b.name }))
          : [];
        if (branchOpts.length > 0 && !branchOpts.some((b) => b.id === "default")) {
          branchOpts.unshift({ id: "default", name: "Default" });
        }
        setBranches(branchOpts.length > 0 ? branchOpts : [{ id: "default", name: "Default" }]);
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

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("creating");
    setErrorMsg("");
    try {
      const branchIds = accessType === "OWNER" ? [] : (selectedBranchIds.length > 0 ? selectedBranchIds : ["default"]);
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
      const data = (await res.json()) as { error?: string } & UserSummary;
      if (!res.ok) {
        setStatus("error");
        setErrorMsg(data.error ?? "Failed");
        return;
      }
      setStatus("ok");
      setEmail("");
      setPassword("");
      setUsers((prev) => [...prev, data]);
    } catch {
      setStatus("error");
      setErrorMsg("Network error");
    }
  };

  if (loading || !canManage) return null;

  return (
    <section className="rounded-2xl border border-slate-800/80 bg-slate-950/50 p-5">
      <h2 className="text-sm font-semibold text-slate-50">Users</h2>
      <p className="mt-0.5 text-xs text-slate-400">
        Create additional users. V1: Owner (full account) or Branch User (assigned branches only).
      </p>
      <form onSubmit={handleCreate} className="mt-4 space-y-3">
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
            <option value="OWNER">Owner (full account access)</option>
            <option value="BRANCH_USER">Branch User (assigned branches only)</option>
          </select>
        </div>
        {accessType === "BRANCH_USER" && (
          <div>
            <label className="block text-xs text-slate-500">Assigned branches</label>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {branches.map((b) => (
                <label key={b.id} className="flex cursor-pointer items-center gap-1.5 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={selectedBranchIds.includes(b.id)}
                    onChange={() => toggleBranch(b.id)}
                    className="rounded border-slate-600 bg-slate-800"
                  />
                  {b.name}
                </label>
              ))}
            </div>
          </div>
        )}
        {status === "error" && <p className="text-xs text-red-400">{errorMsg}</p>}
        {status === "ok" && <p className="text-xs text-emerald-400">User created</p>}
        <button
          type="submit"
          disabled={status === "creating"}
          className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
        >
          {status === "creating" ? "Creating…" : "Create user"}
        </button>
      </form>
      {users.length > 0 && (
        <div className="mt-6 border-t border-slate-800/60 pt-4">
          <p className="text-xs text-slate-500">Current users</p>
          <ul className="mt-2 space-y-1 text-sm text-slate-300">
            {users.map((u) => (
              <li key={u.id}>
                {u.email} <span className="text-slate-600">({u.id.slice(0, 12)}…)</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
