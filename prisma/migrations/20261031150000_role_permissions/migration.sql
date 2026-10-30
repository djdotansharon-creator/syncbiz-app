-- The Discord-style permission list of a role (owner 2026-10-31). Additive: one new column with a default, nothing else changes; every existing role keeps working ({} = the defaults of its name).
ALTER TABLE "WorkspaceRole" ADD COLUMN "permissions" JSONB NOT NULL DEFAULT '{}';
