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
import "@/components/roles/permissions-hub.css";

type Tab = "people" | "roles";

export function PermissionsHub() {
  const tr = useTr();
  const [tab, setTab] = useState<Tab>("people");
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
        if (new URLSearchParams(window.location.search).get("tab") === "roles") setTab("roles");
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
      if (t === "roles") u.searchParams.set("tab", "roles");
      else u.searchParams.delete("tab");
      window.history.replaceState(null, "", u.toString());
    } catch {
      /* the tab still switches */
    }
  };

  if (person) {
    return <PersonPage userId={person} roles={rolesOn ? roles : []} onBack={() => setPerson(null)} onEditRole={(id) => { setSelectedRole(id); setPerson(null); pick("roles"); }} />;
  }

  return (
    <div className="sb-ph">
      {rolesOn ? (
        <div className="sb-ph-tabs" role="tablist" aria-label={tr("Permissions")}>
          <button type="button" role="tab" aria-selected={tab === "people"} className="sb-ph-tab" onClick={() => pick("people")}>{tr("People")}</button>
          <button type="button" role="tab" aria-selected={tab === "roles"} className="sb-ph-tab" onClick={() => pick("roles")}>{tr("Roles")}</button>
        </div>
      ) : null}
      {tab === "roles" && rolesOn ? (
        <RolesHub roles={roles} customCode={customCode} onRolesChange={setRoles} reload={load} selectedId={selectedRole} onSelect={setSelectedRole} onOpenPerson={setPerson} />
      ) : (
        <PeopleGrid onOpenPerson={setPerson} />
      )}
    </div>
  );
}
