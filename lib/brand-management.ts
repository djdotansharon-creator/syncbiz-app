/**
 * Control Room — brands (owner-approved 2026-10-11). Organization → Brand → Branch on the EXISTING `Brand` table (no DB
 * change): add / edit a brand (name, code, color), assign a branch to a brand. The workspace default Brand stays the
 * fallback — a branch with no brand (NULL brandId) belongs to it, so no branch ever disappears. No delete / archive in
 * this step. Every function is scoped to ONE workspace id; a brand of another organization can never be read or
 * assigned. Color = strict #RRGGBB (rendered into styles). Never touches stations, the WS server or playback.
 */
import { prisma } from "./prisma";
import { removeBrandLogo } from "./brand-logo";
import { ensureDefaultBrandId } from "./control-room-foundation";
import { BranchInputError } from "./branch-management";

export type BrandInput = { name: unknown; code: unknown; color: unknown };
export type BrandView = { id: string; name: string; code: string; color: string | null; logoUrl: string | null; isDefault: boolean; branchCount: number };

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{0,23}$/;

export function normalizeBrandColor(v: unknown): string | null {
  return typeof v === "string" && COLOR_RE.test(v.trim()) ? v.trim().toLowerCase() : null;
}
export function normalizeBrandCode(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const c = v.trim().toUpperCase();
  return CODE_RE.test(c) ? c : null;
}

function clean(input: BrandInput) {
  const name = typeof input.name === "string" ? input.name.trim().slice(0, 60) : "";
  if (!name) throw new BranchInputError("Brand name is required.");
  const code = normalizeBrandCode(input.code);
  if (!code) throw new BranchInputError("Brand code: 1–24 letters, digits, - or _ (e.g. BE).");
  const color = normalizeBrandColor(input.color);
  if (!color) throw new BranchInputError("Pick a brand color.");
  return { name, code, color };
}

async function assertCodeFree(workspaceId: string, code: string, exceptId?: string) {
  const clash = await prisma.brand.findFirst({ where: { workspaceId, code, ...(exceptId ? { NOT: { id: exceptId } } : {}) }, select: { id: true } });
  if (clash) throw new BranchInputError(`Brand code ${code} is already used in this organization.`, 409);
}

/** Brands of the organization (default first) + which brand every branch belongs to (NULL → default). */
export async function listBrands(workspaceId: string): Promise<{ brands: BrandView[]; defaultBrandId: string; branchBrand: Record<string, string> }> {
  const defaultBrandId = await prisma.$transaction((tx) => ensureDefaultBrandId(tx, workspaceId));
  const [brands, branches] = await Promise.all([
    prisma.brand.findMany({ where: { workspaceId, archivedAt: null }, orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }], select: { id: true, name: true, code: true, color: true, logoUrl: true, isDefault: true } }),
    prisma.branch.findMany({ where: { workspaceId }, select: { id: true, brandId: true } }),
  ]);
  const branchBrand: Record<string, string> = {};
  const counts = new Map<string, number>();
  for (const b of branches) {
    const id = b.brandId && brands.some((x) => x.id === b.brandId) ? b.brandId : defaultBrandId; // fallback: never lost
    branchBrand[b.id] = id;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return { brands: brands.map((b) => ({ ...b, branchCount: counts.get(b.id) ?? 0 })), defaultBrandId, branchBrand };
}

export async function createBrand(workspaceId: string, input: BrandInput) {
  const c = clean(input);
  await assertCodeFree(workspaceId, c.code);
  return prisma.brand.create({ data: { workspaceId, name: c.name, code: c.code, color: c.color, isDefault: false, status: "active" }, select: { id: true } });
}

export async function updateBrand(workspaceId: string, brandId: string, input: BrandInput) {
  const cur = await prisma.brand.findFirst({ where: { id: brandId, workspaceId, archivedAt: null }, select: { id: true } });
  if (!cur) throw new BranchInputError("Brand not found.", 404);
  const c = clean(input);
  await assertCodeFree(workspaceId, c.code, brandId);
  await prisma.brand.update({ where: { id: brandId }, data: { name: c.name, code: c.code, color: c.color } });
}


/**
 * Delete a brand of THIS workspace (owner 2026-10-22). Brands are ARCHIVED, not erased (the model's own convention — every brand query filters `archivedAt: null`): the row stays, its code is
 * freed (suffixed) so the same code can be used again. Refused while the brand is the default one, while branches still belong to it, or while a member's access scope points at it.
 */
export async function deleteBrand(workspaceId: string, brandId: string): Promise<void> {
  const cur = await prisma.brand.findFirst({ where: { id: brandId, workspaceId, archivedAt: null }, select: { id: true, code: true, isDefault: true } });
  if (!cur) throw new BranchInputError("Brand not found.", 404, "not_found");
  if (cur.isDefault) throw new BranchInputError("The default brand cannot be deleted.", 409, "default");
  const [branches, scopes] = await Promise.all([
    prisma.branch.count({ where: { workspaceId, brandId: cur.id } }),
    prisma.memberScopeTarget.count({ where: { brandId: cur.id } }),
  ]);
  if (branches > 0) throw new BranchInputError(`${branches} branches still belong to this brand.`, 409, "branches", branches);
  if (scopes > 0) throw new BranchInputError("This brand is used in a member's access scope.", 409, "scope");
  await prisma.brand.update({ where: { id: cur.id }, data: { archivedAt: new Date(), status: "archived", code: `${cur.code}~${cur.id.slice(0, 8)}` } });
  try { removeBrandLogo(cur.id); } catch { /* no logo file */ }
}
