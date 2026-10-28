-- Device enrollment: a Player that asks for a branch that does not exist yet also says its address and brand (owner 2026-10-28).
-- ADDITIVE only: two text columns with an empty default on the table created by the earlier migrations. Nothing that exists is changed.
ALTER TABLE "DeviceEnrollment"
  ADD COLUMN "requestedBranchAddress" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "requestedBrandName" TEXT NOT NULL DEFAULT '';
