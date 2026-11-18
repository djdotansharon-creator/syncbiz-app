"use client";

import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useTr } from "@/lib/i18n/use-tr";
import { ALL_FLAG_KEYS, PERMISSION_LABELS } from "@/lib/role-permissions";
import {
  accountAction,
  accountActionsFor,
  branchChoiceState,
  branchReach,
  giveRole,
  isAdminLevel,
  peopleErrorText,
  saveBranches,
  usePeopleAdmin,
  type ActionResult,
  type BranchRow,
  type RoleRow,
} from "@/lib/mobile-people";
import { VmPage, useVmUi } from "@/components/vm/vm-ui";
import { VmCover, nameHue } from "@/components/vm/vm-parts";
import { toneVars } from "@/components/vm/vm-tone";
import { Rise, VmFlow, VmFold, VmKv } from "@/components/vm/vm-flow";
import { IconCheck, IconChevronForward, IconPeople } from "@/components/vm/vm-icons";
import { VmBack, agoLabel, levelLabel, stateLabel, useAsk } from "@/components/vm/vm-people-parts";

/** the branches a member may reach: a sheet of check rows and one Save (the computer's rule: at least one branch) */
function BranchPick({ branches, initial, onSave, saveLabel, allLabel, hintLabel }: { branches: BranchRow[]; initial: string[]; onSave: (ids: string[]) => void; saveLabel: string; allLabel: string; hintLabel: string }) {
  const [picked, setPicked] = useState<string[]>(initial);
  const all = branches.length > 0 && branches.every((b) => picked.includes(b.id));
  const valid = picked.length > 0;
  const dirty = picked.length !== initial.length || picked.some((id) => !initial.includes(id));
  return (
    <div className="vm-act">
      <div className="vm-act-list">
        <button type="button" className="vm-act-row" role="checkbox" aria-checked={all} onClick={() => setPicked(all ? [] : branches.map((b) => b.id))}>
          <span className="vm-tick" data-on={all ? "" : undefined}>{all ? <IconCheck /> : null}</span>
          <span>{allLabel}</span>
        </button>
        {branches.map((b) => {
          const on = picked.includes(b.id);
          return (
            <button key={b.id} type="button" className="vm-act-row" role="checkbox" aria-checked={on} onClick={() => setPicked(on ? picked.filter((x) => x !== b.id) : [...picked, b.id])}>
              <span className="vm-tick" data-on={on ? "" : undefined}>{on ? <IconCheck /> : null}</span>
              <span className="vm-bdi">{b.name}</span>
            </button>
          );
        })}
      </div>
      {!valid ? <p className="vm-sub" style={{ margin: "6px 6px 0" }}>{hintLabel}</p> : null}
      <button type="button" className="vm-ask-btn" data-main="" disabled={!valid || !dirty} onClick={() => onSave(picked)}>{saveLabel}</button>
    </div>
  );
}

