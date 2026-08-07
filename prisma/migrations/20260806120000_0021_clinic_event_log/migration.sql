-- The event log. Specification §16.
--
-- "The event log is the only truth. Everything else is a projection."
--
-- One writable table. Flows, ownership, timers and governance state are all
-- rebuilt by replaying this, and none of them has a column anywhere — a
-- second copy of the world is a second thing to be wrong.
--
-- Append-only by GRANT, not by good manners. The application role can insert
-- and select and nothing else; there is no code path to an UPDATE because the
-- database refuses one. That distinction is the whole finding from the Google
-- Sheets analysis, and it is not negotiable here.

CREATE TABLE clinic_events (
  seq              bigserial PRIMARY KEY,
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  clinic_id        uuid NOT NULL,

  -- Past tense, always. A row here is something a person did.
  type             text NOT NULL,
  -- Patient id, batch reference, case number, 'today' for the premises.
  subject_id       text NOT NULL,
  -- How a person refers to it: "Meera R.", "STER-0914".
  subject_label    text,

  -- Two times, deliberately. A patient arrived at 09:05 and reception typed it
  -- at 09:11; both facts matter, and collapsing them loses the waiting-room
  -- clock the whole escalation model runs on.
  occurred_at      timestamptz(6) NOT NULL,
  recorded_at      timestamptz(6) NOT NULL DEFAULT now(),
  -- Clinic-local minutes since midnight, as the engine reasons in. Stored
  -- rather than derived so a replay cannot drift with a timezone change.
  occurred_minute  integer NOT NULL,

  by_employee_id   uuid,
  by_role          text NOT NULL,

  payload          jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- The caller's own id for this event. Two clicks of the same button, or a
  -- retried request, carry the same one and the second insert is refused
  -- rather than recorded twice. Idempotency belongs in the log, not in
  -- whichever caller remembered to check first.
  idempotency_key  text NOT NULL
);

-- Ordering is the sequence, and the sequence is per clinic. Replay reads in
-- this order and nothing else.
CREATE INDEX clinic_events_replay ON clinic_events (organization_id, clinic_id, seq);
CREATE INDEX clinic_events_subject ON clinic_events (organization_id, subject_id);
CREATE UNIQUE INDEX clinic_events_idempotency
  ON clinic_events (organization_id, idempotency_key);

ALTER TABLE clinic_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinic_events FORCE ROW LEVEL SECURITY;

CREATE POLICY clinic_events_two_level ON clinic_events
  USING (organization_id = kubi_current_org()
         AND (kubi_cross_clinic() OR clinic_id = ANY (kubi_current_clinics())))
  WITH CHECK (organization_id = kubi_current_org()
         AND (kubi_cross_clinic() OR clinic_id = ANY (kubi_current_clinics())));

GRANT SELECT, INSERT ON clinic_events TO kubi_app;
GRANT USAGE, SELECT ON SEQUENCE clinic_events_seq_seq TO kubi_app;
REVOKE UPDATE, DELETE, TRUNCATE ON clinic_events FROM kubi_app;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kubi_app' AND rolbypassrls) THEN
    RAISE EXCEPTION 'kubi_app must not BYPASSRLS';
  END IF;
END $$;
