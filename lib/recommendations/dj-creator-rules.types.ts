/**
 * Types for DJ Creator rules bundle (Excel → import script → generated JSON).
 * Runtime loads JSON only — never the workbook.
 */

export type DjCreatorWizardStyleOption = {
  id: string;
  label: string;
  labelHe: string;
  /** Free-text/catalog query fragment; empty = “auto / let JONNY choose”. */
  query: string;
};

export type DjCreatorWizardLanguageOption = {
  id: string;
  label: string;
  labelHe: string;
  query: string;
};

export type DjCreatorRuleRow = {
  ruleId: string;
  isActive: boolean;
  priority: number;
  /** Empty string or "*" = match any */
  businessType: string;
  daypart: string;
  vibe: string;
  energy: string;
  audience: string;
  styleQuestionHe: string;
  styleOptionsForWizard: DjCreatorWizardStyleOption[];
  styleSlugHints: string[];
  avoidStyleSlugs: string[];
  defaultStyleSlugs: string[];
  languageOptions: DjCreatorWizardLanguageOption[];
  resultCountDefault: number | null;
  explanationHe: string;
  notes: string;
};

export type DjCreatorLookupsSnapshot = {
  businessType: string[];
  daypart: string[];
  vibe: string[];
  energy: string[];
  audience: string[];
};

export type DjCreatorRulesBundle = {
  version: 1;
  generatedAt: string;
  sourceFile: string;
  taxonomyAllowlistPath: string;
  lookups: DjCreatorLookupsSnapshot;
  rules: DjCreatorRuleRow[];
  /** Row count only — Taxonomy_Candidates never alter taxonomy or rules. */
  taxonomyCandidatesRowCount: number;
};

export type DjCreatorMatchContext = {
  businessType: string;
  daypart: string;
  vibe: string;
  energy?: string;
  audience?: string;
};
