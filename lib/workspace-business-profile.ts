/**
 * Workspace Business Profile — validation and persistence helpers (Stage 1).
 * No playback, analytics, or taxonomy tables; field names align with future Music Taxonomy slugs.
 */

import type { BusinessType, Prisma, WorkspaceBusinessProfile, WorkspaceEnergyLevel } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const WORKSPACE_BUSINESS_PROFILE_LIMITS = {
  short: 500,
  medium: 4000,
  long: 8000,
  countryCode: 16,
  singleTag: 200,
  maxArrayItems: 64,
} as const;

export type WorkspaceBusinessProfileJson = {
  id: string;
  workspaceId: string;
  primaryBusinessType: BusinessType;
  cuisineOrConcept: string | null;
  conceptTags: string[];
  countryCode: string | null;
  cultureNotes: string | null;
  primaryLanguage: string | null;
  additionalLanguages: string[];
  audienceDescriptors: string[];
  desiredMoodNotes: string | null;
  energyLevel: WorkspaceEnergyLevel | null;
  openingHoursSummary: string | null;
  openingHoursStructured: Prisma.JsonValue | null;
  daypartPreferences: Prisma.JsonValue | null;
  preferredStyleHints: string[];
  blockedStyleHints: string[];
  adminNotes: string | null;
  createdAt: string;
  updatedAt: string;
};

function trimOrNull(s: unknown, max: number): string | null {
  if (s === undefined || s === null) return null;
  if (typeof s !== "string") return null;
  const t = s.trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max) : t;
}

function trimStringArray(raw: unknown, maxItems: number, maxEach: number): string[] | string {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return "`must be an array of strings`";
  if (raw.length > maxItems) return `at most ${maxItems} entries`;
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") return "each entry must be a string";
    const t = item.trim();
    if (!t) continue;
    out.push(t.length > maxEach ? t.slice(0, maxEach) : t);
  }
  return out;
}

function parseOptionalJson(raw: unknown): Prisma.JsonValue | null | string {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    try {
      JSON.stringify(raw);
      return raw as Prisma.JsonValue;
    } catch {
      return "invalid JSON object";
    }
  }
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t) return null;
    try {
      const v = JSON.parse(t) as unknown;
      if (typeof v !== "object" || v === null || Array.isArray(v)) return "must be a JSON object";
      return v as Prisma.JsonValue;
    } catch {
      return "invalid JSON";
    }
  }
  return "must be a JSON object or null";
}

const BUSINESS_TYPES = new Set<string>([
  "RESTAURANT",
  "GYM",
  "HOTEL",
  "BAR",
  "CAFE",
  "RETAIL",
  "OFFICE",
  "OTHER",
]);

const ENERGY_LEVELS = new Set<string>(["LOW", "MEDIUM", "HIGH"]);

export type PatchWorkspaceBusinessProfileInput = Partial<{
  primaryBusinessType: BusinessType;
  cuisineOrConcept: string | null;
  conceptTags: string[];
  countryCode: string | null;
  cultureNotes: string | null;
  primaryLanguage: string | null;
  additionalLanguages: string[];
  audienceDescriptors: string[];
  desiredMoodNotes: string | null;
  energyLevel: WorkspaceEnergyLevel | null;
  openingHoursSummary: string | null;
  openingHoursStructured: Prisma.JsonValue | null;
  daypartPreferences: Prisma.JsonValue | null;
  preferredStyleHints: string[];
  blockedStyleHints: string[];
  adminNotes: string | null;
}>;

