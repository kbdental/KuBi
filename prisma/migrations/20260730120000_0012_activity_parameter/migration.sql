-- The 16 control parameters become a first-class column on activity
-- definitions. Until now the only classification an activity carried was
-- `process`, which is the workflow it sits in — not the kind of control it is.
-- The owner's dashboard rolls up by parameter, so it has to be stored, not
-- guessed from the code prefix at read time.

-- Added nullable so existing rows survive the ALTER, backfilled, then made NOT
-- NULL. An activity with no parameter would be invisible to every score, which
-- is the worst possible failure for a column whose job is "nothing uncounted".
ALTER TABLE "activity_definitions" ADD COLUMN "parameter" TEXT;

-- FORCE ROW LEVEL SECURITY applies to the table OWNER too, which is the whole
-- point of it — no role may escape tenancy by owning a table. The consequence
-- for migrations is easy to miss and fails silently: a data-backfill UPDATE run
-- by kubi_migrator matches ZERO rows, the statement reports success, and the
-- migration only blows up later at SET NOT NULL.
--
-- So forcing is lifted for the backfill and restored on the very next
-- statement. This migration is NOT atomic — a failed run of it was observed to
-- leave the added column behind — so the ordering below is the safety, not a
-- transaction: nothing that can fail sits between NO FORCE and FORCE, and
-- SET NOT NULL (the statement that actually failed) comes after forcing is
-- back on. Do not move statements into that window.
ALTER TABLE "activity_definitions" NO FORCE ROW LEVEL SECURITY;

-- Backfilled by activity code, not by process. Closing alone spans three
-- parameters — sterilisation is infection control, the drugs cupboard and
-- securing the building are safety — so mapping the whole process to one
-- parameter would file two patient-safety controls under the wrong head and
-- quietly flatter the safety score.
UPDATE "activity_definitions" SET "parameter" = CASE
  WHEN "code" = 'CLS-001' THEN 'INFECTION_CONTROL'
  WHEN "code" = 'CLS-002' THEN 'SAFETY_EMERGENCY'
  WHEN "code" = 'CLS-003' THEN 'INFECTION_CONTROL'
  WHEN "code" = 'CLS-004' THEN 'SAFETY_EMERGENCY'
  WHEN "code" = 'OPN-002' THEN 'ROOM_CHAIR_READINESS'
  WHEN "code" = 'OPN-005' THEN 'SAFETY_EMERGENCY'
  WHEN "code" = 'OPN-006' THEN 'INFECTION_CONTROL'
  WHEN "code" LIKE 'OPN-%' THEN 'OPENING_READINESS'
  WHEN "code" LIKE 'CLS-%' THEN 'INFECTION_CONTROL'
  -- Anything unrecognised is NOT silently filed under a real parameter. It
  -- lands in quality so it shows up as something to classify, rather than
  -- inflating a score it was never measured against.
  ELSE 'QUALITY_CAPA'
END
WHERE "parameter" IS NULL;

ALTER TABLE "activity_definitions" FORCE ROW LEVEL SECURITY;

ALTER TABLE "activity_definitions" ALTER COLUMN "parameter" SET NOT NULL;

-- The dashboard's hot path: every score is "this clinic's activities in this
-- parameter over these days".
CREATE INDEX "activity_definitions_organization_id_parameter_idx"
  ON "activity_definitions" ("organization_id", "parameter");
