/**
 * The link a QR code carries for "join a business" (owner 2026-10-30: "a QR for joining"): the sign-up page with the one-time code already in it (`/signup?join=ABCD-EFGH`). Scanning it with the phone camera
 * opens sign-up on the join step with the code filled in — the person only types their details. Pure.
 */
import { formatJoinCode, isWellFormedJoinCode, normalizeJoinCode } from "@/lib/join-by-code";
export function buildJoinLink(origin: string, code: string): string {
  const o = origin.replace(/\/+$/, "");
  return `${o}/signup?join=${encodeURIComponent(code.trim())}`;
}

/** The code from a `join` query value, shown as ABCD-EFGH — only a WELL-FORMED code (8 symbols of the join alphabet) is taken; anything else is ignored. */
export function joinCodeFromQuery(value: string | null | undefined): string {
  const n = normalizeJoinCode(value ?? "");
  return isWellFormedJoinCode(n) ? formatJoinCode(n) : "";
}
