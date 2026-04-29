import raw from "@/lib/recommendations/business-daypart-vibe.json";
import {
  businessDaypartVibeDocumentSchema,
  type BusinessDaypartVibeDocument,
  type BusinessDaypartVibeRule,
} from "@/lib/recommendations/business-daypart-vibe.types";

export type LoadedBusinessDaypartVibeRules = {
  version: number;
  /** Key `${businessType}\t${daypartSegment}` — last wins on duplicates. */
  rulesByKey: Map<string, BusinessDaypartVibeRule>;
};

export function vibeRuleKey(rule: Pick<BusinessDaypartVibeRule, "businessType" | "daypartSegment">): string {
  return `${rule.businessType}\t${rule.daypartSegment}`;
}

export function loadBusinessDaypartVibeRules(): LoadedBusinessDaypartVibeRules {
  const parsed = businessDaypartVibeDocumentSchema.parse(raw as BusinessDaypartVibeDocument);
  const rulesByKey = new Map<string, BusinessDaypartVibeRule>();
  for (const row of parsed.rules) {
    rulesByKey.set(vibeRuleKey(row), row);
  }
  return { version: parsed.version, rulesByKey };
}
