"use client";

/**
 * PERMISSIONS — the screen (owner 2026-10-31, "like Discord"): two tabs on top, PEOPLE and ROLES. People = the squares (a press opens the person's own full page); Roles = the list of roles with every permission
 * of the chosen one. The tab and the open role / person live here so a press on "Edit this role" from a person's page lands on that role. Draws NOTHING it cannot serve: without roles switched on (SYNCBIZ_ROLES) there
 * is only the People tab. Workspace admins only (the data routes answer 403 to anyone else and the tabs stay hidden).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTr } from "@/lib/i18n/use-tr";
import { PeopleGrid } from "@/components/roles/people-grid";
import { RolesHub, type RoleView } from "@/components/roles/roles-hub";
import { PersonPage } from "@/components/roles/person-page";
import { EnrollmentRequestsPanel } from "@/components/control-room/device-enrollment-panel";
import { useEnrollmentSummary } from "@/lib/use-enrollment-summary";
import "@/components/roles/permissions-hub.css";

type Tab = "people" | "roles" | "requests";

export function PermissionsHub() {
  const tr = useTr();
  const [tab, setTab] = useState<Tab>("people");
  const enr = useEnrollmentSummary();
  // owner 2026-10-31: the requests of people's devices live HERE (the Control Room's first tile is "New branch" now)
  const showRequests = enr.loaded && enr.available && ((enr.enabled && enr.canDecide) || (!enr.enabled && enr.isAdmin));
  const [person, setPerson] = useState<string | null>(null);
  const [rolesOn, setRolesOn] = useState(false);
  const [roles, setRoles] = useState<RoleView[]>([]);
  const [customCode, setCustomCode] = useState(false);
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/roles", { credentials: "include", cache: "no-store" });
      if (!r.ok) return;
      const j = (await r.json()) as { enabled?: boolean; roles?: RoleView[]; customCode?: boolean };
      if (!alive.current) return;
      setRolesOn(Boolean(j.enabled));
      setRoles(j.roles ?? []);
      setCustomCode(Boolean(j.customCode));
    } catch {
      /* offline — keep what is shown */
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    const t = window.setTimeout(() => {
      void load();
      try {
        const q = new URLSearchParams(window.location.search).get("tab");
        if (q === "roles" || q === "requests") setTab(q);
      } catch {
        /* the People tab it is */
      }
    }, 0);
    const onFocus = () => void load(); // another admin may have changed a role
    window.addEventListener("focus", onFocus);
    return () => { alive.current = false; window.clearTimeout(t); window.removeEventListener("focus", onFocus); };
  }, [load]);

  // the roles list answers with the first role chosen, so the Roles tab never opens on an empty page
  useEffect(() => {
    if (tab === "roles" && !selectedRole && roles.length > 0) {
      const t = window.setTimeout(() => setSelectedRole(roles[0].id), 0);
      return () => window.clearTimeout(t);
    }
  }, [tab, selectedRole, roles]);

  const pick = (t: Tab) => {
    setTab(t);
    setPerson(null);
    try {
      const u = new URL(window.location.href);
      if (t !== "people") u.searchParams.set("tab", t);
      else u.searchParams.delete("tab");
      window.history.replaceState(null, "", u.toString());
    } catch {
      /* the tab still switches */
    }
  };

  if (person) {
    return <PersonPage userId={person} roles={rolesOn ? roles : []} reloadRoles={load} onBack={() => setPerson(null)} onEditRole={(id) => { setSelectedRole(id); setPerson(null); pick("roles"); }} />;
  }

  return (
    <div className="sb-ph">
      {rolesOn || showRequests ? (
        <div className="sb-ph-tabs" role="tablist" aria-label={tr("Permissions")}>
          <button type="button" role="tab" aria-selected={tab === "people"} className="sb-ph-tab" onClick={() => pick("people")}>{tr("People")}</button>
          {rolesOn ? <button type="button" role="tab" aria-selected={tab === "roles"} className="sb-ph-tab" onClick={() => pick("roles")}>{tr("Roles")}</button> : null}
          {showRequests ? (
            <button type="button" role="tab" aria-selected={tab === "requests"} className="sb-ph-tab" onClick={() => pick("requests")}>
              {tr("Requests")}{enr.count > 0 ? <span className="sb-ph-count">{enr.count > 9 ? "9+" : enr.count}</span> : null}
            </button>
          ) : null}
        </div>
      ) : null}
      {tab === "requests" && showRequests ? (
        <EnrollmentRequestsPanel embedded onOpenBranch={() => window.location.assign("/owner/control-room")} />
      ) : tab === "roles" && rolesOn ? (
        <RolesHub roles={roles} customCode={customCode} onRolesChange={setRoles} reload={load} selectedId={selectedRole} onSelect={setSelectedRole} onOpenPerson={setPerson} />
      ) : (
        <PeopleGrid onOpenPerson={setPerson} />
      )}
    </div>
  );
}
