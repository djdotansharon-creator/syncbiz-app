"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useTr } from "@/lib/i18n/use-tr";
import { matchesPerson, orderPeople, usePeopleAdmin, type PersonRow } from "@/lib/mobile-people";
import { VmPage } from "@/components/vm/vm-ui";
import { VmCover } from "@/components/vm/vm-parts";
import { IconChevronForward, IconPeople, IconPlus, IconSearch } from "@/components/vm/vm-icons";
import { VmBack, agoLabel, levelLabel, stateLabel } from "@/components/vm/vm-people-parts";

/**
 * PEOPLE — everyone in the business, for the administrator (owner 2026-11-18: "a manager must be able to control these things from afar, depending on the level").
 * The same data and the same server rules as the computer's Permissions screen (lib/mobile-people.ts): who is waiting to join, adding a person (a one-time code), and every person's own page
 * (role, branches, pause / remove). Anyone who is not an administrator gets one sentence and nothing else.
 */
export default function MobilePeoplePage() {
  const tr = useTr();
  const d = usePeopleAdmin();
  const [q, setQ] = useState("");

  const ready = d.state === "ready" ? d : null;
  const shown = useMemo(() => (ready ? orderPeople(ready.people.filter((p) => matchesPerson(p, levelLabel(p.level, tr), q))) : []), [ready, q, tr]);
  const waiting = useMemo(() => (ready ? ready.requests.filter((r) => matchesPerson({ name: `${r.firstName} ${r.lastName}`, email: r.email, roleName: null }, tr("Waiting for approval"), q)) : []), [ready, q, tr]);

  const line = (p: PersonRow) => (
    <Link key={p.userId} href={`/mobile/people/${encodeURIComponent(p.userId)}`} className="vm-line" style={{ opacity: p.status === "active" ? 1 : 0.55 }}>
      <VmCover name={p.name || p.email} size={40} radius={999} />
      <span className="vm-line-text vm-bdi">
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
          {p.name}
          {p.isYou ? ` (${tr("You")})` : ""}
        </span>
        <small>
          {p.roleName ?? levelLabel(p.level, tr)} · {p.status === "active" ? agoLabel(p.lastSignInAt, tr) : stateLabel(p.status, tr)}
        </small>
      </span>
      <IconChevronForward className="vm-chev vm-flip" />
    </Link>
  );

  return (
    <VmPage title={tr("People")} lead={<VmBack fallback="/mobile/account" label={tr("Back")} />}>
      {d.state === "loading" ? <p className="vm-sub" style={{ margin: "24px", textAlign: "center" }}>…</p> : null}
      {d.state === "hidden" ? (
        <div className="vm-empty">
          <IconPeople />
          <h2>{tr("People")}</h2>
          <span>{tr("Only an administrator can manage people.")}</span>
        </div>
      ) : null}
      {d.state === "error" ? (
        <div className="vm-empty">
          <IconPeople />
          <h2>{tr("People")}</h2>
          <span>{tr("Something went wrong. Please try again.")}</span>
          <button type="button" className="vm-pill" onClick={d.retry}>{tr("Try again")}</button>
        </div>
      ) : null}
      {ready ? (
        <>
          <label className="vm-field">
            <IconSearch />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("Search by name or role")} aria-label={tr("Search by name or role")} />
          </label>

          {ready.joinOn ? (
            <div className="vm-group">
              <Link href="/mobile/people/add" className="vm-line">
                <IconPlus />
                <span className="vm-line-text">
                  {tr("Add a person")}
                  <small>{tr("A one-time code, a QR and a link")}</small>
                </span>
                <IconChevronForward className="vm-chev vm-flip" />
              </Link>
            </div>
          ) : null}

          {waiting.length > 0 ? (
            <>
              <div className="vm-sec">
                {tr("Waiting for approval")} <b>{waiting.length}</b>
              </div>
              <div className="vm-group" style={{ marginTop: 8 }}>
                {waiting.map((r) => {
                  const name = `${r.firstName} ${r.lastName}`.trim() || r.email;
                  return (
                    <Link key={r.id} href={`/mobile/people/request/${encodeURIComponent(r.id)}`} className="vm-line">
                      <VmCover name={name} size={40} radius={999} />
                      <span className="vm-line-text vm-bdi">
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
                        <small style={{ color: "var(--vm-warn, #e0a030)" }}>{tr("Waiting for approval")}</small>
                      </span>
                      <IconChevronForward className="vm-chev vm-flip" />
                    </Link>
                  );
                })}
              </div>
            </>
          ) : null}

          <div className="vm-sec">
            {tr("Everyone")} <b>{shown.length}</b>
          </div>
          {shown.length === 0 ? (
            <p className="vm-sub" style={{ margin: "6px 24px 0" }}>{tr("No one matches.")}</p>
          ) : (
            <div className="vm-group" style={{ marginTop: 8 }}>{shown.map(line)}</div>
          )}
        </>
      ) : null}
    </VmPage>
  );
}
