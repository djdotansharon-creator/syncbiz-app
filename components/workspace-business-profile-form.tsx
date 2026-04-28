"use client";

/**
 * Workspace Business Profile editor — tenant (`/settings`) or platform admin drill-down.
 * Maps to WorkspaceBusinessProfile (Stage 1). No recommendations or catalog UI.
 */

import type { WorkspaceBusinessProfileJson } from "@/lib/workspace-business-profile";
import type { BusinessType } from "@prisma/client";
import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useMemo, useState, useTransition } from "react";

type InitialProfile = WorkspaceBusinessProfileJson | Omit<WorkspaceBusinessProfileJson, "adminNotes">;

const BUSINESS_TYPES = [
  "RESTAURANT",
  "GYM",
  "HOTEL",
  "BAR",
  "CAFE",
  "RETAIL",
  "OFFICE",
  "OTHER",
] as const;

function linesFromArray(arr: string[] | undefined): string {
  return (arr ?? []).join("\n");
}

function arrayFromLines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function jsonPretty(v: unknown): string {
  if (v === null || v === undefined) return "";
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return "";
  }
}

type Props = {
  workspaceId: string;
  workspaceLabel?: string;
  initialProfile: InitialProfile | null;
  variant: "tenant" | "admin";
  canEdit: boolean;
  /** Platform admin workspace page wraps the card — omit duplicate border/header here */
  embedInPlatformAdminSection?: boolean;
};

