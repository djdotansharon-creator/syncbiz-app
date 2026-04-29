/**
 * SUPER_ADMIN — internal recommendation preview (deterministic rules; copy aimed at operators).
 */

import Link from "next/link";
import type { WorkspaceBusinessProfile } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin } from "@/lib/auth/guards";
import { loadValidatedFitRules } from "@/lib/recommendations/load-fit-rules";
import {
  DAYPART_SLUGS,
  daypartSlugSchema,
  type DaypartSlug,
} from "@/lib/recommendations/fit-rules.types";
import {
  rankCatalogItemsByFit,
  type CatalogFitScoreRow,
  type WorkspaceFitContext,
} from "@/lib/recommendations/score-catalog-fit";
import { loadBusinessDaypartVibeRules } from "@/lib/recommendations/load-business-daypart-vibe";
import {
  DAYPART_SEGMENT_OPTIONS,
  resolveDaypartSegment,
} from "@/lib/recommendations/daypart-segment-map";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "SyncBiz Admin · Recommendation preview",
  robots: { index: false, follow: false },
};

function clampLimit(raw: unknown): number {
  const n = typeof raw === "string" ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n)) return 25;
  return Math.min(100, Math.max(1, n));
}

/** Short, plain-English lines for the transparency column (scoring unchanged). */
function transparencyPlainEnglish(row: CatalogFitScoreRow): { recommendedLines: string[]; notBoostedLines: string[] } {
  const recommendedLines: string[] = [
    `Catalog tags on this row (${row.matchedTags.length ? row.matchedTags.join(", ") : "—"}) are matched against the taxonomy rules pack — that drives the tag score.`,
  ];
  if (row.businessFitExplanations.length > 0) {
    recommendedLines.push(
      "The workspace’s primary business type matched at least one rule that can show business-fit captions (see below).",
    );
  }
  if (row.businessDaypartVibe && row.businessDaypartVibe.deltaVibe > 0) {
    recommendedLines.push(
      `Business type + daypart segment vibe (“${row.businessDaypartVibe.label}”) added a positive vibe adjustment on top of the tag score.`,
    );
  }
  if (row.profileDimensionHits.length > 0) {
    recommendedLines.push("Daypart, energy, audience, or mood signals from the workspace profile lined up with one or more rules (see matched profile boosts below).");
  }

  const notBoostedLines: string[] = [];
  if (!row.businessDaypartVibe) {
    notBoostedLines.push(
      "There is no business × daypart vibe matrix row for this workspace’s primary type and the selected segment — vibe adjustment stays at 0; only tag scoring applies for that layer.",
    );
  } else if (row.businessDaypartVibe.deltaVibe <= 0) {
    notBoostedLines.push(
      `Vibe adjustment did not increase the total (value ${row.businessDaypartVibe.deltaVibe >= 0 ? "+" : ""}${row.businessDaypartVibe.deltaVibe.toFixed(4)}) — preferred/avoid overlap, keyword strength, or daypart-preferences overlay may limit the lift (see technical block).`,
    );
  }
  if (row.neutralHits.some((h) => h.includes("affinity skipped"))) {
    notBoostedLines.push(
      "Some rules did not grant the extra business-type affinity (+0.55) because the workspace business type was outside that rule’s allowed list (see neutral lines below).",
    );
  }

  if (notBoostedLines.length === 0) {
    notBoostedLines.push(
      "No separate held-back factor beyond ordinary tag + vibe logic — open the technical sections below only if something looks surprising.",
    );
  }

  return { recommendedLines, notBoostedLines };
}

function mapProfile(
  row: Pick<
    WorkspaceBusinessProfile,
    | "primaryBusinessType"
    | "audienceDescriptors"
    | "energyLevel"
    | "preferredStyleHints"
    | "blockedStyleHints"
    | "desiredMoodNotes"
    | "cuisineOrConcept"
    | "conceptTags"
    | "daypartPreferences"
  >,
): WorkspaceFitContext {
  return {
    primaryBusinessType: row.primaryBusinessType,
    audienceDescriptors: row.audienceDescriptors,
    energyLevel: row.energyLevel,
    preferredStyleHints: row.preferredStyleHints,
    blockedStyleHints: row.blockedStyleHints,
    desiredMoodNotes: row.desiredMoodNotes,
    cuisineOrConcept: row.cuisineOrConcept,
    conceptTags: row.conceptTags,
    daypartPreferences: row.daypartPreferences ?? null,
  };
}

