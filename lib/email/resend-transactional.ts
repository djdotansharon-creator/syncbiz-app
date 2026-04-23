/**
 * Transactional email via Resend (https://resend.com) — `fetch` only, no extra npm dep.
 * Railway: set `RESEND_API_KEY` and (recommended) `RESEND_FROM`.
 *
 * For testing, Resend allows `onboarding@resend.dev` as From but only delivers to
 * the account’s verified inbox unless you add a verified sending domain.
 */

const RESEND_API = "https://api.resend.com/emails";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeHtmlAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

export function isResendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

export type SendResult = { ok: true } | { ok: false; error: string };

/**
 * Sends a single password-reset message. Returns ok:false if the API key is missing or Resend returns an error.
 */
export async function sendPasswordResetEmail(params: { to: string; resetUrl: string }): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY?.trim();
  const from =
    process.env.RESEND_FROM?.trim() || "SyncBiz <onboarding@resend.dev>";
  if (!key) {
    return { ok: false, error: "RESEND_API_KEY is not set" };
  }
  const u = params.resetUrl.trim();
  const href = escapeHtmlAttr(u);
  const displayUrl = escapeHtml(u);
  const to = params.to.trim().toLowerCase();
  const html = `
  <p>You requested a password reset for your SyncBiz account.</p>
  <p><a href="${href}">Set a new password</a></p>
  <p style="font-size:12px;color:#666">If the link does not work, copy this address: ${displayUrl}</p>
  <p style="font-size:12px;color:#666">If you did not request this, you can ignore this email.</p>
  `.trim();

  const res = await fetch(RESEND_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: "Reset your SyncBiz password",
      html,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    return { ok: false, error: text || res.statusText || `HTTP ${res.status}` };
  }
  return { ok: true };
}
