"use client";

/**
 * JINGLES — audience UI pieces shared by the Control Room surfaces (branch panel, HQ jingles panel, Studio save card,
 * Broadcast). Eligibility is NEVER re-implemented here: it calls lib/jingles/audience.ts (the same rules the server
 * enforces). Users never see the technical names (BRAND_REGION…): badges read NETWORK / UNIVERSE / SOUTH /
 * UNIVERSE · SOUTH / LOCAL · BRANCH 094.
 */
import { isEligibleForBranch, type Audience, type BranchFacts, type JingleAudience } from "@/lib/jingles/audience";
import { REGIONS, type RegionId } from "@/lib/control-room-regions";
import type { Mgmt, MgmtKey } from "@/lib/i18n/management";

export type JingleItem = JingleAudience & {
  id: string;
  title: string;
  url: string;
  durationSec: number | null;
  originBranchId: string | null;
  playable: boolean;
};

export type AudienceDeps = {
  brands: { id: string; name: string; color: string | null }[];
  /** every branch of the workspace with its EFFECTIVE brand + region (the Control Room rows) */
  branches: (BranchFacts & { name: string; branchNumber: string | null })[];
};

export type AudienceDraft = {
  audience: Audience | null;
  audienceBrandId: string | null;
  audienceRegion: RegionId | null;
  audienceBranchId: string | null;
};

export const EMPTY_DRAFT: AudienceDraft = { audience: null, audienceBrandId: null, audienceRegion: null, audienceBranchId: null };

/** the draft as a complete audience, or null while something required is still missing */
export function draftAudience(d: AudienceDraft): JingleAudience | null {
  switch (d.audience) {
    case "NETWORK":
      return { audience: "NETWORK", audienceBrandId: null, audienceRegion: null, audienceBranchId: null };
    case "BRAND":
      return d.audienceBrandId ? { audience: "BRAND", audienceBrandId: d.audienceBrandId, audienceRegion: null, audienceBranchId: null } : null;
    case "REGION":
      return d.audienceRegion ? { audience: "REGION", audienceBrandId: null, audienceRegion: d.audienceRegion, audienceBranchId: null } : null;
    case "BRAND_REGION":
      return d.audienceBrandId && d.audienceRegion ? { audience: "BRAND_REGION", audienceBrandId: d.audienceBrandId, audienceRegion: d.audienceRegion, audienceBranchId: null } : null;
    case "LOCAL":
      return d.audienceBranchId ? { audience: "LOCAL", audienceBrandId: null, audienceRegion: null, audienceBranchId: d.audienceBranchId } : null;
    default:
      return null;
  }
}

export function reachCount(a: JingleAudience | null, deps: AudienceDeps): number {
  return a ? deps.branches.filter((b) => isEligibleForBranch(a, b)).length : 0;
}

export function audienceLabel(a: JingleAudience, deps: AudienceDeps, L: Mgmt): string {
  const brand = (id: string | null) => (deps.brands.find((b) => b.id === id)?.name ?? "—").toUpperCase();
  const region = (id: RegionId | null) => (id ? L.region(id).toUpperCase() : "—");
  switch (a.audience) {
    case "NETWORK":
      return L.t("jg.badgeNetwork");
    case "BRAND":
      return brand(a.audienceBrandId);
    case "REGION":
      return region(a.audienceRegion);
    case "BRAND_REGION":
      return `${brand(a.audienceBrandId)} · ${region(a.audienceRegion)}`;
    case "LOCAL": {
      const b = deps.branches.find((x) => x.id === a.audienceBranchId);
      const tag = b ? (b.branchNumber ? L.t("common.branchNumber", { n: b.branchNumber }) : b.name) : "";
      return tag ? `${L.t("jg.badgeLocal")} · ${tag.toUpperCase()}` : L.t("jg.badgeLocal");
    }
    default:
      return L.t("jg.badgeUnassigned");
  }
}

export function AudienceBadge({ a, deps, L }: { a: JingleAudience; deps: AudienceDeps; L: Mgmt }) {
  const color = (a.audience === "BRAND" || a.audience === "BRAND_REGION") ? deps.brands.find((b) => b.id === a.audienceBrandId)?.color ?? null : null;
  return (
    <span className={`vx-badge ${a.audience === "UNASSIGNED" ? "vx-badge--warn" : ""}`} dir="auto">
      {color ? <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden /> : null}
      {audienceLabel(a, deps, L)}
    </span>
  );
}