function AdminSection({
  embedded,
  title,
  children,
}: {
  embedded: boolean;
  title: string;
  children: ReactNode;
}) {
  if (!embedded) return <>{children}</>;
  return (
    <div className="rounded-lg border border-neutral-800/70 bg-neutral-950/35 p-4">
      <p className="mb-4 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{title}</p>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function AdminJsonHint({ children }: { children: ReactNode }) {
  return <p className="mt-1 text-[11px] leading-snug text-neutral-500">{children}</p>;
}

export function WorkspaceBusinessProfileForm({
  workspaceId,
  workspaceLabel,
  initialProfile,
  variant,
  canEdit,
  embedInPlatformAdminSection,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const apiUrl = useMemo(
    () =>
      variant === "admin"
        ? `/api/admin/platform/workspaces/${workspaceId}/business-profile`
        : `/api/workspaces/${workspaceId}/business-profile`,
    [variant, workspaceId],
  );

  const [primaryBusinessType, setPrimaryBusinessType] = useState<BusinessType>(
    initialProfile?.primaryBusinessType ?? "OTHER",
  );
  const [cuisineOrConcept, setCuisineOrConcept] = useState(initialProfile?.cuisineOrConcept ?? "");
  const [conceptTags, setConceptTags] = useState(linesFromArray(initialProfile?.conceptTags));
  const [countryCode, setCountryCode] = useState(initialProfile?.countryCode ?? "");
  const [cultureNotes, setCultureNotes] = useState(initialProfile?.cultureNotes ?? "");
  const [primaryLanguage, setPrimaryLanguage] = useState(initialProfile?.primaryLanguage ?? "");
  const [additionalLanguages, setAdditionalLanguages] = useState(
    linesFromArray(initialProfile?.additionalLanguages),
  );
  const [audienceDescriptors, setAudienceDescriptors] = useState(
    linesFromArray(initialProfile?.audienceDescriptors),
  );
  const [desiredMoodNotes, setDesiredMoodNotes] = useState(initialProfile?.desiredMoodNotes ?? "");
  const [energyLevel, setEnergyLevel] = useState<string>(
    initialProfile?.energyLevel ?? "",
  );
  const [openingHoursSummary, setOpeningHoursSummary] = useState(
    initialProfile?.openingHoursSummary ?? "",
  );
  const [openingHoursStructured, setOpeningHoursStructured] = useState(
    jsonPretty(initialProfile?.openingHoursStructured),
  );
  const [daypartPreferences, setDaypartPreferences] = useState(
    jsonPretty(initialProfile?.daypartPreferences),
  );
  const [preferredStyleHints, setPreferredStyleHints] = useState(
    linesFromArray(initialProfile?.preferredStyleHints),
  );
  const [blockedStyleHints, setBlockedStyleHints] = useState(linesFromArray(initialProfile?.blockedStyleHints));
  const [adminNotes, setAdminNotes] = useState(
    variant === "admin" && initialProfile && "adminNotes" in initialProfile
      ? (initialProfile as WorkspaceBusinessProfileJson).adminNotes ?? ""
      : "",
  );

  const disabled = submitting || isPending || !canEdit;

  const embeddedAdmin = variant === "admin" && Boolean(embedInPlatformAdminSection);

  const shell =
    variant === "tenant"
      ? "rounded-2xl border border-slate-800/80 bg-slate-950/50 p-5 text-slate-200"
      : embeddedAdmin
        ? ""
        : "rounded-md border border-neutral-800 bg-neutral-900/40 p-4 text-sm text-neutral-200";

  const formClassName = [embeddedAdmin ? "space-y-6" : "space-y-4", shell].filter(Boolean).join(" ");

  const labelCls =
    variant === "admin"
      ? "block text-[11px] font-medium uppercase tracking-wide text-neutral-400"
      : "block text-xs font-medium text-slate-400";

  const inputCls =
    variant === "admin"
      ? "mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100 outline-none focus:border-neutral-500 disabled:opacity-50"
      : "mt-1 w-full rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-slate-600 disabled:opacity-50";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setSubmitting(true);
    let openingParsed: unknown = undefined;
    let daypartParsed: unknown = undefined;
    if (openingHoursStructured.trim()) {
      try {
        openingParsed = JSON.parse(openingHoursStructured) as unknown;
        if (typeof openingParsed !== "object" || openingParsed === null || Array.isArray(openingParsed)) {
          setError("`openingHoursStructured` must be a JSON object");
          setSubmitting(false);
          return;
        }
      } catch {
        setError("openingHoursStructured: invalid JSON");
        setSubmitting(false);
        return;
      }
    } else {
      openingParsed = null;
    }
    if (daypartPreferences.trim()) {
      try {
        daypartParsed = JSON.parse(daypartPreferences) as unknown;
        if (typeof daypartParsed !== "object" || daypartParsed === null || Array.isArray(daypartParsed)) {
          setError("`daypartPreferences` must be a JSON object");
          setSubmitting(false);
          return;
        }
      } catch {
        setError("daypartPreferences: invalid JSON");
        setSubmitting(false);
        return;
      }
    } else {
      daypartParsed = null;
    }

    const body: Record<string, unknown> = {
      primaryBusinessType,
      cuisineOrConcept: cuisineOrConcept.trim() || null,
      conceptTags: arrayFromLines(conceptTags),
      countryCode: countryCode.trim() || null,
      cultureNotes: cultureNotes.trim() || null,
      primaryLanguage: primaryLanguage.trim() || null,
      additionalLanguages: arrayFromLines(additionalLanguages),
      audienceDescriptors: arrayFromLines(audienceDescriptors),
      desiredMoodNotes: desiredMoodNotes.trim() || null,
      energyLevel: energyLevel === "" ? null : energyLevel,
      openingHoursSummary: openingHoursSummary.trim() || null,
      openingHoursStructured: openingParsed,
      daypartPreferences: daypartParsed,
      preferredStyleHints: arrayFromLines(preferredStyleHints),
      blockedStyleHints: arrayFromLines(blockedStyleHints),
    };
    if (variant === "admin") {
      body.adminNotes = adminNotes.trim() || null;
    }

    try {
      const res = await fetch(apiUrl, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { error?: string; profile?: WorkspaceBusinessProfileJson };
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setInfo("Saved.");
      if (data.profile) {
        setPrimaryBusinessType(data.profile.primaryBusinessType as BusinessType);
        setCuisineOrConcept(data.profile.cuisineOrConcept ?? "");
        setConceptTags(linesFromArray(data.profile.conceptTags));
        setCountryCode(data.profile.countryCode ?? "");
        setCultureNotes(data.profile.cultureNotes ?? "");
        setPrimaryLanguage(data.profile.primaryLanguage ?? "");
        setAdditionalLanguages(linesFromArray(data.profile.additionalLanguages));
        setAudienceDescriptors(linesFromArray(data.profile.audienceDescriptors));
        setDesiredMoodNotes(data.profile.desiredMoodNotes ?? "");
        setEnergyLevel(data.profile.energyLevel ?? "");
        setOpeningHoursSummary(data.profile.openingHoursSummary ?? "");
        setOpeningHoursStructured(jsonPretty(data.profile.openingHoursStructured));
        setDaypartPreferences(jsonPretty(data.profile.daypartPreferences));
        setPreferredStyleHints(linesFromArray(data.profile.preferredStyleHints));
        setBlockedStyleHints(linesFromArray(data.profile.blockedStyleHints));
        if (variant === "admin" && "adminNotes" in data.profile && data.profile.adminNotes !== undefined) {
          setAdminNotes(data.profile.adminNotes ?? "");
        }
      }
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className={formClassName}>
      {!embeddedAdmin ? (
        <div>
          <h2 className={variant === "admin" ? "text-xs font-semibold uppercase tracking-wide text-neutral-400" : "text-sm font-semibold text-slate-50"}>
            Business profile
          </h2>
          <p className={variant === "admin" ? "mt-1 text-[11px] text-neutral-500" : "mt-0.5 text-xs text-slate-400"}>
            Music / brand identity for this workspace — used later for catalog intelligence and recommendations. Branch-level{" "}
            <code className="rounded bg-black/30 px-1">businessType</code> is separate and not synced here.
          </p>
          {workspaceLabel ? (
            <p className="mt-1 font-mono text-[11px] text-neutral-500">{workspaceLabel}</p>
          ) : null}
        </div>
      ) : null}

      {!canEdit ? (
        <div className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[12px] text-amber-200">
          You can view this profile. Only workspace admins can edit (tenant route).
        </div>
      ) : null}

      <AdminSection embedded={embeddedAdmin} title="Identity">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className={labelCls}>Primary business type</label>
            <select
              value={primaryBusinessType}
              onChange={(e) => setPrimaryBusinessType(e.target.value as BusinessType)}
              disabled={disabled}
              className={inputCls}
            >
              {BUSINESS_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Energy level</label>
            <select value={energyLevel} onChange={(e) => setEnergyLevel(e.target.value)} disabled={disabled} className={inputCls}>
              <option value="">—</option>
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
            </select>
          </div>
        </div>

        <div>
          <label className={labelCls}>Cuisine / concept</label>
          <input
            type="text"
            value={cuisineOrConcept}
            onChange={(e) => setCuisineOrConcept(e.target.value)}
            disabled={disabled}
            className={inputCls}
            placeholder="e.g. Italian, Mediterranean"
          />
        </div>

        <div>
          <label className={labelCls}>Concept tags (one per line)</label>
          <textarea
            value={conceptTags}
            onChange={(e) => setConceptTags(e.target.value)}
            disabled={disabled}
            rows={3}
            className={inputCls}
            placeholder="Italian&#10;Wine bar"
          />
        </div>
      </AdminSection>

      <AdminSection embedded={embeddedAdmin} title="Locale & culture">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className={labelCls}>Country code</label>
            <input
              type="text"
              value={countryCode}
              onChange={(e) => setCountryCode(e.target.value)}
              disabled={disabled}
              maxLength={16}
              className={inputCls}
              placeholder="IL"
            />
          </div>
          <div>
            <label className={labelCls}>Primary language</label>
            <input
              type="text"
              value={primaryLanguage}
              onChange={(e) => setPrimaryLanguage(e.target.value)}
              disabled={disabled}
              className={inputCls}
              placeholder="he, en…"
            />
          </div>
        </div>

        <div>
          <label className={labelCls}>Culture notes</label>
          <textarea
            value={cultureNotes}
            onChange={(e) => setCultureNotes(e.target.value)}
            disabled={disabled}
            rows={2}
            className={inputCls}
          />
        </div>

        <div>
          <label className={labelCls}>Additional languages (one per line)</label>
          <textarea
            value={additionalLanguages}
            onChange={(e) => setAdditionalLanguages(e.target.value)}
            disabled={disabled}
            rows={2}
            className={inputCls}
          />
        </div>
      </AdminSection>

      <AdminSection embedded={embeddedAdmin} title="Audience & mood">
        <div>
          <label className={labelCls}>Audience descriptors (one per line)</label>
          <textarea
            value={audienceDescriptors}
            onChange={(e) => setAudienceDescriptors(e.target.value)}
            disabled={disabled}
            rows={2}
            className={inputCls}
            placeholder="Families&#10;Couples"
          />
        </div>

        <div>
          <label className={labelCls}>Desired mood notes</label>
          <textarea
            value={desiredMoodNotes}
            onChange={(e) => setDesiredMoodNotes(e.target.value)}
            disabled={disabled}
            rows={3}
            className={inputCls}
          />
        </div>
      </AdminSection>

      <AdminSection embedded={embeddedAdmin} title="Opening hours">
        <div>
          <label className={labelCls}>Opening hours (summary)</label>
          <textarea
            value={openingHoursSummary}
            onChange={(e) => setOpeningHoursSummary(e.target.value)}
            disabled={disabled}
            rows={2}
            className={inputCls}
            placeholder="Free text — not tied to schedules"
          />
        </div>

        <div>
          <label className={labelCls}>Opening hours structured (JSON object, optional)</label>
          {variant === "admin" ? (
            <AdminJsonHint>
              Paste a JSON object (curly braces — not a list). Leave blank to clear; invalid JSON will show the same error as before when you save.
            </AdminJsonHint>
          ) : null}
          <textarea
            value={openingHoursStructured}
            onChange={(e) => setOpeningHoursStructured(e.target.value)}
            disabled={disabled}
            rows={4}
            className={`${inputCls} font-mono text-[12px]`}
            placeholder='{}'
          />
        </div>
      </AdminSection>

      <AdminSection embedded={embeddedAdmin} title="Daypart preferences">
        <div>
          <label className={labelCls}>Daypart preferences (JSON object — keys e.g. MORNING / AFTERNOON / EVENING / NIGHT)</label>
          {variant === "admin" ? (
            <AdminJsonHint>
              Optional labels per daypart as a JSON object. Keys like MORNING / AFTERNOON / EVENING / NIGHT — still must be an object, not an array.
            </AdminJsonHint>
          ) : null}
          <textarea
            value={daypartPreferences}
            onChange={(e) => setDaypartPreferences(e.target.value)}
            disabled={disabled}
            rows={4}
            className={`${inputCls} font-mono text-[12px]`}
            placeholder='{"MORNING": "Calm"}'
          />
        </div>
      </AdminSection>

      <AdminSection embedded={embeddedAdmin} title="Style hints">
        <div>
          <label className={labelCls}>Preferred style hints (one per line)</label>
          <textarea
            value={preferredStyleHints}
            onChange={(e) => setPreferredStyleHints(e.target.value)}
            disabled={disabled}
            rows={2}
            className={inputCls}
          />
        </div>

        <div>
          <label className={labelCls}>Blocked style hints (one per line)</label>
          <textarea
            value={blockedStyleHints}
            onChange={(e) => setBlockedStyleHints(e.target.value)}
            disabled={disabled}
            rows={2}
            className={inputCls}
          />
        </div>
      </AdminSection>

      {variant === "admin" ? (
        <AdminSection embedded={embeddedAdmin} title="Platform-only notes">
          <div>
            <label className={labelCls}>Admin notes (platform)</label>
            <textarea
              value={adminNotes}
              onChange={(e) => setAdminNotes(e.target.value)}
              disabled={disabled}
              rows={3}
              maxLength={4000}
              className={inputCls}
            />
          </div>
        </AdminSection>
      ) : null}

      {error ? (
        <div className="rounded border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[12px] text-rose-300">{error}</div>
      ) : null}
      {info ? (
        <div className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[12px] text-emerald-300">{info}</div>
      ) : null}

      {canEdit ? (
        <div className="flex items-center gap-2 pt-1">
          <button
            type="submit"
            disabled={disabled}
            className={
              variant === "admin"
                ? "rounded border border-neutral-600 bg-neutral-100 px-3 py-1 text-[12px] font-medium text-neutral-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                : "rounded-lg border border-emerald-700/80 bg-emerald-600/90 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
            }
          >
            {submitting ? "Saving…" : "Save profile"}
          </button>
        </div>
      ) : null}
    </form>
  );
}
