/**
 * Stage 7.3 — Music Programming coverage health + editor work queue (read-only).
 */

import { readFileSync } from "fs";
import { join } from "path";
import Link from "next/link";
import { requireSuperAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import { generateCatalogCoverageHealthReport } from "@/lib/recommendations/catalog-coverage-health";
import { generateCatalogEditorWorkQueueReport } from "@/lib/recommendations/catalog-coverage-work-queue";
import { parseCatalogCoverageTargetsBundle } from "@/lib/recommendations/catalog-coverage-targets.types";
import { assessCatalogItemReadiness } from "@/lib/recommendations/catalog-item-readiness";
import {
  assessCatalogItemEligibility,
  type CatalogEligibilityAssessment,
} from "@/lib/recommendations/catalog-item-eligibility";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "SyncBiz Admin · Catalog coverage (programming packs)",
  robots: { index: false, follow: false },
};

const btnSecondary =
  "inline-flex items-center justify-center rounded-md border border-neutral-600 bg-neutral-800 px-3 py-2 text-xs font-medium text-neutral-100 hover:bg-neutral-700";

function healthPillClass(status: string): string {
  switch (status) {
    case "healthy":
      return "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30";
    case "critical":
      return "bg-rose-500/15 text-rose-300 ring-rose-500/30";
    default:
      return "bg-amber-500/15 text-amber-300 ring-amber-500/30";
  }
}