export function fmtDuration(sec: number | null): string {
  if (typeof sec !== "number" || !Number.isFinite(sec)) return "";
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const TYPES: { id: Audience; label: MgmtKey }[] = [
  { id: "NETWORK", label: "jg.aNetwork" },
  { id: "BRAND", label: "jg.aBrand" },
  { id: "REGION", label: "jg.aRegion" },
  { id: "BRAND_REGION", label: "jg.aBrandRegion" },
  { id: "LOCAL", label: "jg.aLocal" },
];

/** choose who receives a jingle: type (underline tabs) + the brand / region / branch it needs + who it reaches */
export function AudienceEditor({ value, onChange, deps, L, types }: { value: AudienceDraft; onChange: (d: AudienceDraft) => void; deps: AudienceDeps; L: Mgmt; types?: Audience[] }) {
  const shown = TYPES.filter((t) => !types || types.includes(t.id));
  const needBrand = value.audience === "BRAND" || value.audience === "BRAND_REGION";
  const needRegion = value.audience === "REGION" || value.audience === "BRAND_REGION";
  const needBranch = value.audience === "LOCAL";
  const complete = draftAudience(value);
  const n = reachCount(complete, deps);
  const field = "vx-field min-h-[44px] text-base";
  return (
    <div className="space-y-3">
      <div className="vx-tabs flex-wrap" role="radiogroup" aria-label={L.t("jg.audience")}>
        {shown.map((t) => (
          <button key={t.id} type="button" role="radio" aria-checked={value.audience === t.id} className={`vx-tab ${value.audience === t.id ? "is-active" : ""}`} onClick={() => onChange({ ...value, audience: t.id })}>
            {L.t(t.label)}
          </button>
        ))}
      </div>
      {needBrand || needRegion || needBranch ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {needBrand ? (
            <label className="block">
              <span className="vx-label">{L.t("jg.brand")}</span>
              <select className={field} style={{ colorScheme: "dark" }} value={value.audienceBrandId ?? ""} onChange={(e) => onChange({ ...value, audienceBrandId: e.target.value || null })}>
                <option value="">{L.t("jg.pick")}</option>
                {deps.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
          ) : null}
          {needRegion ? (
            <label className="block">
              <span className="vx-label">{L.t("jg.region")}</span>
              <select className={field} style={{ colorScheme: "dark" }} value={value.audienceRegion ?? ""} onChange={(e) => onChange({ ...value, audienceRegion: (e.target.value || null) as RegionId | null })}>
                <option value="">{L.t("jg.pick")}</option>
                {REGIONS.map((r) => <option key={r.id} value={r.id}>{L.region(r.id)}</option>)}
              </select>
            </label>
          ) : null}
          {needBranch ? (
            <label className="block sm:col-span-2">
              <span className="vx-label">{L.t("jg.branch")}</span>
              <select className={field} style={{ colorScheme: "dark" }} value={value.audienceBranchId ?? ""} onChange={(e) => onChange({ ...value, audienceBranchId: e.target.value || null })}>
                <option value="">{L.t("jg.pick")}</option>
                {deps.branches.map((b) => <option key={b.id} value={b.id}>{b.name}{b.branchNumber ? ` · ${b.branchNumber}` : ""}</option>)}
              </select>
            </label>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--sb-text-secondary)]" aria-live="polite">
        {complete ? (
          <>
            <AudienceBadge a={complete} deps={deps} L={L} />
            <span>{L.t("jg.reach", { branches: L.branches(n) })}</span>
            {complete.audience === "REGION" ? <span className="text-amber-300/90">{L.t("jg.crossBrand")}</span> : null}
          </>
        ) : (
          <span>{L.t("jg.choose")}</span>
        )}
      </div>
    </div>
  );
}

/** the Control Room context → a suggested audience (shown, never saved silently) */
export function suggestAudience(ctx: { brandId: string | null; region: RegionId | null; branchId: string | null }): AudienceDraft {
  if (ctx.branchId) return { ...EMPTY_DRAFT, audience: "LOCAL", audienceBranchId: ctx.branchId };
  if (ctx.brandId && ctx.region) return { ...EMPTY_DRAFT, audience: "BRAND_REGION", audienceBrandId: ctx.brandId, audienceRegion: ctx.region };
  if (ctx.brandId) return { ...EMPTY_DRAFT, audience: "BRAND", audienceBrandId: ctx.brandId };
  if (ctx.region) return { ...EMPTY_DRAFT, audience: "REGION", audienceRegion: ctx.region };
  return EMPTY_DRAFT;
}

/** PATCH the audience of a jingle (HQ) — the same row */
export async function patchAudience(id: string, a: JingleAudience): Promise<{ ok: boolean; item?: JingleItem; error?: string }> {
  try {
    const res = await fetch(`/api/jingles/library/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(a) });
    const d = (await res.json().catch(() => ({}))) as { item?: JingleItem; error?: string };
    return res.ok ? { ok: true, item: d.item } : { ok: false, error: d.error ?? `HTTP ${res.status}` };
  } catch {
    return { ok: false, error: "network" };
  }
}
