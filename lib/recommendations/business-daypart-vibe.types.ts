import { z } from "zod";
import { businessTypeRuleValueSchema } from "@/lib/recommendations/fit-rules.types";

export const targetEnergySchema = z.enum(["LOW", "MEDIUM", "HIGH"]);

export type TargetEnergy = z.infer<typeof targetEnergySchema>;

/** Fine-grained segment keys for business × vibe matrix (preview maps coarse daypart → segment). */
export const daypartSegmentSchema = z.enum([
  "morning",
  "lunch",
  "afternoon",
  "evening",
  "dinner",
  "night",
  "early_evening",
  "after_hours",
]);

export type DaypartSegment = z.infer<typeof daypartSegmentSchema>;

export const businessDaypartVibeRuleSchema = z.object({
  businessType: businessTypeRuleValueSchema,
  daypartSegment: daypartSegmentSchema,
  label: z.string().min(1),
  targetEnergy: targetEnergySchema.nullable(),
  preferredTaxonomyHints: z.array(z.string()),
  avoidTaxonomyHints: z.array(z.string()),
  vibeKeywords: z.array(z.string()),
  explainHuman: z.string(),
  scoreWeight: z.number().finite().positive(),
  explainAi: z.string().nullable().optional(),
});

export type BusinessDaypartVibeRule = z.infer<typeof businessDaypartVibeRuleSchema>;

export const businessDaypartVibeDocumentSchema = z.object({
  version: z.number().int().min(1),
  rules: z.array(businessDaypartVibeRuleSchema).min(1),
});

export type BusinessDaypartVibeDocument = z.infer<typeof businessDaypartVibeDocumentSchema>;