export default async function CatalogCoverageDashboardPage() {
  await requireSuperAdmin();

  const jsonPath = join(process.cwd(), "lib/recommendations/catalog-coverage-targets.json");
  const raw: unknown = JSON.parse(readFileSync(jsonPath, "utf8"));
  const parsed = parseCatalogCoverageTargetsBundle(raw);
  if (!parsed.success) {
    return (
      <div className="rounded-lg border border-rose-800 bg-rose-950/40 p-4 text-sm text-rose-200">
        Invalid <code className="text-xs">catalog-coverage-targets.json</code> — check bundle schema.
      </div>
    );
  }

  const items = await prisma.catalogItem.findMany({
    where: { archivedAt: null },
    select: {
      id: true,
      title: true,
      url: true,
      provider: true,
      durationSec: true,
      thumbnail: true,
      manualEnergyRating: true,
      archivedAt: true,
      taxonomyLinks: {
        select: {
          taxonomyTag: { select: { slug: true, category: true } },
        },
      },
    },
  });

  const health = generateCatalogCoverageHealthReport(parsed.data, items);
  const workQueue = generateCatalogEditorWorkQueueReport(parsed.data, items, { candidateLimit: 5 });

  /** Stage 10 — derive global eligibility per item for diagnostic display in candidate rows. */
  const eligibilityById = new Map<string, CatalogEligibilityAssessment>();
  for (const it of items) {
    const readiness = assessCatalogItemReadiness({
      url: it.url,
      provider: it.provider,
      durationSec: it.durationSec,
      thumbnail: it.thumbnail,
      manualEnergyRating: it.manualEnergyRating,
      linkedCategories: it.taxonomyLinks.map((l) => l.taxonomyTag.category),
    });
    eligibilityById.set(it.id, assessCatalogItemEligibility(readiness));
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs uppercase tracking-wide text-neutral-500">
          <Link href="/admin/platform" className="text-sky-400 hover:underline">
            Platform
          </Link>
          <span className="text-neutral-600"> · </span>
          <Link href="/admin/platform/recommendation-coverage" className="text-sky-400 hover:underline">
            Recommendation coverage
          </Link>
          <span className="text-neutral-600"> · </span>
          Programming packs
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-neutral-50">Catalog coverage — programming packs</h1>
        <p className="mt-2 max-w-3xl text-sm text-neutral-400">
          Stage 7 read-only snapshot: six Music Programming Coverage packs vs live catalog tags, energy, and URL
          shape. Does not change scoring or DJ Creator. CLI:{" "}
          <code className="text-xs text-neutral-500">npm run catalog-coverage:report</code>,{" "}
          <code className="text-xs text-neutral-500">npm run catalog-coverage:work-queue</code>.
        </p>
        <p className="mt-2 max-w-3xl text-xs text-neutral-500">
          Workflow: pick a weak pack, open a candidate in tagging, fix the missing dimensions and energy / URL type,
          return here. <code className="text-[11px] text-neutral-600">LIMITED</code> /{" "}
          <code className="text-[11px] text-neutral-600">BLOCKED</code> chips on candidates show global eligibility
          across DJ Creator and Coverage strict flows. See{" "}
          <code className="text-[11px] text-neutral-600">docs/CATALOG-OPERATING-SYSTEM-V1.md</code> for the
          end-to-end editor guide.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/admin/platform/catalog-tagging" className={btnSecondary}>
            Catalog tagging
          </Link>
          <Link href="/admin/platform/recommendation-coverage" className={btnSecondary}>
            Recommendation coverage
          </Link>
        </div>
      </div>

      <section className="rounded-lg border border-teal-900/40 bg-teal-950/20 p-4 text-sm text-neutral-300">
        <p>
          <span className="font-medium text-teal-200">Active catalog rows loaded:</span>{" "}
          {health.catalogItemCountActive} (non-archived). Snapshot{" "}
          <time dateTime={health.generatedAt} title={health.generatedAt}>
            {new Date(health.generatedAt).toLocaleString()}
          </time>
          .
        </p>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        {health.packs.map((hp) => {
          const wp = workQueue.packs.find((x) => x.packId === hp.packId);
          const missingDur = Math.max(0, hp.totalMatching - hp.itemsWithDurationSec);
          const missingThumb = Math.max(0, hp.totalMatching - hp.itemsWithThumbnail);
          const taggingPreview = wp?.taggingTasks.slice(0, 4) ?? [];
          const metaPreview = wp?.metadataTasks.slice(0, 3) ?? [];
          const contentPreview = wp?.contentAcquisitionTasks.slice(0, 2) ?? [];

          return (
            <article
              key={hp.packId}
              className="flex flex-col rounded-lg border border-neutral-800 bg-neutral-900/40 p-5 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold text-neutral-100">{hp.labelEn}</h2>
                  <p className="text-xs text-neutral-500">{hp.labelHe}</p>
                  <code className="mt-1 block text-[11px] text-neutral-600">{hp.packId}</code>
                </div>
                <span
                  className={`inline-flex shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ring-1 ${healthPillClass(hp.healthStatus)}`}
                >
                  {hp.healthStatus}
                </span>
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 text-xs sm:grid-cols-3">
                <div className="rounded border border-neutral-800/80 bg-neutral-950/50 px-2 py-1.5" title="Loose pool: non-archived items sharing any pack tag (union). Right value is pack targetMinimumItems.">
                  <dt className="text-neutral-500">Loose / min target</dt>
                  <dd className="font-mono text-neutral-200">
                    {hp.totalMatching} / {hp.targetMinimumItems}
                  </dd>
                </div>
                <div className="rounded border border-neutral-800/80 bg-neutral-950/50 px-2 py-1.5">
                  <dt className="text-neutral-500">Single / target</dt>
                  <dd className="font-mono text-neutral-200">
                    {hp.singleCount} / {hp.targetSingleCount ?? "—"}
                  </dd>
                </div>
                <div className="rounded border border-neutral-800/80 bg-neutral-950/50 px-2 py-1.5">
                  <dt className="text-neutral-500">SET_MIX / target</dt>
                  <dd className="font-mono text-neutral-200">
                    {hp.setMixCount} / {hp.targetSetMixCount ?? "—"}
                  </dd>
                </div>
                <div className="rounded border border-neutral-800/80 bg-neutral-950/50 px-2 py-1.5">
                  <dt className="text-neutral-500">Missing manual energy</dt>
                  <dd className="font-mono text-neutral-200">{hp.missingManualEnergyRating}</dd>
                </div>
                <div className="rounded border border-neutral-800/80 bg-neutral-950/50 px-2 py-1.5">
                  <dt className="text-neutral-500">Missing duration</dt>
                  <dd className="font-mono text-neutral-200">{missingDur}</dd>
                </div>
                <div className="rounded border border-neutral-800/80 bg-neutral-950/50 px-2 py-1.5">
                  <dt className="text-neutral-500">Missing thumbnail</dt>
                  <dd className="font-mono text-neutral-200">{missingThumb}</dd>
                </div>
                <div className="col-span-2 rounded border border-neutral-800/80 bg-neutral-950/50 px-2 py-1.5 sm:col-span-3">
                  <dt className="text-neutral-500">Strict matches (all declared dimensions)</dt>
                  <dd className="font-mono text-neutral-200">{hp.strictAllDeclaredDimensionsCount}</dd>
                </div>
              </dl>

              <div className="mt-4">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                  Top missing dimensions
                </h3>
                <p className="mt-1 text-sm text-neutral-300">
                  {hp.topMissingDimensions.length > 0 ? hp.topMissingDimensions.join(", ") : "—"}
                </p>
              </div>

              <div className="mt-3">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                  Health summary
                </h3>
                <p className="mt-1 text-sm leading-relaxed text-neutral-400 break-words">{hp.recommendedEditorAction}</p>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <div>
                  <h3 className="text-[11px] font-semibold uppercase tracking-wide text-amber-500/80">Tagging tasks</h3>
                  <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-neutral-400">
                    {taggingPreview.map((t, i) => (
                      <li key={`${hp.packId}-t-${i}`}>{t.summary}</li>
                    ))}
                    {taggingPreview.length === 0 ? <li className="text-neutral-600">None generated.</li> : null}
                  </ul>
                </div>
                <div>
                  <h3 className="text-[11px] font-semibold uppercase tracking-wide text-sky-500/80">Metadata</h3>
                  <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-neutral-400">
                    {metaPreview.map((t, i) => (
                      <li key={`${hp.packId}-m-${i}`}>{t.summary}</li>
                    ))}
                    {metaPreview.length === 0 ? <li className="text-neutral-600">None.</li> : null}
                  </ul>
                </div>
                <div>
                  <h3 className="text-[11px] font-semibold uppercase tracking-wide text-violet-400/90">Content</h3>
                  <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-neutral-400">
                    {contentPreview.map((t, i) => (
                      <li key={`${hp.packId}-c-${i}`}>{t.summary}</li>
                    ))}
                    {contentPreview.length === 0 ? <li className="text-neutral-600">None.</li> : null}
                  </ul>
                </div>
              </div>

              <div className="mt-4 border-t border-neutral-800 pt-4">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                  Close candidates (tag next)
                </h3>
                <ul className="mt-2 space-y-3">
                  {(wp?.candidates ?? []).map((c) => {
                    const elig = eligibilityById.get(c.catalogItemId) ?? null;
                    const eligPillClass =
                      elig?.tier === "limited"
                        ? "border-amber-700/55 bg-amber-950/40 text-amber-100"
                        : elig?.tier === "blocked"
                          ? "border-rose-800/55 bg-rose-950/45 text-rose-100"
                          : null;
                    const eligPillLabel =
                      elig?.tier === "limited" ? "LIMITED" : elig?.tier === "blocked" ? "BLOCKED" : null;
                    const eligTooltip = elig
                      ? [`Eligibility · ${elig.tier}`, ...elig.reasons].join("\n")
                      : "";
                    return (
                      <li key={c.catalogItemId} className="rounded border border-neutral-800/80 bg-neutral-950/40 p-2 text-xs">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium text-neutral-200">
                          <Link
                            href={`/admin/platform/catalog-tagging?catalogItemId=${encodeURIComponent(c.catalogItemId)}&fromCoverage=1&coveragePack=${encodeURIComponent(hp.packId)}&coveragePackLabel=${encodeURIComponent(hp.labelEn)}&coverageMissing=${encodeURIComponent(c.missingTagDimensions.join(","))}&coverageEnergy=${encodeURIComponent(c.needsEnergyAttention ? "needs" : c.hasManualEnergy ? "ok" : "unset")}${c.inferredUrlType ? `&coverageUrlType=${encodeURIComponent(c.inferredUrlType)}` : ""}&coverageUrlShape=${encodeURIComponent(c.urlShape)}`}
                            className="text-sky-400 hover:underline"
                          >
                            Open in tagging
                          </Link>
                          <span className="text-neutral-600">·</span>
                          <span className="min-w-0 truncate">{c.title.length > 70 ? `${c.title.slice(0, 70)}…` : c.title}</span>
                          {eligPillLabel && eligPillClass ? (
                            <span
                              title={eligTooltip}
                              className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${eligPillClass}`}
                            >
                              {eligPillLabel}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1 font-mono text-[10px] text-neutral-600 break-all">{c.url}</div>
                        <div className="mt-1 text-neutral-500">
                          Missing: {c.missingTagDimensions.join(", ") || "—"} · Energy:{" "}
                          {c.needsEnergyAttention ? "needs band" : c.hasManualEnergy ? "ok" : "unset"} · Meta:{" "}
                          {c.hasBasicMetadata ? "ok" : "thin"} · {c.inferredUrlType ?? "?"}/{c.urlShape}
                        </div>
                        <p className="mt-1 text-[11px] text-neutral-400">{c.suggestedEditorAction}</p>
                      </li>
                    );
                  })}
                  {(wp?.candidates.length ?? 0) === 0 ? (
                    <li className="text-neutral-600">No loose non-strict rows in cap — run work-queue CLI for more.</li>
                  ) : null}
                </ul>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
