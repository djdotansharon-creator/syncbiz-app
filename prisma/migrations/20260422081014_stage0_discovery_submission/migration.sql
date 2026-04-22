-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'DEPRECATED', 'MERGED', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "SubmissionSource" AS ENUM ('USER', 'AI_AGENT', 'INTERNET_SEARCH', 'IMPORT');

-- CreateTable
CREATE TABLE "DiscoverySubmission" (
    "id" TEXT NOT NULL,
    "submittedById" TEXT,
    "submissionSource" "SubmissionSource" NOT NULL,
    "rawUrl" TEXT NOT NULL,
    "resolvedProvider" TEXT,
    "resolvedExternalId" TEXT,
    "resolvedMetadata" JSONB,
    "suggestedTags" TEXT[],
    "suggestedTitle" TEXT,
    "submitterNote" TEXT,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "mergedIntoId" TEXT,
    "duplicateOfId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscoverySubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DiscoverySubmission_status_idx" ON "DiscoverySubmission"("status");

-- CreateIndex
CREATE INDEX "DiscoverySubmission_submittedById_idx" ON "DiscoverySubmission"("submittedById");

-- CreateIndex
CREATE INDEX "DiscoverySubmission_submissionSource_idx" ON "DiscoverySubmission"("submissionSource");

-- CreateIndex
CREATE INDEX "DiscoverySubmission_createdAt_idx" ON "DiscoverySubmission"("createdAt");
