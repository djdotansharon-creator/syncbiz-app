"use client";

import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { useTr } from "@/lib/i18n/use-tr";
import { JOIN_CHANGED_EVENT } from "@/lib/use-join-pending";
import { decideRequest, defaultApprovalRole, peopleErrorText, usePeopleAdmin } from "@/lib/mobile-people";
import { VmPage, useVmUi } from "@/components/vm/vm-ui";
import { VmCover } from "@/components/vm/vm-parts";
import { IconCheck, IconPeople } from "@/components/vm/vm-icons";
import { VmBack } from "@/components/vm/vm-people-parts";

/** a person who asked to join with a code: who they are, the role they get, and the decision (the same two calls and the same default role as the computer's Permissions screen) */
export default function MobileJoinRequestPage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(String(params?.id ?? ""));
  const tr = useTr();
  const ui = useVmUi();
  const router = useRouter();
  const d = usePeopleAdmin();
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const back = <VmBack fallback="/mobile/people" label={tr("People")} />;
  if (d.state === "loading") return <VmPage title="…" lead={back}><span /></VmPage>;
  if (d.state !== "ready") {
    return (
      <VmPage title={tr("People")} lead={back}>
        <div className="vm-empty">
          <IconPeople />
          <span>{tr(d.state === "hidden" ? "Only an administrator can manage people." : "Something went wrong. Please try again.")}</span>
          {d.state === "error" ? <button type="button" className="vm-pill" onClick={d.retry}>{tr("Try again")}</button> : null}
        </div>
      </VmPage>
    );
  }
  const req = d.requests.find((r) => r.id === id) ?? null;
  if (!req) {
    return (
      <VmPage title={tr("People")} lead={back}>
        <div className="vm-empty">
          <IconPeople />
          <span>{tr("This request was already handled.")}</span>
        </div>
      </VmPage>
    );
  }

  const name = `${req.firstName} ${req.lastName}`.trim() || req.email;
  const chosen = picked ?? defaultApprovalRole(d.roles);
  const options = d.rolesOn ? d.roles.map((r) => ({ id: r.id, name: r.name })) : [{ id: "MEMBER", name: tr("Member") }, { id: "MANAGER", name: tr("Manager") }];

  async function decide(decision: "approve" | "reject") {
    setBusy(true);
    setError("");
    const r = await decideRequest(req!.id, decision, chosen, d.state === "ready" && d.rolesOn);
    if (!r.ok) {
      setError(tr(peopleErrorText(r.error)));
      setBusy(false);
      return;
    }
    window.dispatchEvent(new Event(JOIN_CHANGED_EVENT)); // the red circle on the computer re-counts at once
    ui.toast(tr(decision === "approve" ? "Approved" : "Rejected"));
    router.replace("/mobile/people");
  }

  return (
    <VmPage title={name} barTitle={name} lead={back}>
      <div className="vm-hero" style={{ paddingTop: 4 }}>
        <VmCover name={name} size={84} radius={999} />
        <div className="vm-hero-sub" style={{ color: "var(--vm-warn, #e0a030)" }}>{tr("Waiting for approval")}</div>
        <div className="vm-hero-sub vm-bdi" dir="ltr">{req.email}</div>
        {req.phone ? <div className="vm-hero-sub vm-bdi" dir="ltr">{req.phone}</div> : null}
        <div className="vm-hero-sub">{req.hasAccount ? tr("Already has an account") : tr("New account")}</div>
      </div>

      <div className="vm-sec">{tr("Role")}</div>
      <div className="vm-group" style={{ marginTop: 0 }} role="radiogroup" aria-label={tr("Role")}>
        {options.map((o) => (
          <button key={o.id} type="button" className="vm-line" role="radio" aria-checked={chosen === o.id} onClick={() => setPicked(o.id)}>
            <span className="vm-tick vm-tick--round" data-on={chosen === o.id ? "" : undefined}>{chosen === o.id ? <IconCheck /> : null}</span>
            <span className="vm-line-text vm-bdi">{o.name}</span>
          </button>
        ))}
      </div>

      <div className="vm-ask-inline">
        <button type="button" className="vm-ask-btn" data-main="" disabled={busy} onClick={() => void decide("approve")}>{tr("Approve")}</button>
        <button type="button" className="vm-ask-btn" data-danger="" disabled={busy} onClick={() => void decide("reject")}>{tr("Reject")}</button>
      </div>
      {error ? <p className="vm-err" role="alert">{error}</p> : null}
    </VmPage>
  );
}