export function validatePatchBody(
  raw: unknown,
  options: { allowAdminNotes: boolean },
): { ok: true; data: PatchWorkspaceBusinessProfileInput } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Body must be a JSON object" };
  const obj = raw as Record<string, unknown>;
  const data: PatchWorkspaceBusinessProfileInput = {};

  if ("primaryBusinessType" in obj) {
    const v = obj.primaryBusinessType;
    if (v === null || v === undefined) {
      data.primaryBusinessType = "OTHER";
    } else if (typeof v === "string" && BUSINESS_TYPES.has(v)) {
      data.primaryBusinessType = v as BusinessType;
    } else {
      return { ok: false, error: "`primaryBusinessType` must be a valid BusinessType" };
    }
  }

  const stringFields: { key: keyof PatchWorkspaceBusinessProfileInput; max: number }[] = [
    { key: "cuisineOrConcept", max: WORKSPACE_BUSINESS_PROFILE_LIMITS.short },
    { key: "cultureNotes", max: WORKSPACE_BUSINESS_PROFILE_LIMITS.medium },
    { key: "primaryLanguage", max: WORKSPACE_BUSINESS_PROFILE_LIMITS.short },
    { key: "desiredMoodNotes", max: WORKSPACE_BUSINESS_PROFILE_LIMITS.long },
    { key: "openingHoursSummary", max: WORKSPACE_BUSINESS_PROFILE_LIMITS.medium },
  ];
  for (const { key, max } of stringFields) {
    if (!(key in obj)) continue;
    data[key] = trimOrNull(obj[key], max) as never;
  }

  if ("countryCode" in obj) {
    const t = trimOrNull(obj.countryCode, WORKSPACE_BUSINESS_PROFILE_LIMITS.countryCode);
    data.countryCode = t?.toUpperCase() ?? null;
  }

  const arrayFields: (keyof Pick<
    PatchWorkspaceBusinessProfileInput,
    "conceptTags" | "additionalLanguages" | "audienceDescriptors" | "preferredStyleHints" | "blockedStyleHints"
  >)[] = [
    "conceptTags",
    "additionalLanguages",
    "audienceDescriptors",
    "preferredStyleHints",
    "blockedStyleHints",
  ];
  for (const key of arrayFields) {
    if (!(key in obj)) continue;
    const parsed = trimStringArray(
      obj[key],
      WORKSPACE_BUSINESS_PROFILE_LIMITS.maxArrayItems,
      WORKSPACE_BUSINESS_PROFILE_LIMITS.singleTag,
    );
    if (typeof parsed === "string") return { ok: false, error: `\`${key}\` ${parsed}` };
    data[key] = parsed;
  }

  if ("energyLevel" in obj) {
    const v = obj.energyLevel;
    if (v === null || v === undefined || v === "") {
      data.energyLevel = null;
    } else if (typeof v === "string" && ENERGY_LEVELS.has(v)) {
      data.energyLevel = v as WorkspaceEnergyLevel;
    } else {
      return { ok: false, error: "`energyLevel` must be LOW, MEDIUM, HIGH, or null" };
    }
  }

  for (const key of ["openingHoursStructured", "daypartPreferences"] as const) {
    if (!(key in obj)) continue;
    const parsed = parseOptionalJson(obj[key]);
    if (typeof parsed === "string") return { ok: false, error: `\`${key}\`: ${parsed}` };
    data[key] = parsed;
  }

  if (options.allowAdminNotes && "adminNotes" in obj) {
    data.adminNotes = trimOrNull(obj.adminNotes, WORKSPACE_BUSINESS_PROFILE_LIMITS.medium);
  }

  return { ok: true, data };
}

/** Tenant-facing payloads never expose platform `adminNotes`. */
export function sanitizeBusinessProfileForTenant(
  profile: WorkspaceBusinessProfileJson | null,
): Omit<WorkspaceBusinessProfileJson, "adminNotes"> | null {
  if (!profile) return null;
  const { adminNotes: _omit, ...rest } = profile;
  void _omit;
  return rest;
}

