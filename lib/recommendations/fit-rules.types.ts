import { z } from "zod";

/** Prisma `BusinessType` values as strings in JSON rules. */
export const businessTypeRuleValueSchema = z.enum([
  "RESTAURANT",
  "GYM",
  "HOTEL",
  "BAR",
  "CAFE",
  "RETAIL",
  "OFFICE",
  "OTHER",
]);

export type BusinessTypeRuleValue = z.infer<typeof businessTypeRuleValueSchema>;

export const energyRuleValueSchema = z.enum(["LOW", "MEDIUM", "HIGH"]);

export type EnergyRuleValue = z.infer<typeof energyRuleValueSchema>;

/** Daypart selector (must align with `MusicTaxonomyTag.slug` for daypart rows). */
export const daypartSlugSchema = z.enum(["morning", "lunch", "dinner", "night"]);

export type DaypartSlug = z.infer<typeof daypartSlugSchema>;

export const DAYPART_SLUGS: readonly DaypartSlug[] = [
  "morning",
  "lunch",
  "dinner",
  "night",
] as const;

const stringList = z.array(z.string()).optional();

export const fitRuleRowSchema = z.object({
  taxonomyTagSlug: z.string().min(1),
  primaryBusinessTypes: z.array(businessTypeRuleValueSchema).optional(),
  businessFitNotes: stringList,
  audienceFit: stringList,
  daypartFit: z.array(daypartSlugSchema).optional(),
  energyFit: z.array(energyRuleValueSchema).optional(),
  moodFit: stringList,
  avoidFor: z.array(businessTypeRuleValueSchema).optional(),
  scoreBoost: z.number().finite().optional(),
  explainHuman: z.string().optional(),
  explainAi: z.string().optional(),
});

export type FitRuleRow = z.infer<typeof fitRuleRowSchema>;

export const fitRulesDocumentSchema = z.object({
  version: z.number().int().min(1),
  rules: z.array(fitRuleRowSchema).min(1),
});

export type FitRulesDocument = z.infer<typeof fitRulesDocumentSchema>;