/** the person's own page: who they are, their role, the branches they reach, and the account (pause / remove) — only what the server will accept for this person is offered */
export default function MobilePersonPage() {
  const params = useParams<{ userId: string }>();
  const userId = decodeURIComponent(String(params?.userId ?? ""));
  const tr = useTr();
  const ui = useVmUi();
  const router = useRouter();
  const ask = useAsk();
  const d = usePeopleAdmin();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const ready = d.state === "ready" ? d : null;
  const person = ready?.people.find((p) => p.userId === userId) ?? null;
  const account = ready && person ? ready.accounts.find((a) => a.email.toLowerCase() === person.email.toLowerCase()) ?? null : null;
  const role: RoleRow | null = ready && person ? ready.roles.find((r) => r.id === person.roleId) ?? null : null;
  const allowed = useMemo(() => (role ? ALL_FLAG_KEYS.filter((k) => role.permissions?.flags?.[k]) : []), [role]);

  /** one write: busy while it runs, the sentence of the error when it fails, a short "Saved" and a fresh read when it works */
  async function run(write: () => Promise<ActionResult>, after?: () => void) {
    if (!ready) return;
    setBusy(true);
    setError("");
    const r = await write();
    if (!r.ok) {
      setError(tr(peopleErrorText(r.error)));
    } else {
      ui.toast(tr("Saved"));
      if (after) after();
      else await ready.reload();
    }
    setBusy(false);
  }

  const back = <VmBack fallback="/mobile/people" label={tr("People")} />;

  if (d.state === "loading") return <VmPage title="…" lead={back}><span /></VmPage>;
  if (d.state === "hidden" || d.state === "error" || !ready) {
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
  if (!person) {
    return (
      <VmPage title={tr("People")} lead={back}>
        <div className="vm-empty">
          <IconPeople />
          <span>{tr("This person was not found.")}</span>
        </div>
      </VmPage>
    );
  }

  const admin = isAdminLevel(person, account);
  const { canPause, canRemove } = accountActionsFor(person, account);
  const reach = branchReach(account, ready.branches);
  const reachText = admin ? tr("Full access to every branch.") : reach.all ? tr("All branches") : reach.names.length === 0 ? tr("No branch yet") : reach.names.join(" · ");
  const canGiveRole = ready.rolesOn && !admin && !person.isYou;
  const canPickBranches = !admin && !!account && account.accessType === "BRANCH_USER";

  const openRoles = () =>
    ui.openSheet(
      tr("Role"),
      <div className="vm-act">
        <div className="vm-act-list">
          {ready.roles.map((r) => (
            <button
              key={r.id}
              type="button"
              className="vm-act-row"
              role="radio"
              aria-checked={person.roleId === r.id}
              onClick={() => {
                ui.closeSheet();
                if (person.roleId !== r.id) void run(() => giveRole(person.userId, r.id));
              }}
            >
              <span className="vm-tick vm-tick--round" data-on={person.roleId === r.id ? "" : undefined}>{person.roleId === r.id ? <IconCheck /> : null}</span>
              <span className="vm-bdi">{r.name}</span>
            </button>
          ))}
        </div>
        <p className="vm-sub" style={{ margin: "8px 6px 0" }}>{tr("What a role allows is set on the computer.")}</p>
      </div>,
    );

  const openBranches = () =>
    ui.openSheet(
      tr("Branches"),
      <BranchPick
        branches={ready.branches}
        initial={account?.accessType === "BRANCH_USER" ? account.branchIds : []}
        saveLabel={tr("Save branches")}
        allLabel={tr("All branches")}
        hintLabel={tr("Choose at least one branch.")}
        onSave={(ids) => {
          ui.closeSheet();
          const st = branchChoiceState(account, ids);
          if (st.dirty && st.valid) void run(() => saveBranches(person.email, ids));
        }}
      />,
    );

  const askRemove = () =>
    ask({
      title: tr("Remove {name}?", { name: person.name || person.email }),
      text: tr("They will no longer be able to sign in to this business. This cannot be undone."),
      confirmLabel: tr("Remove from the business"),
      onConfirm: () => void run(() => accountAction(person.email, "remove-member"), () => router.replace("/mobile/people")),
    });

  const name = person.name || person.email;
  const personTone = toneVars({ h: nameHue(name), s: 0.5 }, true);
  const levelText = levelLabel(person.level, tr);
  const roleText = person.roleName ?? levelText;
  const roleValue = !ready.rolesOn ? levelText : admin ? levelText : role ? role.name : tr("No role yet");
  return (
    <VmPage flow title="" barTitle={name} lead={back} tone={personTone}>
      <VmFlow tone={personTone}>
        <Rise enter={0}>
          <div className="vm-hero2">
            <VmCover name={name} size={96} radius={999} neutral />
            <div className="vm-hero2-name vm-bdi">{name}{person.isYou ? ` · ${tr("You")}` : ""}</div>
            <div className="vm-hero2-sub">{roleText} · {stateLabel(person.status, tr)}</div>
          </div>
        </Rise>

        <div className="vm-fl-list" style={{ marginTop: 18 }}>
          <Rise enter={1}>
            {canGiveRole ? (
              <button type="button" className="vm-fl-row" disabled={busy} onClick={openRoles} aria-haspopup="dialog">
                <span className="vm-fl-text">{tr("Role")}</span>
                <span className="vm-fl-val vm-bdi">{roleValue}</span>
                <IconChevronForward className="vm-chev vm-flip" />
              </button>
            ) : (
              <div className="vm-fl-row vm-fl-static">
                <span className="vm-fl-text">{tr("Role")}</span>
                <span className="vm-fl-val vm-bdi">{roleValue}</span>
              </div>
            )}
          </Rise>
          <Rise enter={2}>
            {canPickBranches ? (
              <button type="button" className="vm-fl-row" disabled={busy} onClick={openBranches} aria-haspopup="dialog">
                <span className="vm-fl-text">{tr("Branches")}</span>
                <span className="vm-fl-val vm-bdi">{reachText}</span>
                <IconChevronForward className="vm-chev vm-flip" />
              </button>
            ) : (
              <div className="vm-fl-row vm-fl-static">
                <span className="vm-fl-text">{tr("Branches")}</span>
                <span className="vm-fl-val vm-bdi">{reachText}</span>
              </div>
            )}
          </Rise>
          <Rise enter={3}>
            <VmFold label={tr("Details")}>
              <VmKv label={tr("E-mail")} value={person.email} dir="ltr" />
              <VmKv label={tr("Level")} value={levelText} />
              <VmKv label={tr("State")} value={stateLabel(person.status, tr)} />
              <VmKv label={tr("Last sign-in")} value={agoLabel(person.lastSignInAt, tr)} />
              <VmKv label={tr("Joined")} value={new Date(person.joinedAt).toLocaleDateString()} />
              {role ? (
                <VmKv label={tr("This role allows:")} value={allowed.length === 0 ? tr("Nothing yet") : allowed.map((k) => tr(PERMISSION_LABELS[k].title)).join(" · ")} />
              ) : null}
            </VmFold>
          </Rise>
          {canPause ? (
            <Rise enter={4}>
              <button type="button" className="vm-fl-row" disabled={busy} onClick={() => void run(() => accountAction(person.email, person.status === "paused" ? "resume-member" : "pause-member"))}>
                <span className="vm-fl-text">{person.status === "paused" ? tr("Let them sign in again") : tr("Pause sign-in")}</span>
              </button>
            </Rise>
          ) : null}
          {canRemove ? (
            <Rise enter={5}>
              <button type="button" className="vm-fl-row" data-danger="" disabled={busy} onClick={askRemove}>
                <span className="vm-fl-text">{tr("Remove from the business")}</span>
              </button>
            </Rise>
          ) : null}
        </div>
        {error ? <p className="vm-err" role="alert">{error}</p> : null}
      </VmFlow>
    </VmPage>
  );
}
