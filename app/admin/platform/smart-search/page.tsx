/**
 * Stage 6 V1 — Smart catalog search preview (deterministic parser + existing fit scoring).
 */

import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin } from "@/lib/auth/guards";
import {
  DAYPART_SLUGS,
  daypartSlugSchema,
  type DaypartSlug,
} from "@/lib/recommendations/fit-rules.types";
import { loadValidatedFitRules } from "@/lib/recommendations/load-fit-rules";
import { runSmartCatalogSearch } from "@/lib/recommendations/smart-catalog-search";
import { SmartSearchCopyUrlButton } from "./copy-url-button";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "SyncBiz Admin · Smart catalog search",
  robots: { index: false, follow: false },
};

function clampLimit(raw: unknown): number {
  const n = typeof raw === "string" ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n)) return 25;
  return Math.min(100, Math.max(1, n));
}

function fmtDuration(sec: number | null | undefined): string {
  if (sec == null || sec < 0) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default async function SmartCatalogSearchPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    workspaceId?: string;
    daypart?: string;
    limit?: string;
  }>;
}) {
  await requireSuperAdmin();

  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const limit = clampLimit(sp.limit);

  const workspaces = await prisma.workspace.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const workspaceIdRaw =
    typeof sp.workspaceId === "string" && sp.workspaceId.trim().length > 0
      ? sp.workspaceId.trim()
      : "";

  const daypartParsed = daypartSlugSchema.safeParse(sp.daypart);
  const daypartOverride: DaypartSlug | null = daypartParsed.success ? daypartParsed.data : null;

  const loaded = loadValidatedFitRules();
  const dictRows = await prisma.musicTaxonomyTag.findMany({ select: { slug: true } });
  const dictSlugs = new Set(dictRows.map((r) => r.slug));
  const unknownRuleSlugs = [...loaded.rulesBySlug.keys()].filter((s) => !dictSlugs.has(s));

  const workspaceMissing = workspaceIdRaw.length > 0
    ? !(await prisma.workspace.findUnique({ where: { id: workspaceIdRaw }, select: { id: true } }))
    : false;

  const data =
    q.length >= 1
      ? await runSmartCatalogSearch({
          query: q,
          workspaceId: workspaceIdRaw.length > 0 ? workspaceIdRaw : null,
          daypartOverride,
          limit,
        })
      : null;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-wide text-neutral-500">
          <Link href="/admin/platform" className="text-sky-400 hover:underline">
            Platform
          </Link>
          <span className="text-neutral-600"> · </span>
          Smart catalog search
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-neutral-50">Smart catalog search</h1>
        <p className="mt-2 max-w-3xl text-sm text-neutral-400">
          Deterministic Hebrew/English keyword parsing (V1 preview) + catalog fit scoring from{" "}
          <code className="text-neutral-300">fit-rules.json</code> and the business-daypart vibe matrix. No AI,
          embeddings, or playback. Rules: taxonomy v{loaded.version}
          {data ? ` · matrix v${data.vibeRulesVersion}` : null}.
        </p>
      </div>

      {unknownRuleSlugs.length > 0 ? (
        <div className="rounded-md border border-amber-900/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-100">
          Unknown taxonomy slugs in fit-rules.json:{" "}
          <span className="font-mono text-amber-50">{unknownRuleSlugs.join(", ")}</span>
        </div>
      ) : null}

      {workspaceMissing ? (
        <div className="rounded-md border border-rose-900/60 bg-rose-950/30 px-4 py-3 text-sm text-rose-100">
          Workspace id not found — search runs without that workspace profile.
        </div>
      ) : null}

      <form
        action="/admin/platform/smart-search"
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-md border border-neutral-800 bg-neutral-900/40 p-4"
      >
        <label className="flex min-w-[260px] flex-[2] flex-col gap-1 text-xs text-neutral-500">
          <span className="font-medium text-neutral-300">Query</span>
          <input
            name="q"
            type="text"
            defaultValue={q}
            placeholder="בוקר רומנטי למסעדה · ערב אפרו מכון כושר · romantic dinner restaurant"
            className="rounded border border-neutral-700 bg-neutral-950 px-2 py-2 text-sm text-neutral-100 placeholder:text-neutral-600"
            autoComplete="off"
          />
        </label>
        <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-xs text-neutral-500">
          <span className="font-medium text-neutral-300">Workspace (optional)</span>
          <select
            name="workspaceId"
            defaultValue={workspaceIdRaw}
            className="rounded border border-neutral-700 bg-neutral-950 px-2 py-2 text-sm text-neutral-100"
          >
            <option value="">— None (query-only profile) —</option>
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-[140px] flex-col gap-1 text-xs text-neutral-500">
          <span className="font-medium text-neutral-300">Daypart override</span>
          <span className="text-[11px] text-neutral-600">Blank = use parsed query</span>
          <select
            name="daypart"
            defaultValue={sp.daypart ?? ""}
            className="rounded border border-neutral-700 bg-neutral-950 px-2 py-2 text-sm text-neutral-100"
          >
            <option value="">(from query)</option>
            {DAYPART_SLUGS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-[100px] flex-col gap-1 text-xs text-neutral-500">
          <span className="font-medium text-neutral-300">Top N</span>
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
          Search
        </button>
      </form>

      {q.length < 1 ? (
        <div className="rounded-md border border-neutral-800 bg-neutral-900/40 p-4 text-sm text-neutral-400">
          Enter a query to see parsed intent and ranked catalog rows.
        </div>
      ) : data ? (
        <>
          <section className="rounded-lg border border-neutral-800 bg-neutral-900/30 p-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
              Parsed query
            </h2>
            <dl className="mt-3 grid gap-2 text-sm text-neutral-300 sm:grid-cols-2">
              <div>
                <dt className="text-neutral-500">Business type (from text)</dt>
                <dd>{data.parsed.businessType ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-neutral-500">Daypart · vibe segment</dt>
                <dd>
                  {data.coarseDaypart} · {data.vibeSegment.replace(/_/g, " ")}
                  {daypartOverride ? (
                    <span className="ml-2 text-[11px] text-amber-400">(daypart overridden in form)</span>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt className="text-neutral-500">Mood hints</dt>
                <dd>{data.parsed.moodHints.length ? data.parsed.moodHints.join(", ") : "—"}</dd>
              </div>
              <div>
                <dt className="text-neutral-500">Energy hint</dt>
                <dd>{data.parsed.energyHint ?? "—"}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-neutral-500">Style / taxonomy hints (parser)</dt>
                <dd className="font-mono text-[12px] text-neutral-200">
                  {data.parsed.styleTaxonomySlugs.length
                    ? data.parsed.styleTaxonomySlugs.join(", ")
                    : "—"}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-neutral-500">Matched taxonomy slugs in dictionary</dt>
                <dd className="font-mono text-[12px] text-sky-300/90">
                  {data.parserTaxonomyInDictionary.length
                    ? data.parserTaxonomyInDictionary.join(", ")
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-neutral-500">Audience hints</dt>
                <dd>{data.parsed.audienceHints.length ? data.parsed.audienceHints.join(", ") : "—"}</dd>
              </div>
              <div>
                <dt className="text-neutral-500">Concept tags</dt>
                <dd>{data.parsed.conceptTags.length ? data.parsed.conceptTags.join(", ") : "—"}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-neutral-500">Matched phrases</dt>
                <dd>{[...new Set(data.parsed.matchedPhrases)].join(" · ") || "—"}</dd>
              </div>
            </dl>
            <div className="mt-4 border-t border-neutral-800 pt-3 text-xs text-neutral-500">
              <span className="text-neutral-400">Effective workspace profile for scoring:</span> primary{" "}
              <span className="text-neutral-300">{data.profileUsed.primaryBusinessType}</span>
              {" · "}energy{" "}
              <span className="text-neutral-300">{data.profileUsed.energyLevel ?? "—"}</span>
              {" · "}
              {data.profileUsed.preferredStyleHints.length ? (
                <span className="text-neutral-400">
                  style hints: {data.profileUsed.preferredStyleHints.slice(0, 12).join(", ")}
                  {data.profileUsed.preferredStyleHints.length > 12 ? "…" : ""}
                </span>
              ) : (
                <span>no extra style hints</span>
              )}
            </div>
          </section>

          {data.rows.length > 0 && !data.rows.some((r) => r.matchedTags.length > 0) ? (
            <div className="rounded-md border border-amber-900/50 bg-amber-950/25 px-4 py-3 text-sm text-amber-100">
              No overlap between catalog tags and fit-rules in this window — scores are near zero; add broader tags or
              extend the catalog scan.
            </div>
          ) : null}

          <section className="overflow-x-auto rounded-lg border border-neutral-800">
            <table className="min-w-[1100px] w-full border-collapse text-left text-sm">
              <thead className="border-b border-neutral-800 bg-neutral-900/80 text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Score</th>
                  <th className="px-3 py-2 font-medium">Title / URL</th>
                  <th className="px-3 py-2 font-medium">Duration</th>
                  <th className="px-3 py-2 font-medium">Curation</th>
                  <th className="px-3 py-2 font-medium">Views / likes</th>
                  <th className="px-3 py-2 font-medium">Matched tags</th>
                  <th className="px-3 py-2 font-medium">Why</th>
                  <th className="px-3 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800">
                {data.rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-6 text-neutral-500">
                      No catalog rows with taxonomy tags in the scanned set, or no overlap with fit rules.
                    </td>
                  </tr>
                ) : (
                  data.rows.map((row) => (
                    <tr key={row.catalogItemId} className="align-top hover:bg-neutral-900/40">
                      <td className="px-3 py-3 tabular-nums text-neutral-100">
                        <div className="font-medium">{row.displayScore.toFixed(4)}</div>
                        <div className="text-[10px] text-neutral-500">
                          base {row.baseFitScore.toFixed(4)}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-neutral-200">
                        <div className="font-medium text-neutral-100">{row.title}</div>
                        <div className="mt-1 font-mono text-[11px] text-neutral-500">{row.url}</div>
                        <div className="mt-1 text-[11px] text-neutral-600">{row.provider ?? "—"}</div>
                      </td>
                      <td className="px-3 py-3 text-neutral-300">{fmtDuration(row.durationSec)}</td>
                      <td className="px-3 py-3 tabular-nums text-neutral-300">{row.curationRating}</td>
                      <td className="px-3 py-3 tabular-nums text-[12px] text-neutral-400">
                        {row.viewCount != null ? row.viewCount.toLocaleString() : "—"}
                        {" / "}
                        {row.likeCount != null ? row.likeCount.toLocaleString() : "—"}
                      </td>
                      <td className="px-3 py-3 font-mono text-[11px] text-sky-300/90">
                        {row.matchedTags.join(", ") || "—"}
                      </td>
                      <td className="max-w-[340px] px-3 py-3 text-[12px] leading-snug text-neutral-400">
                        {row.recommendedBecause}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-col gap-1.5">
                          <a
                            href={row.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[11px] text-sky-400 hover:underline"
                          >
                            Open source
                          </a>
                          <Link
                            href={`/admin/platform/catalog-tagging?catalogItemId=${encodeURIComponent(row.catalogItemId)}`}
                            className="text-[11px] text-sky-400 hover:underline"
                          >
                            Catalog tagging
                          </Link>
                          <SmartSearchCopyUrlButton url={row.url} />
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </section>
        </>
      ) : null}

      <p className="text-[11px] text-neutral-600">
        Dictionary: {dictSlugs.size} taxonomy slugs. Scoring reuses{" "}
        <code className="text-neutral-500">rankCatalogItemsByFit</code>; display score adds a small curation
        multiplier and log views hint only — never dominant.
      </p>
    </div>
  );
}
