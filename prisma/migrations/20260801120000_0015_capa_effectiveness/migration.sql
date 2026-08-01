-- Align the CAPA lifecycle with FRS §6, which specifies it exactly:
--
--   OPEN -> ACTION_IN_PROGRESS -> IMPLEMENTED -> EFFECTIVENESS_PENDING
--        -> EFFECTIVE -> CLOSED,  "ineffective loops back"
--
-- Migration 0014 built a four-state lifecycle (OPEN/IN_PROGRESS/COMPLETED/
-- VERIFIED) that stopped at "somebody checked it was done". That conflates two
-- different questions: whether the fix was carried out, and whether it worked.
-- Matrix v2.0 INC-006 makes the second one its own activity, falling due on its
-- own configured date, and the FRS makes an ineffective result loop back rather
-- than close.
--
-- Without the loop back a clinic can close the same failure for ever while
-- believing it has learned something -- which is precisely what the CAPA
-- parameter exists to prevent.

ALTER TABLE capa_actions RENAME COLUMN completed_at TO implemented_at;
ALTER TABLE capa_actions ADD COLUMN effectiveness_due_at timestamptz(6);
ALTER TABLE capa_actions ADD COLUMN ineffective_count integer NOT NULL DEFAULT 0;

-- Existing rows carry the old vocabulary. The mapping is the honest one:
-- COMPLETED meant "carried out" (IMPLEMENTED), and VERIFIED meant "somebody
-- looked at it" -- which under the new machine is EFFECTIVENESS_PENDING, NOT
-- EFFECTIVE. Nobody has yet asked whether those fixes worked, and promoting
-- them to EFFECTIVE would assert something no one checked.
--
-- FORCE ROW LEVEL SECURITY binds the table owner too, so a backfill UPDATE
-- silently matches zero rows unless force is lifted first. Nothing that can
-- fail goes between the two statements: migrations are not atomic here, and a
-- failure in between would leave the table unforced.
ALTER TABLE capa_actions NO FORCE ROW LEVEL SECURITY;
UPDATE capa_actions SET status = CASE status
  WHEN 'IN_PROGRESS' THEN 'ACTION_IN_PROGRESS'
  WHEN 'COMPLETED'   THEN 'IMPLEMENTED'
  WHEN 'VERIFIED'    THEN 'EFFECTIVENESS_PENDING'
  ELSE status END
WHERE status IN ('IN_PROGRESS', 'COMPLETED', 'VERIFIED');
ALTER TABLE capa_actions FORCE ROW LEVEL SECURITY;

-- Incidents that were CLOSED under the old rule were closed without an
-- effectiveness check. Reopening them is the correct answer rather than the
-- convenient one: the record must not claim a check that never happened.
ALTER TABLE incidents NO FORCE ROW LEVEL SECURITY;
UPDATE incidents SET status = 'VERIFYING', closed_at = NULL WHERE status = 'CLOSED';
ALTER TABLE incidents FORCE ROW LEVEL SECURITY;
