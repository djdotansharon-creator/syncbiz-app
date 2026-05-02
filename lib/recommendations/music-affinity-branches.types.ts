/**
 * Music affinity branches — data-driven context → taxonomy hints (Stage intelligence layer).
 * Not wired into scoring or DJ Creator yet; validate bundles at load time only.
 */

import { z } from "zod";
import { isValidMusicTaxonomySlugFormat } from "@/lib/music-taxonomy-types";

const affinityEnergyBandSchema = z.enum(["LOW", "MEDIUM", "HIGH"]);

const preferredUrlTypeSchema = z.enum(["SINGLE", "SET_MIX", "EITHER"]);

function taxonomySlugArray(fieldLabel: string) {
  return z.array(z.string()).superRefine((slugs, ctx) => {
    slugs.forEach((s, i) => {
      if (!isValidMusicTaxonomySlugFormat(s)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${fieldLabel}[${i}]: invalid taxonomy slug format`,
          path: [i],
        });
      }
    });
  });
}

export const musicAffinityBranchSchema = z.object({
  id: z.string().min(1),
  labelHe: z.string().min(1),
  labelEn: z.string().min(1),
  isActive: z.boolean(),
  priority: z.number().finite(),
  triggerBusinessTags: taxonomySlugArray("triggerBusinessTags"),
  triggerDaypartTags: taxonomySlugArray("triggerDaypartTags"),
  triggerVibeTags: taxonomySlugArray("triggerVibeTags"),
  triggerEnergyMin: affinityEnergyBandSchema.nullable(),
  triggerEnergyMax: affinityEnergyBandSchema.nullable(),
  boostTagSlugs: taxonomySlugArray("boostTagSlugs"),
  avoidTagSlugs: taxonomySlugArray("avoidTagSlugs"),
  preferredUrlType: preferredUrlTypeSchema.nullable(),
  explainHuman: z.string().min(1),
  notes: z.string(),
});

export type MusicAffinityBranch = z.infer<typeof musicAffinityBranchSchema>;

export const musicAffinityBranchesBundleSchema = z.object({
  version: z.literal(1),
  taxonomySlugReference: z.string().optional(),
  branches: z.array(musicAffinityBranchSchema),
});

export type MusicAffinityBranchesBundle = z.infer<typeof musicAffinityBranchesBundleSchema>;

export function parseMusicAffinityBranchesBundle(raw: unknown): MusicAffinityBranchesBundle {
  return musicAffinityBranchesBundleSchema.parse(raw);
}