export default async function RecommendationPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ workspaceId?: string; daypart?: string; limit?: string; segment?: string }>;
}) {
  await requireSuperAdmin();

  const sp = await searchParams;
  const limit = clampLimit(sp.limit);

  const workspaces = await prisma.workspace.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const workspaceIdRaw =
    typeof sp.workspaceId === "string" && sp.workspaceId.trim().length > 0
      ? sp.workspaceId.trim()
      : workspaces[0]?.id ?? "";

  const daypartParsed = daypartSlugSchema.safeParse(sp.daypart);
  const daypart: DaypartSlug = daypartParsed.success ? daypartParsed.data : "dinner";

  const loaded = loadValidatedFitRules();
  const { rulesBySlug, version } = loaded;

  const vibeLoaded = loadBusinessDaypartVibeRules();

  const dictRows = await prisma.musicTaxonomyTag.findMany({
    select: { slug: true },
  });
  const dictSlugs = new Set(dictRows.map((r) => r.slug));
  const unknownRuleSlugs = [...rulesBySlug.keys()].filter((s) => !dictSlugs.has(s));

  const workspaceRow =
    workspaceIdRaw.length > 0
      ? await prisma.workspace.findUnique({
          where: { id: workspaceIdRaw },
          select: {
            id: true,
            name: true,
            businessProfile: {
              select: {
                primaryBusinessType: true,
                audienceDescriptors: true,
                energyLevel: true,
                preferredStyleHints: true,
                blockedStyleHints: true,
                desiredMoodNotes: true,
                cuisineOrConcept: true,
                conceptTags: true,
                daypartPreferences: true,
              },
            },
          },
        })
      : null;

  const workspaceMissing = workspaceIdRaw.length > 0 && !workspaceRow;

  const profileCtx = workspaceRow?.businessProfile ? mapProfile(workspaceRow.businessProfile) : null;

  const segmentResolved = resolveDaypartSegment({
    segmentParam: typeof sp.segment === "string" ? sp.segment : "",
    primaryBusinessType: profileCtx?.primaryBusinessType ?? null,
    coarseDaypart: daypart,
  });

  const catalogRowsRaw = await prisma.catalogItem.findMany({
    where: { taxonomyLinks: { some: {} } },
    select: {
      id: true,
      title: true,
      taxonomyLinks: { select: { taxonomyTag: { select: { slug: true } } } },
    },
  });

  const catalogInputs = catalogRowsRaw.map((row) => ({
    id: row.id,
    title: row.title,
    slugSet: new Set(row.taxonomyLinks.map((l) => l.taxonomyTag.slug)),
  }));

  const ranked = rankCatalogItemsByFit({
    profile: profileCtx,
    daypart,
    rulesBySlug,
    catalogRows: catalogInputs,
    limit,
    vibeRulesByKey: vibeLoaded.rulesByKey,
    daypartSegment: segmentResolved,
  }).filter((r) => r.matchedRuleSlugs.length > 0);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-wide text-neutral-500">
          <Link href="/admin/platform" className="text-sky-400 hover:underline">
            Platform
          </Link>
          <span className="text-neutral-600"> · </span>
          Recommendation preview
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-neutral-50">Recommendation preview</h1>
        <p className="mt-2 max-w-3xl text-sm text-neutral-400">
          Internal preview for admins — rankings come from saved JSON rules (no AI). Rules versions:{" "}
          <span className="text-neutral-200">
            Taxonomy rules v{version}
          </span>
          {" · "}
          <span className="text-neutral-200">
            Business daypart vibe matrix v{vibeLoaded.version}
          </span>
          . Tag score reflects catalog taxonomy tags; vibe adjustment reflects workspace business type + daypart segment.{" "}
          <Link href="/admin/platform/recommendation-coverage" className="text-sky-400 hover:underline">
            Coverage / debug dashboard
          </Link>
        </p>
      </div>

      {unknownRuleSlugs.length > 0 ? (
        <div className="rounded-md border border-amber-900/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-100">
          Unknown taxonomy slugs in fit-rules.json (not in dictionary):{" "}
          <span className="font-mono text-amber-50">{unknownRuleSlugs.join(", ")}</span>
        </div>
      ) : null}

      {workspaceMissing ? (
        <div className="rounded-md border border-rose-900/60 bg-rose-950/30 px-4 py-3 text-sm text-rose-100">
          Workspace id not found — rankings use the default OTHER profile until you pick a valid workspace.
        </div>
      ) : null}

      {workspaceRow && !workspaceRow.businessProfile ? (
        <div className="rounded-md border border-amber-900/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-100">
          This workspace has no Business Profile, so recommendations use OTHER/unknown business.
        </div>
      ) : null}

      <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 px-4 py-3 text-sm text-neutral-300">
        <p className="font-medium text-neutral-200">How scores combine</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-neutral-400">
          <li>
            <span className="text-neutral-200">Tag score</span> — match strength from catalog taxonomy tags vs the taxonomy rules pack.
          </li>
          <li>
            <span className="text-neutral-200">Vibe adjustment</span> — extra fit from workspace business type + daypart segment (business × daypart vibe matrix); can be zero.
          </li>
          <li>
            <span className="text-neutral-200">Total score</span> — tag score plus vibe adjustment (what sorts this table).
          </li>
        </ul>
      </div>
      <form
        action="/admin/platform/recommendation-preview"
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-md border border-neutral-800 bg-neutral-900/40 p-4"
      >
        <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-xs text-neutral-500">
          <span className="font-medium text-neutral-300">Workspace</span>
          <select
            name="workspaceId"
            defaultValue={workspaceIdRaw}
            className="rounded border border-neutral-700 bg-neutral-950 px-2 py-2 text-sm text-neutral-100"
          >
            {workspaces.length === 0 ? (
              <option value="">No workspaces</option>
            ) : (
              workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))
            )}
          </select>
        </label>
        <label className="flex min-w-[170px] flex-col gap-1 text-xs text-neutral-500">
          <span className="font-medium text-neutral-300">Daypart</span>
          <span className="text-[11px] leading-snug text-neutral-600">
            Sets the coarse music context for tag rules (morning / lunch / dinner / night).
          </span>
          <select
            name="daypart"
            defaultValue={daypart}
            className="rounded border border-neutral-700 bg-neutral-950 px-2 py-2 text-sm text-neutral-100"
          >
            {DAYPART_SLUGS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-[210px] flex-col gap-1 text-xs text-neutral-500">
          <span className="font-medium text-neutral-300">Daypart segment</span>
          <span className="text-[11px] leading-snug text-neutral-600">
            Pick the finer vibe slot for the matrix (business type × segment). Bars often default lunch→afternoon; override here.
          </span>
          <select
            name="segment"
            defaultValue={segmentResolved}
            className="rounded border border-neutral-700 bg-neutral-950 px-2 py-2 text-sm text-neutral-100"
          >
            {DAYPART_SEGMENT_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-[120px] flex-col gap-1 text-xs text-neutral-500">
          <span className="font-medium text-neutral-300">How many rows</span>
          <span className="text-[11px] leading-snug text-neutral-600">Number of recommendations to show.</span>
          <input
            type="number"
            name="limit"
            min={1}
            max={100}
            defaultValue={limit}
            className="rounded border border-neutral-700 bg-neutral-950 px-2 py-2 text-sm text-neutral-100"
          />
        </label>
        <button
          type="submit"
          className="rounded border border-neutral-600 bg-neutral-800 px-4 py-2 text-sm font-medium text-neutral-100 hover:bg-neutral-700"
        >
          Apply filters
        </button>
      </form>

      <section className="rounded-lg border border-neutral-800 bg-neutral-900/30 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">Workspace context</h2>
        {workspaceMissing ? (
          <p className="mt-2 text-sm text-rose-300">Unknown workspace — profile defaults to OTHER.</p>
        ) : workspaceRow ? (
          <dl className="mt-3 grid gap-2 text-sm text-neutral-300 sm:grid-cols-2">
            <div>
              <dt className="text-neutral-500">Workspace</dt>
              <dd>{workspaceRow.name}</dd>
            </div>
            <div>
              <dt className="text-neutral-500">Business Profile · primary type</dt>
              <dd>{profileCtx?.primaryBusinessType ?? "— (no Business Profile — scoring assumes OTHER)"}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-neutral-500">Energy level</dt>
              <dd>{profileCtx?.energyLevel ?? "—"}</dd>
            </div>
          </dl>
        ) : (
          <p className="mt-2 text-sm text-neutral-500">No workspace id — add a workspace or fix the URL.</p>
        )}
      </section>

      <section className="overflow-x-auto rounded-lg border border-neutral-800">
        <table className="min-w-[1080px] w-full border-collapse text-left text-sm">
          <thead className="border-b border-neutral-800 bg-neutral-900/80 text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-3 py-2 align-bottom font-medium normal-case">
                <div className="text-neutral-300">Score</div>
                <div className="mt-1 font-normal text-[10px] leading-tight text-neutral-500">
                  Total · tag score · vibe adjustment
                </div>
              </th>
              <th className="px-3 py-2 font-medium">Catalog item</th>
              <th className="px-3 py-2 font-medium">Matched tags</th>
              <th className="px-3 py-2 font-medium">Matched rule slugs</th>
              <th className="px-3 py-2 align-bottom font-medium normal-case">
                <div className="text-neutral-300">Why this ranked</div>
                <div className="mt-1 font-normal text-[10px] leading-tight text-neutral-500">
                  Plain-language summary, then technical detail
                </div>
              </th>
              <th className="px-3 py-2 font-medium">Penalties / blocks</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-800">
            {ranked.length === 0 ? (
              <tr>
                <td className="px-3 py-6 text-neutral-500" colSpan={6}>
                  No ranked rows — tag catalog items with starter-rule slugs or pick another workspace/daypart.
                </td>
              </tr>
            ) : (
              ranked.map((row) => {
                const plain = transparencyPlainEnglish(row);
                return (
                <tr key={row.catalogItemId} className="align-top hover:bg-neutral-900/40">
                  <td className="px-3 py-3 text-neutral-100">
                    <div className="font-medium tabular-nums text-neutral-100">{row.score.toFixed(4)}</div>
                    <div className="mt-1 space-y-0.5 text-[11px] text-neutral-400">
                      <div>
                        <span className="text-neutral-500">Tag score · </span>
                        <span className="font-mono tabular-nums text-neutral-300">{row.tagScore.toFixed(4)}</span>
                      </div>
                      <div>
                        <span className="text-neutral-500">Vibe adjustment · </span>
                        <span className="font-mono tabular-nums text-neutral-300">
                          {row.vibeDelta >= 0 ? "+" : ""}
                          {row.vibeDelta.toFixed(4)}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="font-medium text-neutral-100">{row.title}</div>
                    <div className="mt-1 font-mono text-[11px] text-neutral-500">{row.catalogItemId}</div>
                  </td>
                  <td className="max-w-[180px] px-3 py-3 font-mono text-[11px] text-neutral-300">
                    {row.matchedTags.join(", ")}
                  </td>
                  <td className="max-w-[180px] px-3 py-3 font-mono text-[11px] text-neutral-300">
                    {row.matchedRuleSlugs.join(", ")}
                  </td>
                  <td className="max-w-[420px] px-3 py-3 text-xs text-neutral-400">
                    <div className="space-y-3">
                      <div>
                        <p className="font-semibold text-neutral-200">Recommended because…</p>
                        <ul className="mt-1 list-disc space-y-1 pl-4 text-neutral-300">
                          {plain.recommendedLines.map((line, i) => (
                            <li key={i}>{line}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <p className="font-semibold text-neutral-200">Not boosted because…</p>
                        <ul className="mt-1 list-disc space-y-1 pl-4 text-neutral-400">
                          {plain.notBoostedLines.map((line, i) => (
                            <li key={i}>{line}</li>
                          ))}
                        </ul>
                      </div>
                      <div className="border-t border-neutral-800 pt-3">
                        <p className="font-semibold text-neutral-500">Technical details</p>
                      </div>
                      <div>
                        <p className="font-semibold text-neutral-500">Workspace / daypart snapshot</p>
                        <ul className="mt-1 list-disc space-y-0.5 pl-4 font-mono text-[11px] text-neutral-400">
                          {row.matchedProfileDimensions.map((line, i) => (
                            <li key={i}>{line}</li>
                          ))}
                        </ul>
                      </div>
                      {row.businessDaypartVibe ? (
                        <div>
                          <p className="font-semibold text-violet-400/90">Business daypart vibe matrix</p>
                          <p className="mt-1 text-neutral-300">
                            <span className="text-neutral-500">Label:</span> {row.businessDaypartVibe.label}
                          </p>
                          <p className="mt-0.5 font-mono text-[11px] text-neutral-300">
                            Δ vibe {row.businessDaypartVibe.deltaVibe >= 0 ? "+" : ""}
                            {row.businessDaypartVibe.deltaVibe.toFixed(4)} · keyword strength{" "}
                            {row.businessDaypartVibe.keywordStrength.toFixed(3)}
                          </p>
                          <p className="mt-1 text-[11px] text-neutral-500">
                            daypartPreferences overlay:{" "}
                            <span className="text-neutral-300">{row.businessDaypartVibe.daypartPreferencesOverlay}</span>
                          </p>
                          <p className="mt-1 text-neutral-400">{row.businessDaypartVibe.explainHuman}</p>
                          <p className="mt-1 font-mono text-[10px] text-neutral-500">
                            Preferred hits:{" "}
                            {row.businessDaypartVibe.matchedPreferredHints.length
                              ? row.businessDaypartVibe.matchedPreferredHints.join(", ")
                              : "—"}
                          </p>
                          <p className="mt-0.5 font-mono text-[10px] text-neutral-500">
                            Avoid hits:{" "}
                            {row.businessDaypartVibe.matchedAvoidHints.length
                              ? row.businessDaypartVibe.matchedAvoidHints.join(", ")
                              : "—"}
                          </p>
                        </div>
                      ) : (
                        <div>
                          <p className="font-semibold text-neutral-600">Business daypart vibe matrix</p>
                          <p className="mt-1 text-[11px] text-neutral-500">
                            No matrix row for this workspace primary type + segment — tag score only (vibe Δ 0).
                          </p>
                        </div>
                      )}
                      {row.neutralHits.length > 0 ? (
                        <div>
                          <p className="font-semibold text-neutral-500">Neutral tag / gate</p>
                          <ul className="mt-1 list-disc space-y-1 pl-4">
                            {row.neutralHits.map((line, i) => (
                              <li key={i}>{line}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {row.businessFitExplanations.length > 0 ? (
                        <div>
                          <p className="font-semibold text-emerald-500/90">Business-fit captions (workspace matches rule venues)</p>
                          <ul className="mt-1 list-disc space-y-1 pl-4 text-neutral-300">
                            {row.businessFitExplanations.map((line, i) => (
                              <li key={i}>{line}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {row.profileDimensionHits.length > 0 ? (
                        <div>
                          <p className="font-semibold text-sky-500/90">Matched profile boosts</p>
                          <ul className="mt-1 list-disc space-y-1 pl-4">
                            {row.profileDimensionHits.map((line, i) => (
                              <li key={i}>{line}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      <div>
                        <p className="font-semibold text-neutral-500">Per-rule contribution</p>
                        <ul className="mt-1 space-y-1 font-mono text-[11px] text-neutral-400">
                          {row.ruleBreakdown.map((part) => (
                            <li key={part.taxonomyTagSlug}>
                              <span className="text-neutral-500">{part.taxonomyTagSlug}</span>: base {part.base.toFixed(3)} + affinity{" "}
                              {part.primaryBusinessBoost.toFixed(3)} + day {part.daypartBoost.toFixed(3)} + energy {part.energyBoost.toFixed(3)}{" "}
                              + aud {part.audienceBoost.toFixed(3)} + mood {part.moodBoost.toFixed(3)} → {part.subtotalBeforeAvoid.toFixed(3)}
                              {part.avoidMultiplierApplied != null ? (
                                <> × {part.avoidMultiplierApplied} → {part.contributionAfterAvoid.toFixed(3)}</>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </td>
                  <td className="max-w-[280px] px-3 py-3 text-xs text-neutral-400">
                    {row.penaltyReasons.length === 0 && row.blockedReasons.length === 0 ? (
                      <span className="text-neutral-600">—</span>
                    ) : (
                      <div className="space-y-2">
                        {row.penaltyReasons.length > 0 ? (
                          <div>
                            <span className="font-semibold text-amber-400/90">Penalty:</span>
                            <ul className="mt-1 list-disc space-y-1 pl-4 text-amber-100/90">
                              {row.penaltyReasons.map((p, i) => (
                                <li key={i}>{p}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                        {row.blockedReasons.length > 0 ? (
                          <div>
                            <span className="font-semibold text-rose-400/90">Blocked:</span>
                            <ul className="mt-1 list-disc space-y-1 pl-4 text-rose-100/90">
                              {row.blockedReasons.map((p, i) => (
                                <li key={i}>{p}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </div>
                    )}
                  </td>
                </tr>
              );
              })
            )}

          </tbody>
        </table>
      </section>
    </div>
  );
}
