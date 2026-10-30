/**
 * Roles the business OWNER defines, each with switches (docs/ROLES_DESIGN.md) — the PURE rules (no database), so they can be tested alone. Dormant unless the env flag SYNCBIZ_ROLES=1.
 * Only switches that are ENFORCED today are offered (a switch that did nothing would be a lie): "open the Control Room" (the platform role the person gets: MANAGER or MEMBER — the pages that
 * already check it) and "sign in from a computer" (enforced at the door). More switches come with their enforcement.
 */
import { createHash, randomBytes, timingSafeEqual } from "crypto";

export const MAX_ROLES_PER_WORKSPACE = 20;
export const MAX_ROLE_NAME = 40;
export const ACCESS_CODE_MIN = 3;
export const ACCESS_CODE_MAX = 12;

export function isRolesEnvEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const v = (env.SYNCBIZ_ROLES ?? "").trim().toLowerCase();
  return v === "1" || v === "true";
}

export type RoleSwitches = { openControlRoom: boolean; allowComputer: boolean };
export type RoleInput = RoleSwitches & { name: string };

/** The ready-made roles every business starts with (the owner may rename, change or delete them). */
export const DEFAULT_ROLES: ReadonlyArray<RoleInput & { sortOrder: number }> = [
  { name: "Manager", openControlRoom: true, allowComputer: false, sortOrder: 0 },
  { name: "Shift manager", openControlRoom: false, allowComputer: false, sortOrder: 1 },
  { name: "Employee", openControlRoom: false, allowComputer: false, sortOrder: 2 },
];

export type RoleInputError = "name" | "name_long";

export function validateRoleInput(i: { name: unknown; openControlRoom: unknown; allowComputer: unknown }): { ok: true; value: RoleInput } | { ok: false; error: RoleInputError } {
  const name = typeof i.name === "string" ? i.name.trim().replace(/\s+/g, " ") : "";
  if (name.length < 1) return { ok: false, error: "name" };
  if (name.length > MAX_ROLE_NAME) return { ok: false, error: "name_long" };
  return { ok: true, value: { name, openControlRoom: i.openControlRoom === true, allowComputer: i.allowComputer !== false } };
}

/** The platform role a person gets: the Control Room switch decides it (MANAGER pages already exist; everything else is a member). */
export function tenantRoleForRole(r: Pick<RoleSwitches, "openControlRoom">): "TENANT_ADMIN" | "TENANT_MEMBER" {
  return r.openControlRoom ? "TENANT_ADMIN" : "TENANT_MEMBER";
}

/** Does this role turn a COMPUTER away? Only a person WITH a role whose switch is off is blocked; a phone and the desktop app (the station) are never blocked. Fails OPEN when unknown. */
export function blocksComputer(role: Pick<RoleSwitches, "allowComputer"> | null | undefined, device: { phone: boolean; desktopApp: boolean }): boolean {
  if (!role) return false;
  if (device.phone || device.desktopApp) return false;
  return role.allowComputer === false;
}

export function validateAccessCode(code: unknown): { ok: true; value: string } | { ok: false } {
  const c = typeof code === "string" ? code.trim() : "";
  if (c.length < ACCESS_CODE_MIN || c.length > ACCESS_CODE_MAX || !/^[A-Za-z0-9]+$/.test(c)) return { ok: false };
  return { ok: true, value: c };
}

export function hashAccessCode(code: string, salt: string = randomBytes(12).toString("hex")): { salt: string; hash: string } {
  return { salt, hash: createHash("sha256").update(`vono-access:${salt}:${code}`).digest("hex") };
}

export function accessCodeMatches(code: string, salt: string, hash: string): boolean {
  const a = Buffer.from(hashAccessCode(code.trim(), salt).hash, "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
