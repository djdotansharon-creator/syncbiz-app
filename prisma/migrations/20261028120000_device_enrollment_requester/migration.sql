-- Device enrollment: who is asking, and the branch name the device typed (owner 2026-10-28).
-- ADDITIVE only: five text columns with an empty default on the table the previous migration created. Nothing that exists is changed.
ALTER TABLE "DeviceEnrollment"
  ADD COLUMN "requestedBranchName" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "requesterFirstName" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "requesterLastName" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "requesterPhone" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "requesterEmail" TEXT NOT NULL DEFAULT '';
