/**
 * Stage 5.3–5.4 — SUPER_ADMIN coverage diagnostics + action dashboard for Recommendation Preview inputs.
 */

import Link from "next/link";
import { requireSuperAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import { loadValidatedFitRules } from "@/lib/recommendations/load-fit-rules";
import { loadBusinessDaypartVibeRules } from "@/lib/recommendations/load-business-daypart-vibe";
import { catalogDiscoveryActiveWhere } from "@/lib/catalog-discovery-scope";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "SyncBiz Admin · Recommendation coverage",
  robots: { index: false, follow: false },
};

const LIST_CAP = 60;
const TOP_TAGS = 25;
const UNTAGGED_SAMPLE = 25;

const btnSecondary =
  "inline-flex items-center justify-center rounded-md border border-neutral-600 bg-neutral-800 px-3 py-2 text-xs font-medium text-neutral-100 hover:bg-neutral-700";

export default async function RecommendationCoveragePage() {
  await requireSuperAdmin();

  const loadedFit = loadValidatedFitRules();
  const vibeLoaded = loadBusinessDaypartVibeRules();
  const fitRuleSlugs = [...loadedFit.rulesBySlug.keys()];

  const vibeHintSlugs = new Set<string>();
  for (const row of vibeLoaded.rulesByKey.values()) {
    for (const s of row.preferredTaxonomyHints) vibeHintSlugs.add(s);
    for (const s of row.avoidTaxonomyHints) vibeHintSlugs.add(s);
  }

  const [
    totalCatalog,
    taggedCatalogCount,
    totalWorkspaces,
    workspacesNoProfile,
    profilesEnergyUnset,
    dictionaryTagCount,
    untaggedCatalogSample,
  ] = await Promise.all([
    prisma.catalogItem.count({ where: catalogDiscoveryActiveWhere }),
    prisma.catalogItem.count({
      where: { AND: [{ taxonomyLinks: { some: {} } }, catalogDiscoveryActiveWhere] },
    }),
    prisma.workspace.count(),
    prisma.workspace.count({ where: { businessProfile: null } }),
    prisma.workspaceBusinessProfile.count({ where: { energyLevel: null } }),
    prisma.musicTaxonomyTag.count({ where: { status: "ACTIVE" } }),
    prisma.catalogItem.findMany({
      where: { AND: [{ taxonomyLinks: { none: {} } }, catalogDiscoveryActiveWhere] },
      select: { id: true, title: true, url: true, provider: true },
      orderBy: { updatedAt: "desc" },
      take: UNTAGGED_SAMPLE,
    }),
  ]);

  const untaggedCatalogCount = totalCatalog - taggedCatalogCount;

  const groupByLinks = await prisma.catalogItemTaxonomyTag.groupBy({
    by: ["taxonomyTagId"],
    _count: { _all: true },
  });

  const tagIdToCount = new Map(groupByLinks.map((g) => [g.taxonomyTagId, g._count._all]));
  const assignedTagIds = [...tagIdToCount.keys()];

  const tagMeta =
    assignedTagIds.length > 0
      ? await prisma.musicTaxonomyTag.findMany({
          where: { id: { in: assignedTagIds } },
          select: { id: true, slug: true, labelEn: true },
        })
      : [];

  const topAssigned = tagMeta
    .map((t) => ({
      slug: t.slug,
      labelEn: t.labelEn,
      count: tagIdToCount.get(t.id) ?? 0,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_TAGS);

  const dictionaryUnusedTags = await prisma.musicTaxonomyTag.findMany({
    where: { status: "ACTIVE", catalogLinks: { none: {} } },
    select: { slug: true, labelEn: true },
    orderBy: { slug: "asc" },
    take: LIST_CAP,
  });

  const dictionaryUnusedTotal = await prisma.musicTaxonomyTag.count({
    where: { status: "ACTIVE", catalogLinks: { none: {} } },
  });

  const fitTagRows = await prisma.musicTaxonomyTag.findMany({
    where: { slug: { in: fitRuleSlugs } },
    select: { id: true, slug: true },
  });
  const fitTagIdBySlug = new Map(fitTagRows.map((r) => [r.slug, r.id]));

  const fitRuleSlugsMissingInDictionary = fitRuleSlugs.filter((s) => !fitTagIdBySlug.has(s));

  const fitRulesWithZeroTaggedItems = fitRuleSlugs
    .filter((s) => fitTagIdBySlug.has(s))
    .filter((s) => {
      const id = fitTagIdBySlug.get(s)!;
      return (tagIdToCount.get(id) ?? 0) === 0;
    });

  const assignedSlugsSet = new Set(tagMeta.map((t) => t.slug));
  const tagsOnCatalogWithoutFitRule = [...assignedSlugsSet].filter((s) => !loadedFit.rulesBySlug.has(s)).sort();

  const workspaceNoProfileRows = await prisma.workspace.findMany({
    where: { businessProfile: null },
    select: { id: true, name: true, slug: true },
    orderBy: { name: "asc" },
    take: LIST_CAP,
  });

  const profileOtherCount = await prisma.workspaceBusinessProfile.count({
    where: { primaryBusinessType: "OTHER" },
  });

  const profileEnergyUnsetRows = await prisma.workspaceBusinessProfile.findMany({
    where: { energyLevel: null },
    select: {
      workspace: { select: { id: true, name: true, slug: true } },
    },
    orderBy: { workspace: { name: "asc" } },
    take: LIST_CAP,
  });

  const vibeHintsNeverOnCatalog: string[] = [];
  const slugRowsVibe = await prisma.musicTaxonomyTag.findMany({
    where: { slug: { in: [...vibeHintSlugs] } },
    select: { id: true, slug: true },
  });
  const vibeIdBySlug = new Map(slugRowsVibe.map((r) => [r.slug, r.id]));
  for (const s of vibeHintSlugs) {
    const id = vibeIdBySlug.get(s);
    if (!id) {
      vibeHintsNeverOnCatalog.push(s);
      continue;
    }
    if ((tagIdToCount.get(id) ?? 0) === 0) {
      vibeHintsNeverOnCatalog.push(s);
    }
  }
  vibeHintsNeverOnCatalog.sort();

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs uppercase tracking-wide text-neutral-500">
          <Link href="/admin/platform" className="text-sky-400 hover:underline">
            Platform
          </Link>
          <span className="text-neutral-600"> · </span>
          <Link href="/admin/platform/recommendation-preview" className="text-sky-400 hover:underline">
            Recommendation preview
          </Link>
          <span className="text-neutral-600"> · </span>
          Coverage
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-neutral-50">Recommendation coverage</h1>
        <p className="mt-2 max-w-3xl text-sm text-neutral-400">
          Stage 5.4 — diagnostics plus quick links to fix sparse preview inputs. Rules: taxonomy v{loadedFit.version}, vibe matrix v{vibeLoaded.version}. No customer-facing surface.
        </p>
      </div>

      <section className="rounded-lg border border-violet-900/40 bg-violet-950/25 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-violet-300">Next actions</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-neutral-300">
          <li>
            <span className="text-neutral-100">Tag more catalog items</span> — ranked preview depends on taxonomy links on catalog rows.
          </li>
          <li>
            <span className="text-neutral-100">Complete workspace profiles</span> — workspaces without a Business Profile fall back to generic defaults.
          </li>
          <li>
            <span className="text-neutral-100">Cover unused fit-rule tags</span> — dictionary tags referenced by{" "}
            <code className="text-xs text-neutral-400">fit-rules.json</code> need catalog assignments where you expect them to score.
          </li>
          <li>
            <span className="text-neutral-100">Cover business-daypart vibe hints</span> — slugs listed under vibe matrix coverage should appear on catalog items when you want vibe hints to bite.
          </li>
        </ul>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/admin/platform/catalog-tagging" className={btnSecondary}>
            Open Catalog tagging
          </Link>
          <Link href="/admin/platform/recommendation-preview" className={btnSecondary}>
            Open Recommendation preview
          </Link>
          <Link href="/admin/platform/music-taxonomy" className={btnSecondary}>
            Open Music taxonomy
          </Link>
        </div>
      </section>

      {/* Catalog readiness */}
      <section className="space-y-6">
        <h2 className="text-base font-semibold text-neutral-100">Catalog readiness</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card title="Catalog items (total)" value={String(totalCatalog)} hint="All rows in CatalogItem." />
          <Card
            title="With ≥1 taxonomy tag"
            value={String(taggedCatalogCount)}
            hint="Eligible for tag-based scoring in preview."
          />
          <Card
            title="With zero taxonomy tags"
            value={String(untaggedCatalogCount)}
            hint="Never appear in ranked preview until tagged."
          />
          <Card title="Music taxonomy tags (ACTIVE)" value={String(dictionaryTagCount)} hint="Platform dictionary size." />
        </div>

        <section>
          <h3 className="text-sm font-semibold text-neutral-300">Top assigned taxonomy tags</h3>
          <p className="mt-1 text-xs text-neutral-500">By CatalogItemTaxonomyTag link count (top {TOP_TAGS}).</p>
          <SimpleTable cols={["Slug", "Label", "Assignments"]} rows={topAssigned.map((t) => [t.slug, t.labelEn, String(t.count)])} />
        </section>

        <section>
          <h3 className="text-sm font-semibold text-neutral-300">
            Dictionary tags with no catalog assignments ({dictionaryUnusedTotal} total; listing first {LIST_CAP})
          </h3>
          <SimpleTable cols={["Slug", "Label"]} rows={dictionaryUnusedTags.map((t) => [t.slug, t.labelEn])} />
        </section>

        <section>
          <h3 className="text-sm font-semibold text-neutral-300">Untagged catalog sample (first {UNTAGGED_SAMPLE})</h3>
          <p className="mt-1 text-xs text-neutral-500">
            Recent CatalogItems with zero taxonomy tags — open tagging with one click.
          </p>
          <div className="mt-3 overflow-x-auto rounded border border-neutral-800">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="border-b border-neutral-800 bg-neutral-900/80 text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Title</th>
                  <th className="px-3 py-2 font-medium">Provider</th>
                  <th className="px-3 py-2 font-medium">URL</th>
                  <th className="px-3 py-2 font-medium">catalogItemId</th>
                  <th className="px-3 py-2 font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800">
                {untaggedCatalogSample.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-4 text-neutral-500">
                      Every catalog item has at least one taxonomy tag.
                    </td>
                  </tr>
                ) : (
                  untaggedCatalogSample.map((row) => (
                    <tr key={row.id} className="text-neutral-300">
                      <td className="max-w-[14rem] px-3 py-2 align-top text-neutral-100">{row.title}</td>
                      <td className="px-3 py-2 align-top text-neutral-400">{row.provider ?? "—"}</td>
                      <td className="max-w-[18rem] px-3 py-2 align-top">
                        <span className="block truncate font-mono text-[11px] text-neutral-500" title={row.url}>
                          {row.url}
                        </span>
                      </td>
                      <td className="px-3 py-2 align-top font-mono text-[11px] text-neutral-400">{row.id}</td>
                      <td className="whitespace-nowrap px-3 py-2 align-top">
                        <Link
                          href={`/admin/platform/catalog-tagging?catalogItemId=${encodeURIComponent(row.id)}`}
                          className="text-xs font-medium text-sky-400 hover:text-sky-300 hover:underline"
                        >
                          Tag this item
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </section>

      {/* Workspace readiness */}
      <section className="space-y-6">
        <h2 className="text-base font-semibold text-neutral-100">Workspace readiness</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Card title="Workspaces (total)" value={String(totalWorkspaces)} hint="Tenant workspaces." />
          <Card title="Workspaces · no Business Profile" value={String(workspacesNoProfile)} hint="Preview uses OTHER/unknown." />
        </div>

        <section className="rounded-lg border border-neutral-800 bg-neutral-900/30 p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">Workspace profile completeness</h3>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-neutral-300">
            <li>
              <span className="text-neutral-200">Energy level unset: </span>
              {profilesEnergyUnset} profile(s) with <code className="text-xs text-neutral-400">energyLevel</code> null (vibe/profile
              hints weaker).
            </li>
            <li>
              <span className="text-neutral-200">Primary business type OTHER: </span>
              {profileOtherCount} profile(s). The field always has a DB value; OTHER is the generic default — not an error by
              itself.
            </li>
          </ul>
        </section>

        {workspaceNoProfileRows.length > 0 ? (
          <section>
            <h3 className="text-sm font-semibold text-neutral-300">Workspaces without Business Profile (first {LIST_CAP})</h3>
            <div className="mt-3 overflow-x-auto rounded border border-neutral-800">
              <table className="w-full border-collapse text-left text-sm">
                <thead className="border-b border-neutral-800 bg-neutral-900/80 text-xs uppercase tracking-wide text-neutral-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Workspace</th>
                    <th className="px-3 py-2 font-medium">Slug</th>
                    <th className="px-3 py-2 font-medium">Id</th>
                    <th className="px-3 py-2 font-medium">Open workspace</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800">
                  {workspaceNoProfileRows.map((w) => (
                    <tr key={w.id} className="text-neutral-300">
                      <td className="px-3 py-2">{w.name}</td>
                      <td className="px-3 py-2">{w.slug}</td>
                      <td className="px-3 py-2 font-mono text-[11px] text-neutral-400">{w.id}</td>
                      <td className="px-3 py-2">
                        <Link
                          href={`/admin/platform/workspaces/${encodeURIComponent(w.id)}`}
                          className="text-xs font-medium text-sky-400 hover:text-sky-300 hover:underline"
                        >
                          Open workspace
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {profileEnergyUnsetRows.length > 0 ? (
          <section>
            <h3 className="text-sm font-semibold text-neutral-300">
              Profiles with energy level unset (first {LIST_CAP})
            </h3>
            <div className="mt-3 overflow-x-auto rounded border border-neutral-800">
              <table className="w-full border-collapse text-left text-sm">
                <thead className="border-b border-neutral-800 bg-neutral-900/80 text-xs uppercase tracking-wide text-neutral-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Workspace</th>
                    <th className="px-3 py-2 font-medium">Slug</th>
                    <th className="px-3 py-2 font-medium">Workspace id</th>
                    <th className="px-3 py-2 font-medium">Open workspace</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800">
                  {profileEnergyUnsetRows.map((p) => (
                    <tr key={p.workspace.id} className="text-neutral-300">
                      <td className="px-3 py-2">{p.workspace.name}</td>
                      <td className="px-3 py-2">{p.workspace.slug}</td>
                      <td className="px-3 py-2 font-mono text-[11px] text-neutral-400">{p.workspace.id}</td>
                      <td className="px-3 py-2">
                        <Link
                          href={`/admin/platform/workspaces/${encodeURIComponent(p.workspace.id)}`}
                          className="text-xs font-medium text-sky-400 hover:text-sky-300 hover:underline"
                        >
                          Open workspace
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </section>

      {/* Rules coverage */}
      <section className="space-y-6">
        <h2 className="text-base font-semibold text-neutral-100">Rules coverage</h2>

        <section className="rounded-lg border border-neutral-800 bg-neutral-900/30 p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">Fit rules vs catalog</h3>
          <p className="mt-2 text-sm text-neutral-400">
            Compared against <code className="text-xs">fit-rules.json</code> ({fitRuleSlugs.length} rule rows).
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-neutral-300">
            <li>
              Slugs in JSON missing from dictionary:{" "}
              <span className="font-mono text-amber-200">{fitRuleSlugsMissingInDictionary.length}</span>
              {fitRuleSlugsMissingInDictionary.length ? ` — ${fitRuleSlugsMissingInDictionary.slice(0, 40).join(", ")}` : ""}
            </li>
            <li>
              Rules whose slug exists in dictionary but has zero tagged catalog items:{" "}
              <span className="font-mono text-rose-200">{fitRulesWithZeroTaggedItems.length}</span>
              {fitRulesWithZeroTaggedItems.length ? (
                <span className="font-mono text-neutral-400"> — {fitRulesWithZeroTaggedItems.slice(0, 40).join(", ")}</span>
              ) : null}
            </li>
          </ul>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-neutral-300">
            Tags used on catalog items but not in fit-rules.json ({tagsOnCatalogWithoutFitRule.length})
          </h3>
          <p className="mt-1 text-xs text-neutral-500">
            Slugs that appear on at least one CatalogItem but have no taxonomy rule row — tag-level preview still scores other
            dimensions; these slugs never hit a dedicated rule row.
          </p>
          <div className="mt-2 max-h-48 overflow-y-auto rounded border border-neutral-800 bg-neutral-950/50 p-3 font-mono text-[11px] text-neutral-400">
            {tagsOnCatalogWithoutFitRule.length === 0 ? (
              <span className="text-neutral-600">Every assigned catalog tag slug has a fit-rules row.</span>
            ) : (
              tagsOnCatalogWithoutFitRule.slice(0, 200).join(", ")
            )}
          </div>
        </section>
      </section>

      {/* Vibe matrix coverage */}
      <section className="rounded-lg border border-neutral-800 bg-neutral-900/30 p-4">
        <h2 className="text-base font-semibold text-neutral-100">Vibe matrix coverage</h2>
        <p className="mt-2 text-xs text-neutral-500">
          Unique taxonomy slugs referenced in <code className="text-xs">business-daypart-vibe.json</code> hint arrays that have
          zero catalog assignments (dictionary may still define them).
        </p>
        <div className="mt-2 max-h-40 overflow-y-auto rounded border border-neutral-800 bg-neutral-950/50 p-3 font-mono text-[11px] text-violet-200/90">
          {vibeHintsNeverOnCatalog.length === 0 ? (
            <span className="text-neutral-600">None — every vibe hint slug appears on at least one catalog item.</span>
          ) : (
            vibeHintsNeverOnCatalog.join(", ")
          )}
        </div>
      </section>
    </div>
  );
}

function Card({ title, value, hint }: { title: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-4">
      <p className="text-xs uppercase tracking-wide text-neutral-500">{title}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-neutral-100">{value}</p>
      <p className="mt-1 text-[11px] text-neutral-500">{hint}</p>
    </div>
  );
}

function SimpleTable({
  cols,
  rows,
}: {
  cols: string[];
  rows: string[][];
}) {
  return (
    <div className="mt-3 overflow-x-auto rounded border border-neutral-800">
      <table className="w-full border-collapse text-left text-sm">
        <thead className="border-b border-neutral-800 bg-neutral-900/80 text-xs uppercase tracking-wide text-neutral-500">
          <tr>
            {cols.map((c) => (
              <th key={c} className="px-3 py-2 font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-800">
          {rows.map((r, i) => (
            <tr key={i} className="text-neutral-300">
              {r.map((cell, j) => (
                <td key={j} className="px-3 py-2">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
