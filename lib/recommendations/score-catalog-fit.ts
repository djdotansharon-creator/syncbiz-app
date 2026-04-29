import type { BusinessType, WorkspaceEnergyLevel } from "@prisma/client";
import type { BusinessTypeRuleValue, DaypartSlug, FitRuleRow } from "@/lib/recommendations/fit-rules.types";
import type { BusinessDaypartVibeRule } from "@/lib/recommendations/business-daypart-vibe.types";
import type { DaypartSegment } from "@/lib/recommendations/business-daypart-vibe.types";

/** Workspace slice needed for deterministic scoring (no Prisma imports in pure scorer inputs). */
export type WorkspaceFitContext = {
  primaryBusinessType: BusinessType;
  audienceDescriptors: string[];
  energyLevel: WorkspaceEnergyLevel | null;
  preferredStyleHints: string[];
  blockedStyleHints: string[];
  desiredMoodNotes: string | null;
  cuisineOrConcept: string | null;
  /** Optional overlay inputs for Stage 5.2 business-daypart vibe (no Prisma migration). */
  conceptTags?: string[];
  daypartPreferences?: unknown | null;
};

export type CatalogInputRow = {
  id: string;
  title: string;
  slugSet: ReadonlySet<string>;
};

/** Per-rule scoring transparency (one row per matched taxonomy rule slug). */
export type RuleContributionBreakdown = {
  taxonomyTagSlug: string;
  base: number;
  primaryBusinessBoost: number;
  daypartBoost: number;
  energyBoost: number;
  audienceBoost: number;
  moodBoost: number;
  subtotalBeforeAvoid: number;
  avoidMultiplierApplied: number | null;
  contributionAfterAvoid: number;
};

export type BusinessDaypartVibeTransparency = {
  label: string;
  deltaVibe: number;
  matchedPreferredHints: string[];
  matchedAvoidHints: string[];
  daypartPreferencesOverlay: "none" | "skipped" | "applied";
  keywordStrength: number;
  explainHuman: string;
};

export type CatalogFitScoreRow = {
  catalogItemId: string;
  title: string;
  /** Sum of taxonomy rule contributions only (Stage 5.1 tag matrix). */
  tagScore: number;
  /** Stage 5.2 contextual adjustment (may be 0). */
  vibeDelta: number;
  /** Tag score + vibe delta (preview ranking uses this). */
  score: number;
  matchedTags: string[];
  matchedRuleSlugs: string[];
  /** Workspace fields that actually participated in boosts for this item (deduped lines). */
  matchedProfileDimensions: string[];
  /** Base tag ↔ rule hits without implying workspace venue fit (genre/neutral narratives). */
  neutralHits: string[];
  /** Workspace-primary-business aligned explanations from JSON (`explainHuman`) — venue-fit lines only when gate matches. */
  businessFitExplanations: string[];
  /** Daypart / energy / audience / mood alignment notes from matched rules. */
  profileDimensionHits: string[];
  /** Back-compat: concatenation neutral + business fit + profile dimensions (non-penalty). */
  explainHuman: string[];
  penaltyReasons: string[];
  blockedReasons: string[];
  ruleBreakdown: RuleContributionBreakdown[];
  /** Present when a business × segment vibe rule matched the workspace primary type + segment lookup. */
  businessDaypartVibe: BusinessDaypartVibeTransparency | null;
};

const AVOID_MULTIPLIER = 0.22;

/** Catalog taxonomy slugs whose rule rows describe workspace venue fit (`restaurant` / `cafe` / `hotel` tags). */
const VENUE_BUSINESS_TAG_SLUGS = new Set(["restaurant", "cafe", "hotel"]);

/** When a venue-tag rule does not match workspace `primaryBusinessTypes`, replace `scoreBoost` with this small neutral base. */
const NEUTRAL_BASE_VENUE_BUSINESS_MISMATCH = 0.28;

function normToken(s: string): string {
  return s.trim().toLowerCase();
}

function audienceOverlap(profileDescriptors: string[], ruleHints: string[] | undefined): number {
  if (!ruleHints?.length || !profileDescriptors.length) return 0;
  const ruleSet = new Set(ruleHints.map(normToken));
  let n = 0;
  for (const d of profileDescriptors) {
    const t = normToken(d);
    if (t && ruleSet.has(t)) n++;
  }
  return n;
}

