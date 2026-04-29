import rawFitRules from "@/lib/recommendations/fit-rules.json";
import {
  fitRulesDocumentSchema,
  type FitRuleRow,
  type FitRulesDocument,
} from "@/lib/recommendations/fit-rules.types";

export type LoadedFitRules = {
  version: number;
  /** Last rule wins when duplicate `taxonomyTagSlug` entries appear after validation. */
  rulesBySlug: Map<string, FitRuleRow>;
};

/**
 * Parses embedded JSON and validates with Zod. Throws on invalid documents (fail fast at startup / first request).
 */
export function loadValidatedFitRules(): LoadedFitRules {
  const parsed = fitRulesDocumentSchema.parse(rawFitRules as FitRulesDocument);
  const rulesBySlug = new Map<string, FitRuleRow>();
  for (const row of parsed.rules) {
    rulesBySlug.set(row.taxonomyTagSlug, row);
  }
  return { version: parsed.version, rulesBySlug };
}
