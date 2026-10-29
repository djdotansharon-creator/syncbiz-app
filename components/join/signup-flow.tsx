"use client";

/**
 * Sign-up in steps (docs/ACCOUNTS_JOIN_DESIGN.md) — shown only when the join feature is on (app/signup/page.tsx decides on the server; flag off = the old single form):
 *   1. who you are (name, e-mail, password, phone)  →  2. "New business" or "Join a business"  →  3. the business name, or the one-time code.
 * A new business uses the same sign-up call as before. Joining sends a request the business's admin approves; nothing is created until then.
 * Texts are written in English and wrapped in tr() (Hebrew comes from lib/i18n/phrases.ts).
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useTr } from "@/lib/i18n/use-tr";
import { joinCodeFromQuery } from "@/lib/join-link";
import "./join.css";

type Step = "details" | "choice" | "business" | "code" | "sent";

const JOIN_ERRORS: Record<string, string> = {
  bad_code: "That code is not valid. Ask for a new one.",
  wrong_password: "That e-mail already has an account — the password does not match it.",
  already_member: "You are already part of this business.",
  already_pending: "You already asked to join — wait for the approval.",
  rate_limited: "Too many tries. Please wait a few minutes.",
  limit: "This business has no room for more people right now.",
  code: "Enter the 8-letter code.",
  email: "Enter a valid e-mail.",
  password: "The password must be at least 6 characters.",
  first_name: "Enter your first name.",
  last_name: "Enter your last name.",
  phone: "That phone number does not look right.",
};

function BuildingPlusIcon() {
  return (
    <svg viewBox="0 0 56 56" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M10 48V14a3 3 0 0 1 3-3h20a3 3 0 0 1 3 3v34" />
      <path d="M6 48h40" />
      <path d="M18 20h4M18 28h4M18 36h4M26 20h4M26 28h4M26 36h4" />
      <path d="M44 14v12M38 20h12" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg viewBox="0 0 56 56" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="19" cy="28" r="9" />
      <path d="M28 28h20M42 28v7M48 28v5" />
      <circle cx="19" cy="28" r="2.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="32" cy="32" r="26" />
      <path d="M20 33l8 8 16-17" />
    </svg>
  );
}

function EyeButton({ shown, onToggle, label }: { shown: boolean; onToggle: () => void; label: string }) {
  return (
    <button type="button" className="sb-join-eye" onClick={onToggle} aria-label={label} tabIndex={-1}>
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {shown ? (
          <>
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </>
        ) : (
          <>
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </>
        )}
      </svg>
    </button>
  );
}

export function SignupFlow() {
  const tr = useTr();
  const router = useRouter();
  const [step, setStep] = useState<Step>("details");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [d, setD] = useState({ firstName: "", lastName: "", email: "", password: "", phone: "" });
  const [company, setCompany] = useState("");
  const [code, setCode] = useState("");
  const [fromLink, setFromLink] = useState(false); // opened from a QR code / a join link: the code is already in it
  useEffect(() => {
    const c = joinCodeFromQuery(new URLSearchParams(window.location.search).get("join"));
    if (c) {
      setCode(c);
      setFromLink(true);
    }
  }, []);
  const set = (k: keyof typeof d) => (e: React.ChangeEvent<HTMLInputElement>) => setD((s) => ({ ...s, [k]: e.target.value }));

  function detailsNext(e: React.FormEvent) {
    e.preventDefault();
    if (!d.firstName.trim()) return setError(tr(JOIN_ERRORS.first_name));
    if (!d.lastName.trim()) return setError(tr(JOIN_ERRORS.last_name));
    if (!d.email.includes("@")) return setError(tr(JOIN_ERRORS.email));
    if (d.password.length < 6) return setError(tr(JOIN_ERRORS.password));
    setError("");
    setStep(fromLink ? "code" : "choice"); // a person who scanned a join QR skips the choice: they are joining
  }

  async function createBusiness(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName: d.firstName.trim(), lastName: d.lastName.trim(), company: company.trim(), email: d.email.trim(), password: d.password }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? tr("Sign-up failed"));
        return;
      }
      router.push("/login");
      router.refresh();
    } catch {
      setError(tr("Sign-up failed"));
    } finally {
      setBusy(false);
    }
  }

  async function sendJoin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/join/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, email: d.email.trim(), password: d.password, firstName: d.firstName.trim(), lastName: d.lastName.trim(), phone: d.phone.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        const msg = data.error && JOIN_ERRORS[data.error] ? JOIN_ERRORS[data.error] : "Something went wrong. Please try again.";
        setError(tr(msg));
        return;
      }
      setStep("sent");
    } catch {
      setError(tr("Something went wrong. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  const back = (to: Step) => (
    <button type="button" className="sb-join-link" onClick={() => { setError(""); setStep(to); }}>
      {tr("Back")}
    </button>
  );

  return (
    <div className="vono-ambient flex min-h-screen items-center justify-center px-4 py-8">
      <div className="sb-join-card">
        {step === "details" ? (
          <form onSubmit={detailsNext} noValidate>
            <h1 className="sb-join-title">{tr("Create your account")}</h1>
            <p className="sb-join-sub">{tr("Your own sign-in — only you use it.")}</p>
            <div className="sb-join-row2">
              <label className="sb-join-field"><span>{tr("First name")}</span><input className="sb-join-input" value={d.firstName} onChange={set("firstName")} autoComplete="given-name" autoFocus /></label>
              <label className="sb-join-field"><span>{tr("Last name")}</span><input className="sb-join-input" value={d.lastName} onChange={set("lastName")} autoComplete="family-name" /></label>
            </div>
            <label className="sb-join-field"><span>{tr("E-mail")}</span><input className="sb-join-input" type="email" value={d.email} onChange={set("email")} autoComplete="email" placeholder="you@company.com" dir="ltr" /></label>
            <label className="sb-join-field">
              <span>{tr("Password")}</span>
              <div style={{ position: "relative" }}>
                <input className="sb-join-input" type={showPw ? "text" : "password"} value={d.password} onChange={set("password")} autoComplete="new-password" dir="ltr" />
                <EyeButton shown={showPw} onToggle={() => setShowPw((v) => !v)} label={showPw ? tr("Hide password") : tr("Show password")} />
              </div>
            </label>
            <label className="sb-join-field"><span>{tr("Phone (optional)")}</span><input className="sb-join-input" type="tel" value={d.phone} onChange={set("phone")} autoComplete="tel" dir="ltr" /></label>
            <button type="submit" className="sb-join-primary">{tr("Continue")}</button>
            {error ? <p className="sb-join-error" role="alert">{error}</p> : null}
            <p style={{ textAlign: "center", marginTop: 14 }} className="sb-join-sub">
              {tr("Already have an account?")}{" "}
              <Link href="/login" style={{ color: "#fff", textDecoration: "underline", textUnderlineOffset: 3 }}>{tr("Log in")}</Link>
            </p>
          </form>
        ) : null}

        {step === "choice" ? (
          <div>
            <h1 className="sb-join-title">{tr("What are you here to do?")}</h1>
            <p className="sb-join-sub">&nbsp;</p>
            <div className="sb-join-choices">
              <button type="button" className="sb-join-choice" onClick={() => { setError(""); setStep("business"); }}>
                <BuildingPlusIcon />
                <b>{tr("Set up a new business")}</b>
              </button>
              <button type="button" className="sb-join-choice" onClick={() => { setError(""); setStep("code"); }}>
                <KeyIcon />
                <b>{tr("Join an existing business")}</b>
              </button>
            </div>
            {back("details")}
          </div>
        ) : null}

        {step === "business" ? (
          <form onSubmit={createBusiness}>
            <h1 className="sb-join-title">{tr("Your business")}</h1>
            <p className="sb-join-sub">{tr("You will be its manager.")}</p>
            <label className="sb-join-field"><span>{tr("Business name")}</span><input className="sb-join-input" value={company} onChange={(e) => setCompany(e.target.value)} autoFocus /></label>
            <button type="submit" className="sb-join-primary" disabled={busy}>{busy ? tr("Creating…") : tr("Create business")}</button>
            {error ? <p className="sb-join-error" role="alert">{error}</p> : null}
            {back("choice")}
          </form>
        ) : null}

        {step === "code" ? (
          <form onSubmit={sendJoin}>
            <h1 className="sb-join-title">{tr("Enter the code")}</h1>
            <p className="sb-join-sub">{tr("The business manager gives you a one-time code.")}</p>
            <input className="sb-join-input sb-join-input--code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXX-XXXX" maxLength={9} autoFocus autoComplete="off" spellCheck={false} dir="ltr" aria-label={tr("Join code")} />
            <button type="submit" className="sb-join-primary" disabled={busy || code.replace(/[^A-Za-z0-9]/g, "").length < 8}>{busy ? tr("Sending…") : tr("Send request")}</button>
            {error ? <p className="sb-join-error" role="alert">{error}</p> : null}
            {back("choice")}
          </form>
        ) : null}

        {step === "sent" ? (
          <div className="sb-join-done">
            <CheckIcon />
            <h1 className="sb-join-title">{tr("Request sent")}</h1>
            <p className="sb-join-sub">{tr("When the manager approves, sign in with your e-mail and password.")}</p>
            <Link href="/login" className="sb-join-primary" style={{ display: "block", textDecoration: "none", textAlign: "center" }}>{tr("Go to sign in")}</Link>
          </div>
        ) : null}
      </div>
    </div>
  );
}