function moodOverlap(profile: WorkspaceFitContext, moodHints: string[] | undefined): number {
  if (!moodHints?.length) return 0;
  const haystackParts = [
    ...profile.preferredStyleHints,
    ...(profile.desiredMoodNotes ? [profile.desiredMoodNotes] : []),
    ...(profile.cuisineOrConcept ? [profile.cuisineOrConcept] : []),
  ];
  const hay = haystackParts.join(" ").toLowerCase();
  let n = 0;
  for (const hint of moodHints) {
    const h = normToken(hint);
    if (h.length >= 2 && hay.includes(h)) n++;
  }
  return n;
}

function substituteExplain(template: string, ctx: { businessType: string; daypart: DaypartSlug; tag: string }): string {
  return template
    .replace(/\{businessType\}/g, ctx.businessType)
    .replace(/\{daypart\}/g, ctx.daypart)
    .replace(/\{tag\}/g, ctx.tag);
}

function energyMatches(profileLevel: WorkspaceEnergyLevel | null, ruleLevels: FitRuleRow["energyFit"]): boolean {
  if (!ruleLevels?.length || !profileLevel) return false;
  return (ruleLevels as readonly string[]).includes(profileLevel);
}

function ruleAppliesToCatalog(slugInCatalog: string, rule: FitRuleRow): boolean {
  return rule.taxonomyTagSlug === slugInCatalog;
}

function workspaceMatchesPrimaryBusinessGate(rule: FitRuleRow, workspaceType: BusinessType): boolean {
  if (!rule.primaryBusinessTypes?.length) return false;
  return rule.primaryBusinessTypes.includes(workspaceType as BusinessTypeRuleValue);
}

function computeBaseContribution(rule: FitRuleRow, workspaceType: BusinessType): { base: number; usedVenueNeutral: boolean } {
  const boost = rule.scoreBoost ?? 1;
  const gated = Boolean(rule.primaryBusinessTypes?.length);
  if (!gated) return { base: boost, usedVenueNeutral: false };

  const wsMatch = workspaceMatchesPrimaryBusinessGate(rule, workspaceType);
  const venueSlug = VENUE_BUSINESS_TAG_SLUGS.has(rule.taxonomyTagSlug);
  if (venueSlug && !wsMatch) {
    return { base: NEUTRAL_BASE_VENUE_BUSINESS_MISMATCH, usedVenueNeutral: true };
  }
  return { base: boost, usedVenueNeutral: false };
}

function vibeLookupKey(primaryBusinessType: BusinessType, segment: DaypartSegment): string {
  return `${primaryBusinessType}\t${segment}`;
}

