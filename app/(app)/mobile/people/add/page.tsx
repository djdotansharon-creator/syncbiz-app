"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTr } from "@/lib/i18n/use-tr";
import { JOIN_CODE_RENEW_MS } from "@/lib/join-by-code";
import { buildJoinLink } from "@/lib/join-link";
import { JOIN_CHANGED_EVENT } from "@/lib/use-join-pending";
import { makeJoinCode, peopleErrorText, usePeopleAdmin } from "@/lib/mobile-people";
import { QrCode } from "@/components/roles/qr-code";
import { VmPage } from "@/components/vm/vm-ui";
import { IconPeople } from "@/components/vm/vm-icons";
import { VmBack } from "@/components/vm/vm-people-parts";

/**
 * ADD A PERSON — a one-time code, its QR and its link (the computer's "Add a person" window, same calls). The code works once and renews every minute while this screen is open; the person
 * scans the QR with their own phone camera (or is sent the link) and fills in their details, and the request appears under "Waiting for approval" for an administrator to decide.
 */
export default function MobileAddPersonPage() {
  const tr = useTr();
  const d = usePeopleAdmin();
  const joinOn = d.state === "ready" && d.joinOn;
  const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(null);
  const [now, setNow] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const alive = useRef(true);

  const make = useCallback(async (silent: boolean) => {
    if (!silent) setBusy(true);
    setError("");
    setCopied(false);
    const r = await makeJoinCode();
    if (!alive.current) return;
    if (r.ok) {
      setCode({ code: r.code, expiresAt: r.expiresAt });
      setNow(Date.now());
      window.dispatchEvent(new Event(JOIN_CHANGED_EVENT)); // the screens re-check at once while this code is on show
    } else {
      setError(peopleErrorText(r.error));
    }
    if (!silent) setBusy(false);
  }, []);

  // the code is made the moment the screen opens and renewed every minute while it stays open; each code still works once
  useEffect(() => {
    alive.current = true;
    if (!joinOn) return () => { alive.current = false; };
    const first = window.setTimeout(() => void make(true), 0);
    const renew = window.setInterval(() => void make(true), JOIN_CODE_RENEW_MS);
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      alive.current = false;
      window.clearTimeout(first);
      window.clearInterval(renew);
      window.clearInterval(clock);
    };
  }, [joinOn, make]);

  const back = <VmBack fallback="/mobile/people" label={tr("People")} />;
  const live = !!code && code.expiresAt > now;
  const link = code && typeof window !== "undefined" ? buildJoinLink(window.location.origin, code.code) : "";
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  async function share() {
    if (!link) return;
    try {
      if (canShare) {
        await navigator.share({ title: tr("Join my business on VONO"), url: link });
        return;
      }
    } catch {
      return; // the person closed the share sheet
    }
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      /* nothing to copy to */
    }
  }

  return (
    <VmPage title={tr("Add a person")} lead={back}>
      {d.state === "loading" ? <p className="vm-sub" style={{ margin: "24px", textAlign: "center" }}>…</p> : null}
      {d.state === "hidden" || d.state === "error" || (d.state === "ready" && !d.joinOn) ? (
        <div className="vm-empty">
          <IconPeople />
          <span>{tr(d.state === "hidden" ? "Only an administrator can manage people." : d.state === "error" ? "Something went wrong. Please try again." : "Adding people with a code is not switched on yet.")}</span>
        </div>
      ) : null}
      {joinOn ? (
        <div className="vm-code">
          <p className="vm-sub" style={{ textAlign: "center", margin: "0 0 14px" }}>{tr("Scan the code with a phone camera, or type it at sign-up.")}</p>
          {live ? (
            <>
              <div className="vm-code-qr"><QrCode value={link} size={220} label={tr("QR code to join")} /></div>
              <p className="vm-code-text" dir="ltr">{code!.code}</p>
              <p className="vm-sub" style={{ textAlign: "center", margin: "0 0 18px" }}>{tr("Works once · renews every minute")}</p>
              <button type="button" className="vm-ask-btn" data-main="" onClick={() => void share()}>{copied ? tr("Copied") : canShare ? tr("Share link") : tr("Copy link")}</button>
              <button type="button" className="vm-ask-btn" disabled={busy} onClick={() => void make(false)}>{tr("New code")}</button>
            </>
          ) : (
            <button type="button" className="vm-ask-btn" data-main="" disabled={busy} onClick={() => void make(false)}>{code ? tr("New code") : tr("Create join code")}</button>
          )}
          <p className="vm-sub" style={{ textAlign: "center", margin: "16px 0 0" }}>{tr("The person fills in their details and you approve them here.")}</p>
          {error ? <p className="vm-err" role="alert">{tr(error)}</p> : null}
        </div>
      ) : null}
    </VmPage>
  );
}
