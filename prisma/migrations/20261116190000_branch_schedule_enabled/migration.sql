-- Branch.scheduleEnabled: the branch's schedule is on / off (owner 2026-11-16: "the schedule of THIS player is active or not"). Additive: every branch keeps running its schedule (default true).
ALTER TABLE "Branch" ADD COLUMN "scheduleEnabled" BOOLEAN NOT NULL DEFAULT true;