function clampScoreDelta(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Strength 0–1 when rule defines vibeKeywords — softer editorial curves when concepts align with workspace prose. */
function vibeKeywordStrength(keywords: string[], haystackLower: string): number {
  if (!keywords.length) return 1;
  let hits = 0;
  for (const k of keywords) {
    const t = normToken(k);
    if (t.length >= 2 && haystackLower.includes(t)) hits++;
  }
  const denom = Math.max(1, Math.ceil(keywords.length * 0.45));
  return Math.min(1, hits / denom);
}

function computeBusinessDaypartVibeOverlay(args: {
  vibeRule: BusinessDaypartVibeRule | undefined;
  catalogSlugSet: ReadonlySet<string>;
  profile: WorkspaceFitContext;
}): { vibeDelta: number; transparency: BusinessDaypartVibeTransparency | null } {
  const { vibeRule, catalogSlugSet, profile } = args;
  if (!vibeRule || vibeRule.businessType !== profile.primaryBusinessType) {
    return { vibeDelta: 0, transparency: null };
  }

  const sw = vibeRule.scoreWeight;

  const matchedPreferredHints = vibeRule.preferredTaxonomyHints.filter((s) => catalogSlugSet.has(s));
  const matchedAvoidHints = vibeRule.avoidTaxonomyHints.filter((s) => catalogSlugSet.has(s));

  let deltaBody = 0;
  for (const _slug of matchedPreferredHints) {
    deltaBody += Math.min(sw * 0.32, 0.085);
  }
  for (const _slug of matchedAvoidHints) {
    deltaBody -= Math.min(sw * 0.28, 0.065);
  }

  deltaBody = clampScoreDelta(deltaBody, -sw * 0.72, sw * 0.92);

  const proseHaystack = [
    ...(profile.conceptTags ?? []).join(" "),
    profile.cuisineOrConcept ?? "",
    profile.desiredMoodNotes ?? "",
    profile.preferredStyleHints.join(" "),
    profile.audienceDescriptors.join(" "),
  ]
    .join(" ")
    .toLowerCase();

  const keywordStrength = vibeKeywordStrength(vibeRule.vibeKeywords, proseHaystack);
  deltaBody *= keywordStrength;

  if (vibeRule.targetEnergy && profile.energyLevel === vibeRule.targetEnergy) {
    deltaBody += Math.min(0.045, sw * 0.18);
  }

  let daypartPreferencesOverlay: BusinessDaypartVibeTransparency["daypartPreferencesOverlay"] = "none";
  let overlayBonus = 0;
  const prefs = profile.daypartPreferences;
  if (prefs !== undefined && prefs !== null) {
    const prefsHay = JSON.stringify(prefs).toLowerCase();
    const overlayHits = vibeRule.vibeKeywords.filter((k) => prefsHay.includes(normToken(k))).length;
    if (overlayHits >= 1) {
      overlayBonus = Math.min(0.038, sw * 0.16);
      daypartPreferencesOverlay = "applied";
    } else {
      daypartPreferencesOverlay = "skipped";
    }
  }

  deltaBody += overlayBonus;
  deltaBody = clampScoreDelta(deltaBody, -sw, sw);

  const vibeDelta = Math.round(deltaBody * 10000) / 10000;

  const transparency: BusinessDaypartVibeTransparency = {
    label: vibeRule.label,
    deltaVibe: vibeDelta,
    matchedPreferredHints,
    matchedAvoidHints,
    daypartPreferencesOverlay,
    keywordStrength,
    explainHuman: vibeRule.explainHuman,
  };

  return { vibeDelta, transparency };
}

/** Defaults mirror {@link scoreCatalogItemFit} OTHER profile fallback (extended with vibe overlay fields). */
export function defaultWorkspaceFitContext(): WorkspaceFitContext {
  return {
    primaryBusinessType: "OTHER",
    audienceDescriptors: [],
    energyLevel: null,
    preferredStyleHints: [],
    blockedStyleHints: [],
    desiredMoodNotes: null,
    cuisineOrConcept: null,
    conceptTags: [],
    daypartPreferences: null,
  };
}

export type CatalogTagScoreRow = Omit<CatalogFitScoreRow, "score" | "vibeDelta" | "businessDaypartVibe"> & {
  tagScore: number;
};

/**
 * Deterministic score for one catalog row vs workspace + daypart.
 *
 * **Primary-business gate:** If `rule.primaryBusinessTypes` is non-empty:
 * - **+0.55** only when workspace `primaryBusinessType` is in that list.
 * - **`explainHuman`** from JSON is emitted only in that case (venue-fit copy never appears for mismatched workspaces).
 * - **Venue-tag rules** (`restaurant`, `cafe`, `hotel`): when the gate fails, base contribution uses {@link NEUTRAL_BASE_VENUE_BUSINESS_MISMATCH} instead of `scoreBoost`.
 *
 * Other boosts (daypart, energy, audience, mood) unchanged. **`avoidFor`** still applies to the full subtotal before multiplier.
 */
export function scoreCatalogItemFit(args: {
  profile: WorkspaceFitContext | null;
  daypart: DaypartSlug;
  rulesBySlug: ReadonlyMap<string, FitRuleRow>;
  catalog: CatalogInputRow;
}): CatalogTagScoreRow {
  const { profile, daypart, rulesBySlug, catalog } = args;
  const p: WorkspaceFitContext = profile ?? defaultWorkspaceFitContext();

  const matchedTags = [...catalog.slugSet].filter((slug) => rulesBySlug.has(slug));
  const matchedRuleSlugs: string[] = [];
  const neutralHits: string[] = [];
  const businessFitExplanations: string[] = [];
  const profileDimensionHits: string[] = [];
  const penaltyReasons: string[] = [];
  const blockedReasons: string[] = [];
  const ruleBreakdown: RuleContributionBreakdown[] = [];
  const matchedProfileDimensionsSet = new Set<string>();

  matchedProfileDimensionsSet.add(`Workspace primaryBusinessType: ${p.primaryBusinessType}`);
  matchedProfileDimensionsSet.add(`Selected daypart: ${daypart}`);
  if (p.energyLevel) matchedProfileDimensionsSet.add(`Workspace energyLevel: ${p.energyLevel}`);
  else matchedProfileDimensionsSet.add("Workspace energyLevel: (unset)");

  let total = 0;

  for (const slug of matchedTags) {
    const rule = rulesBySlug.get(slug);
    if (!rule || !ruleAppliesToCatalog(slug, rule)) continue;

    matchedRuleSlugs.push(rule.taxonomyTagSlug);

    const hasGate = Boolean(rule.primaryBusinessTypes?.length);
    const workspaceMatchesGate =
      hasGate && workspaceMatchesPrimaryBusinessGate(rule, p.primaryBusinessType);

    const { base, usedVenueNeutral } = computeBaseContribution(rule, p.primaryBusinessType);

    let contrib = base;

    let primaryBusinessBoost = 0;
    if (hasGate && workspaceMatchesGate) {
      primaryBusinessBoost = 0.55;
      contrib += primaryBusinessBoost;
    }

    let daypartBoost = 0;
    if (rule.daypartFit?.length && rule.daypartFit.includes(daypart)) {
      daypartBoost = 0.45;
      contrib += daypartBoost;
      profileDimensionHits.push(`Daypart “${daypart}” matched ${rule.taxonomyTagSlug}.daypartFit (+0.45).`);
    }

    let energyBoost = 0;
    if (rule.energyFit?.length && energyMatches(p.energyLevel, rule.energyFit)) {
      energyBoost = 0.35;
      contrib += energyBoost;
      profileDimensionHits.push(
        `Energy “${p.energyLevel}” matched ${rule.taxonomyTagSlug}.energyFit (+0.35).`,
      );
    }

    let audienceBoost = 0;
    const audN = audienceOverlap(p.audienceDescriptors, rule.audienceFit);
    if (audN > 0) {
      audienceBoost = Math.min(0.42, 0.14 * audN);
      contrib += audienceBoost;
      profileDimensionHits.push(
        `Audience descriptors overlapped ${rule.taxonomyTagSlug}.audienceFit (${audN} hit(s)) (+${audienceBoost.toFixed(3)}).`,
      );
    }

    let moodBoost = 0;
    const moodN = moodOverlap(p, rule.moodFit);
    if (moodN > 0) {
      moodBoost = Math.min(0.36, 0.12 * moodN);
      contrib += moodBoost;
      profileDimensionHits.push(`Mood/style overlap on ${rule.taxonomyTagSlug}.moodFit (+${moodBoost.toFixed(3)}).`);
    }

    const subtotalBeforeAvoid = contrib;

    const avoidHit = Boolean(
      rule.avoidFor?.length && rule.avoidFor.includes(p.primaryBusinessType as BusinessTypeRuleValue),
    );

    let contributionAfterAvoid = subtotalBeforeAvoid;
    let avoidMultiplierApplied: number | null = null;

    if (avoidHit) {
      avoidMultiplierApplied = AVOID_MULTIPLIER;
      const before = subtotalBeforeAvoid;
      contributionAfterAvoid = before * AVOID_MULTIPLIER;
      const baseMsg = rule.explainHuman
        ? substituteExplain(rule.explainHuman, {
            businessType: p.primaryBusinessType,
            daypart,
            tag: rule.taxonomyTagSlug,
          })
        : `Rule “${rule.taxonomyTagSlug}” is flagged to avoid primary business type ${p.primaryBusinessType}.`;
      penaltyReasons.push(
        `${baseMsg} (avoidFor: score contribution ${before.toFixed(3)} → ${contributionAfterAvoid.toFixed(3)} × ${AVOID_MULTIPLIER}).`,
      );
      blockedReasons.push(
        `Strong mismatch: workspace type ${p.primaryBusinessType} is listed in avoidFor for tag “${rule.taxonomyTagSlug}”.`,
      );
    } else {
      if (hasGate && workspaceMatchesGate && rule.explainHuman) {
        businessFitExplanations.push(
          substituteExplain(rule.explainHuman, {
            businessType: p.primaryBusinessType,
            daypart,
            tag: rule.taxonomyTagSlug,
          }),
        );
      } else if (hasGate && !workspaceMatchesGate) {
        neutralHits.push(
          `Rule “${rule.taxonomyTagSlug}”: catalog tag matched — base ${base.toFixed(3)}${usedVenueNeutral ? " (venue-tag neutral base)" : ""}; workspace primaryBusinessType ${p.primaryBusinessType} not in rule.primaryBusinessTypes (+0.55 affinity skipped). JSON caption omitted where it implies workspace venue fit.`,
        );
      } else if (!hasGate && rule.explainHuman) {
        neutralHits.push(
          substituteExplain(rule.explainHuman, {
            businessType: p.primaryBusinessType,
            daypart,
            tag: rule.taxonomyTagSlug,
          }),
        );
      }
    }

    total += contributionAfterAvoid;

    ruleBreakdown.push({
      taxonomyTagSlug: rule.taxonomyTagSlug,
      base,
      primaryBusinessBoost,
      daypartBoost,
      energyBoost,
      audienceBoost,
      moodBoost,
      subtotalBeforeAvoid,
      avoidMultiplierApplied,
      contributionAfterAvoid,
    });
  }

  const tagScore = Math.round(total * 10000) / 10000;

  const matchedProfileDimensions = [...matchedProfileDimensionsSet];

  const explainHuman = [...new Set([...neutralHits, ...businessFitExplanations, ...profileDimensionHits])];

  return {
    catalogItemId: catalog.id,
    title: catalog.title,
    tagScore,
    matchedTags,
    matchedRuleSlugs,
    matchedProfileDimensions,
    neutralHits: [...new Set(neutralHits)],
    businessFitExplanations: [...new Set(businessFitExplanations)],
    profileDimensionHits: [...new Set(profileDimensionHits)],
    explainHuman,
    penaltyReasons,
    blockedReasons,
    ruleBreakdown,
  };
}

export function rankCatalogItemsByFit(args: {
  profile: WorkspaceFitContext | null;
  daypart: DaypartSlug;
  rulesBySlug: ReadonlyMap<string, FitRuleRow>;
  catalogRows: CatalogInputRow[];
  limit: number;
  vibeRulesByKey: ReadonlyMap<string, BusinessDaypartVibeRule>;
  daypartSegment: DaypartSegment;
}): CatalogFitScoreRow[] {
  const { catalogRows, limit, profile, daypart, rulesBySlug, vibeRulesByKey, daypartSegment } = args;
  const profileEffective = profile ?? defaultWorkspaceFitContext();

  const scored = catalogRows.map((catalog) => {
    const tagRow = scoreCatalogItemFit({
      profile: profileEffective,
      daypart,
      rulesBySlug,
      catalog,
    });

    const vibeRule = vibeRulesByKey.get(vibeLookupKey(profileEffective.primaryBusinessType, daypartSegment));

    const { vibeDelta, transparency } = computeBusinessDaypartVibeOverlay({
      vibeRule,
      catalogSlugSet: catalog.slugSet,
      profile: profileEffective,
    });

    const score = Math.round((tagRow.tagScore + vibeDelta) * 10000) / 10000;

    return {
      ...tagRow,
      vibeDelta,
      score,
      businessDaypartVibe: transparency,
      matchedProfileDimensions: [
        ...tagRow.matchedProfileDimensions,
        `Daypart segment (vibe matrix): ${daypartSegment}`,
      ],
    };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.title.localeCompare(b.title);
  });
  return scored.slice(0, Math.max(0, limit));
}
