-- CreateEnum
CREATE TYPE "WorkspaceEnergyLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateTable
CREATE TABLE "WorkspaceBusinessProfile" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "primaryBusinessType" "BusinessType" NOT NULL DEFAULT 'OTHER',
    "cuisineOrConcept" TEXT,
    "conceptTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "countryCode" TEXT,
    "cultureNotes" TEXT,
    "primaryLanguage" TEXT,
    "additionalLanguages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "audienceDescriptors" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "desiredMoodNotes" TEXT,
    "energyLevel" "WorkspaceEnergyLevel",
    "openingHoursSummary" TEXT,
    "openingHoursStructured" JSONB,
    "daypartPreferences" JSONB,
    "preferredStyleHints" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "blockedStyleHints" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "adminNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceBusinessProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceBusinessProfile_workspaceId_key" ON "WorkspaceBusinessProfile"("workspaceId");

-- AddForeignKey
ALTER TABLE "WorkspaceBusinessProfile" ADD CONSTRAINT "WorkspaceBusinessProfile_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
