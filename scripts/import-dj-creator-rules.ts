/**
 * Import DJ Creator rules workbook → lib/recommendations/dj-creator-rules.generated.json
 *
 * Source: data/dj-creator-rules/syncbiz_dj_creator_rules_stage6.xlsx
 * Sheets: DJ_Creator_Rules, Lookups, Taxonomy_Candidates (review only — row count only)
 *
 * Usage: npm run dj-creator:import-rules
 *
 * Taxonomy slug allowlist: prisma/seed-data/music-taxonomy.generated.json (ACTIVE slugs only)
 */

import * as fs from "fs";
import * as path from "path";
import type {
  DjCreatorLookupsSnapshot,
  DjCreatorRuleRow,
  DjCreatorRulesBundle,
  DjCreatorWizardLanguageOption,
  DjCreatorWizardStyleOption,
} from "../lib/recommendations/dj-creator-rules.types";

function normHeader(cell: unknown): string {
  return String(cell ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function pick(row: Record<string, unknown>, aliases: string[]): string {
  const keys = Object.keys(row);
  for (const a of aliases) {
    const na = normHeader(a);
    const hit = keys.find((k) => normHeader(k) === na);
    if (hit !== undefined && row[hit] !== undefined && row[hit] !== "") {
      return String(row[hit]).trim();
    }
  }
  return "";
}

function parseBool(raw: string, rowLabel: string): boolean {
  const s = raw.trim().toUpperCase();
  if (s === "TRUE" || s === "1" || s === "YES") return true;
  if (s === "FALSE" || s === "0" || s === "NO") return false;
  console.error(`[dj-creator-rules] isActive must be TRUE/FALSE (got "${raw}") ${rowLabel}`);
  process.exit(1);
}

function parseListCell(cell: string): string[] {
  if (!cell.trim()) return [];
  return cell
    .split(/[,;]/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseWizardLineSegment(seg: string): DjCreatorWizardStyleOption | null {
  const s = seg.trim();
  if (!s) return null;
  const parts = s.split("|").map((p) => p.trim());
  if (parts.length === 1) {
    const id = parts[0];
    return { id, label: id, labelHe: id, query: id };
  }
  if (parts.length === 2) {
    const [id, query] = parts;
    return { id, label: id, labelHe: id, query };
  }
  if (parts.length === 3) {
    const [id, label, query] = parts;
    return { id, label, labelHe: label, query };
  }
  const [id, label, labelHe, query] = parts;
  return { id, label, labelHe, query: query ?? "" };
}

function parseStyleOptions(raw: string): DjCreatorWizardStyleOption[] {
  const t = raw.trim();
  if (!t) return [];
  if (t.startsWith("[")) {
    try {
      const parsed = JSON.parse(t) as unknown;
      if (!Array.isArray(parsed)) {
        console.error("[dj-creator-rules] styleOptionsForWizard JSON must be an array");
        process.exit(1);
      }
      const out: DjCreatorWizardStyleOption[] = [];
      for (const item of parsed) {
        if (!item || typeof item !== "object") continue;
        const o = item as Record<string, unknown>;
        const id = String(o.id ?? "").trim();
        if (!id) continue;
        out.push({
          id,
          label: String(o.label ?? o.labelEn ?? id).trim() || id,
          labelHe: String(o.labelHe ?? o.label ?? id).trim() || id,
          query: String(o.query ?? "").trim(),
        });
      }
      return out;
    } catch (e) {
      console.error("[dj-creator-rules] styleOptionsForWizard invalid JSON", e);
      process.exit(1);
    }
  }
  return t
    .split(";")
    .map((seg) => parseWizardLineSegment(seg))
    .filter((x): x is DjCreatorWizardStyleOption => x != null);
}

function parseLanguageOptions(raw: string): DjCreatorWizardLanguageOption[] {
  const t = raw.trim();
  if (!t) return [];
  if (t.startsWith("[")) {
    try {
      const parsed = JSON.parse(t) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.map((item) => {
        const o = (item ?? {}) as Record<string, unknown>;
        const id = String(o.id ?? "").trim() || "opt";
        return {
          id,
          label: String(o.label ?? id).trim(),
          labelHe: String(o.labelHe ?? o.label ?? id).trim(),
          query: String(o.query ?? "").trim(),
        };
      });
    } catch {
      return [];
    }
  }
  return t
    .split(";")
    .map((seg) => {
      const o = parseWizardLineSegment(seg);
      if (!o) return null;
      return { id: o.id, label: o.label, labelHe: o.labelHe, query: o.query };
    })
    .filter((x): x is DjCreatorWizardLanguageOption => x != null);
}

type TaxonomySeedRow = { slug: string; status?: string };

function loadTaxonomyAllowlist(cwd: string): Set<string> {
  const p = path.join(cwd, "prisma", "seed-data", "music-taxonomy.generated.json");
  if (!fs.existsSync(p)) {
    console.error(`[dj-creator-rules] Taxonomy allowlist not found: ${p}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(p, "utf8");
  const rows = JSON.parse(raw) as TaxonomySeedRow[];
  const set = new Set<string>();
  for (const row of rows) {
    const slug = String(row.slug ?? "").trim();
    if (!slug) continue;
    const st = String(row.status ?? "ACTIVE").toUpperCase();
    if (st === "ACTIVE") set.add(slug);
  }
  return set;
}

function validateSlugs(
  label: string,
  rowTag: string,
  slugs: string[],
  allow: Set<string>,
): void {
  for (const s of slugs) {
    if (!allow.has(s)) {
      console.error(
        `[dj-creator-rules] Unknown taxonomy slug "${s}" in ${label} (${rowTag}) — not in ACTIVE music-taxonomy.generated.json`,
      );
      process.exit(1);
    }
  }
}

/** Keys normalized to camelCase dimension names */
function loadLookups(rows: Record<string, unknown>[]): DjCreatorLookupsSnapshot {
  const buckets: Record<string, Set<string>> = {
    businessType: new Set(),
    daypart: new Set(),
    vibe: new Set(),
    energy: new Set(),
    audience: new Set(),
  };

  const dimAlias: Record<string, keyof DjCreatorLookupsSnapshot> = {
    businesstype: "businessType",
    business: "businessType",
    venue: "businessType",
    daypart: "daypart",
    timeofday: "daypart",
    vibe: "vibe",
    mood: "vibe",
    energy: "energy",
    audience: "audience",
  };

  for (const raw of rows) {
    const lookupType = pick(raw, ["lookuptype"]);
    const keyCell = pick(raw, ["key"]);
    if (lookupType && keyCell) {
      const normDim = lookupType.toLowerCase().replace(/\s+/g, "");
      const bucketKey = dimAlias[normDim];
      if (bucketKey) buckets[bucketKey].add(keyCell.trim().toLowerCase());
      continue;
    }

    const dimRaw = pick(raw, ["dimension", "domain", "category", "field", "type"]).toLowerCase();
    const value = pick(raw, ["value", "allowedvalue", "allowed", "slug", "code"]);
    const normDim = dimRaw.replace(/\s+/g, "");
    const bucketKey = dimAlias[normDim];
    if (!bucketKey || !value) continue;
    buckets[bucketKey].add(value.trim().toLowerCase());
  }

  const toArr = (s: Set<string>) => [...s].sort();

  return {
    businessType: toArr(buckets.businessType),
    daypart: toArr(buckets.daypart),
    vibe: toArr(buckets.vibe),
    energy: toArr(buckets.energy),
    audience: toArr(buckets.audience),
  };
}

function lookupContains(lookups: DjCreatorLookupsSnapshot, field: keyof DjCreatorLookupsSnapshot, val: string): boolean {
  const v = val.trim().toLowerCase();
  if (!v || v === "*" || v === "any") return true;
  const list = lookups[field];
  if (list.length === 0) return true;
  return list.includes(v);
}

function main(): void {
  const XLSX = require("xlsx") as typeof import("xlsx");
  const cwd = process.cwd();
  const inputPath = path.join(cwd, "data", "dj-creator-rules", "syncbiz_dj_creator_rules_stage6.xlsx");

  if (!fs.existsSync(inputPath)) {
    console.error(`[dj-creator-rules] File not found:\n  ${inputPath}\nPlace syncbiz_dj_creator_rules_stage6.xlsx there, then re-run.`);
    process.exit(1);
  }

  const taxonomyAllow = loadTaxonomyAllowlist(cwd);
  const wb = XLSX.readFile(inputPath, { cellDates: false });

  const rulesSheetName = wb.SheetNames.find((n) => n.trim() === "DJ_Creator_Rules");
  const lookupsSheetName = wb.SheetNames.find((n) => n.trim() === "Lookups");
  const candidatesSheetName = wb.SheetNames.find((n) => n.trim() === "Taxonomy_Candidates");

  if (!rulesSheetName || !lookupsSheetName) {
    console.error("[dj-creator-rules] Workbook must contain sheets: DJ_Creator_Rules, Lookups");
    process.exit(1);
  }

  const lookupsRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[lookupsSheetName], {
    defval: "",
    raw: false,
  });
  const lookups = loadLookups(lookupsRows);

  let taxonomyCandidatesRowCount = 0;
  if (candidatesSheetName) {
    const cand = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[candidatesSheetName], {
      defval: "",
      raw: false,
    });
    taxonomyCandidatesRowCount = cand.filter((row) =>
      Object.values(row).some((v) => String(v ?? "").trim() !== ""),
    ).length;
    console.info(`[dj-creator-rules] Taxonomy_Candidates review rows: ${taxonomyCandidatesRowCount} (not imported)`);
  }

  const ruleRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[rulesSheetName], {
    defval: "",
    raw: false,
  });

  const seenIds = new Set<string>();
  const rules: DjCreatorRuleRow[] = [];
  let line = 0;

  for (const raw of ruleRows) {
    line += 1;
    const ruleId = pick(raw, ["ruleId", "rule_id", "Rule ID"]);
    if (!ruleId) continue;

    if (seenIds.has(ruleId)) {
      console.error(`[dj-creator-rules] Duplicate ruleId: ${ruleId}`);
      process.exit(1);
    }
    seenIds.add(ruleId);

    const isActiveRaw = pick(raw, ["isActive", "is_active", "active"]);
    if (!isActiveRaw) {
      console.error(`[dj-creator-rules] isActive required (rule ${ruleId})`);
      process.exit(1);
    }
    const isActive = parseBool(isActiveRaw, `ruleId=${ruleId}`);

    const priorityRaw = pick(raw, ["priority"]);
    const priority = Number(priorityRaw);
    if (!Number.isFinite(priority)) {
      console.error(`[dj-creator-rules] priority must be numeric (rule ${ruleId})`);
      process.exit(1);
    }

    const businessType = pick(raw, ["businessType", "business_type"]);
    const daypart = pick(raw, ["daypart"]);
    const vibe = pick(raw, ["vibe"]);
    const energy = pick(raw, ["energy"]);
    const audience = pick(raw, ["audience"]);

    for (const [k, v] of [
      ["businessType", businessType],
      ["daypart", daypart],
      ["vibe", vibe],
      ["energy", energy],
      ["audience", audience],
    ] as const) {
      if (!lookupContains(lookups, k, v)) {
        console.error(
          `[dj-creator-rules] rule ${ruleId}: ${k}="${v}" not in Lookups sheet (use * for any)`,
        );
        process.exit(1);
      }
    }

    const styleQuestionHe = pick(raw, ["styleQuestionHe", "style_question_he"]);
    const styleOptionsForWizard = parseStyleOptions(pick(raw, ["styleOptionsForWizard", "style_options_for_wizard"]));
    const styleSlugHints = parseListCell(pick(raw, ["styleSlugHints", "style_slug_hints"]));
    const avoidStyleSlugs = parseListCell(pick(raw, ["avoidStyleSlugs", "avoid_style_slugs"]));
    const defaultStyleSlugs = parseListCell(pick(raw, ["defaultStyleSlugs", "default_style_slugs"]));
    const languageOptions = parseLanguageOptions(pick(raw, ["languageOptions", "language_options"]));

    const resultRaw = pick(raw, ["resultCountDefault", "result_count_default"]);
    let resultCountDefault: number | null = null;
    if (resultRaw.trim()) {
      const n = Number(resultRaw);
      if (!Number.isFinite(n)) {
        console.error(`[dj-creator-rules] resultCountDefault invalid (rule ${ruleId})`);
        process.exit(1);
      }
      resultCountDefault = Math.floor(n);
    }

    const explanationHe = pick(raw, ["explanationHe", "explanation_he"]);
    const notes = pick(raw, ["notes"]);

    validateSlugs("styleSlugHints", ruleId, styleSlugHints, taxonomyAllow);
    validateSlugs("avoidStyleSlugs", ruleId, avoidStyleSlugs, taxonomyAllow);
    validateSlugs("defaultStyleSlugs", ruleId, defaultStyleSlugs, taxonomyAllow);

    rules.push({
      ruleId,
      isActive,
      priority,
      businessType,
      daypart,
      vibe,
      energy,
      audience,
      styleQuestionHe,
      styleOptionsForWizard,
      styleSlugHints,
      avoidStyleSlugs,
      defaultStyleSlugs,
      languageOptions,
      resultCountDefault,
      explanationHe,
      notes,
    });
  }

  const bundle: DjCreatorRulesBundle = {
    version: 1,
    generatedAt: new Date().toISOString(),
    sourceFile: path.relative(cwd, inputPath).replace(/\\/g, "/"),
    taxonomyAllowlistPath: "prisma/seed-data/music-taxonomy.generated.json",
    lookups,
    rules,
    taxonomyCandidatesRowCount,
  };

  const outPath = path.join(cwd, "lib", "recommendations", "dj-creator-rules.generated.json");
  fs.writeFileSync(outPath, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
  console.info(`[dj-creator-rules] Wrote ${rules.filter((r) => r.isActive).length} active / ${rules.length} rules → ${outPath}`);
}

main();
