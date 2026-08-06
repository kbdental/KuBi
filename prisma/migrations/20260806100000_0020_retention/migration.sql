-- Patients who stopped coming, and what was done about it.
--
-- The owner's line: "Dr's to do follow up with existing patient and patient
-- that have come but not started treatment or not coming back for any reason".
-- Thirty days is theirs too, given when asked.
--
-- Detection needs no table — it is arithmetic over appointments and
-- patient_procedures, recomputed every time it is asked, because a stored
-- "dormant" flag is stale the moment somebody books. What needs a table is the
-- OUTREACH: that somebody rang, when, who, and what the patient said. Without
-- it the same three patients get rung four times and the one who asked to be
-- left alone gets rung again next month.

CREATE TABLE retention_outreach (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations(id),
  clinic_id          uuid NOT NULL,
  patient_id         uuid NOT NULL REFERENCES patients(id),

  -- NEVER_STARTED | STOPPED_MID_TREATMENT, as at the moment it was raised.
  -- Kept rather than recomputed on read: why somebody was rung is a fact about
  -- that call, and it changes when the patient comes back.
  reason             text NOT NULL,
  -- Days since the last attended visit when this was raised. A number the
  -- doctor sees before dialling.
  days_dormant       integer NOT NULL,
  raised_at          timestamptz(6) NOT NULL DEFAULT now(),

  -- Set when somebody actually speaks to them. NULL means raised and not yet
  -- attempted; NO_ANSWER is an attempt, and both are worth telling apart.
  contacted_at       timestamptz(6),
  contacted_by_employee_id uuid,
  -- RETURNING | DECLINED | WILL_DECIDE | NO_ANSWER | UNREACHABLE | NOT_APPLICABLE
  outcome            text,
  -- What the patient said, in their words where possible. The reason a
  -- retention list is worth keeping: "the crown cost more than the car repair"
  -- is information; "declined" is not.
  note               text,

  -- Set when the loop closes: they booked, they declined, or it did not apply.
  closed_at          timestamptz(6),

  created_at         timestamptz(6) NOT NULL DEFAULT now(),
  updated_at         timestamptz(6) NOT NULL DEFAULT now()
);

-- One open outreach per patient. A partial unique index rather than a check in
-- the service: two doctors opening the list at the same second is exactly when
-- a service-level check loses, and this is the one duplicate that reaches the
-- patient as a second phone call.
CREATE UNIQUE INDEX retention_outreach_one_open
  ON retention_outreach (organization_id, patient_id)
  WHERE closed_at IS NULL;

CREATE INDEX retention_outreach_org_clinic_open
  ON retention_outreach (organization_id, clinic_id, closed_at);

ALTER TABLE retention_outreach ENABLE ROW LEVEL SECURITY;
ALTER TABLE retention_outreach FORCE ROW LEVEL SECURITY;

CREATE POLICY retention_outreach_two_level ON retention_outreach
  USING (organization_id = kubi_current_org()
         AND (kubi_cross_clinic() OR clinic_id = ANY (kubi_current_clinics())))
  WITH CHECK (organization_id = kubi_current_org()
         AND (kubi_cross_clinic() OR clinic_id = ANY (kubi_current_clinics())));

GRANT SELECT, INSERT, UPDATE ON retention_outreach TO kubi_app;
REVOKE DELETE, TRUNCATE ON retention_outreach FROM kubi_app;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kubi_app' AND rolbypassrls) THEN
    RAISE EXCEPTION 'kubi_app must not BYPASSRLS';
  END IF;
END $$;