export function toJson(row: WorkspaceBusinessProfile): WorkspaceBusinessProfileJson {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    primaryBusinessType: row.primaryBusinessType,
    cuisineOrConcept: row.cuisineOrConcept,
    conceptTags: row.conceptTags,
    countryCode: row.countryCode,
    cultureNotes: row.cultureNotes,
    primaryLanguage: row.primaryLanguage,
    additionalLanguages: row.additionalLanguages,
    audienceDescriptors: row.audienceDescriptors,
    desiredMoodNotes: row.desiredMoodNotes,
    energyLevel: row.energyLevel,
    openingHoursSummary: row.openingHoursSummary,
    openingHoursStructured: row.openingHoursStructured ?? null,
    daypartPreferences: row.daypartPreferences ?? null,
    preferredStyleHints: row.preferredStyleHints,
    blockedStyleHints: row.blockedStyleHints,
    adminNotes: row.adminNotes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mergeWorkspaceBusinessProfile(
  workspaceId: string,
  existing: WorkspaceBusinessProfile | null,
  patch: PatchWorkspaceBusinessProfileInput,
  allowAdminNotes: boolean,
): Prisma.WorkspaceBusinessProfileUncheckedCreateInput {
  const val = <T>(field: keyof PatchWorkspaceBusinessProfileInput, fallback: T): T => {
    if (patch[field] !== undefined) return patch[field] as T;
    if (existing) return existing[field as keyof WorkspaceBusinessProfile] as T;
    return fallback;
  };

  return {
    workspaceId,
    primaryBusinessType: val("primaryBusinessType", "OTHER"),
    cuisineOrConcept: val("cuisineOrConcept", null),
    conceptTags: val("conceptTags", []),
    countryCode: val("countryCode", null),
    cultureNotes: val("cultureNotes", null),
    primaryLanguage: val("primaryLanguage", null),
    additionalLanguages: val("additionalLanguages", []),
    audienceDescriptors: val("audienceDescriptors", []),
    desiredMoodNotes: val("desiredMoodNotes", null),
    energyLevel: val("energyLevel", null),
    openingHoursSummary: val("openingHoursSummary", null),
    openingHoursStructured:
      patch.openingHoursStructured !== undefined
        ? patch.openingHoursStructured ?? undefined
        : existing?.openingHoursStructured ?? undefined,
    daypartPreferences:
      patch.daypartPreferences !== undefined
        ? patch.daypartPreferences ?? undefined
        : existing?.daypartPreferences ?? undefined,
    preferredStyleHints: val("preferredStyleHints", []),
    blockedStyleHints: val("blockedStyleHints", []),
    adminNotes: allowAdminNotes
      ? patch.adminNotes !== undefined
        ? patch.adminNotes
        : existing?.adminNotes ?? null
      : existing?.adminNotes ?? null,
  };
}

export async function getWorkspaceBusinessProfileJson(
  workspaceId: string,
): Promise<WorkspaceBusinessProfileJson | null> {
  const row = await prisma.workspaceBusinessProfile.findUnique({ where: { workspaceId } });
  return row ? toJson(row) : null;
}

export async function upsertWorkspaceBusinessProfile(
  workspaceId: string,
  patch: PatchWorkspaceBusinessProfileInput,
  options: { allowAdminNotes: boolean },
): Promise<WorkspaceBusinessProfileJson> {
  const existing = await prisma.workspaceBusinessProfile.findUnique({ where: { workspaceId } });

  const full = mergeWorkspaceBusinessProfile(workspaceId, existing, patch, options.allowAdminNotes);

  const row = await prisma.workspaceBusinessProfile.upsert({
    where: { workspaceId },
    create: full,
    update: {
      primaryBusinessType: full.primaryBusinessType,
      cuisineOrConcept: full.cuisineOrConcept,
      conceptTags: full.conceptTags,
      countryCode: full.countryCode,
      cultureNotes: full.cultureNotes,
      primaryLanguage: full.primaryLanguage,
      additionalLanguages: full.additionalLanguages,
      audienceDescriptors: full.audienceDescriptors,
      desiredMoodNotes: full.desiredMoodNotes,
      energyLevel: full.energyLevel,
      openingHoursSummary: full.openingHoursSummary,
      openingHoursStructured: full.openingHoursStructured ?? undefined,
      daypartPreferences: full.daypartPreferences ?? undefined,
      preferredStyleHints: full.preferredStyleHints,
      blockedStyleHints: full.blockedStyleHints,
      adminNotes: full.adminNotes,
    },
  });

  return toJson(row);
}
