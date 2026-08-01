-- Laboratory cases, and the gate the requirement cites more than any other:
-- a crown delivery appointment requires Lab Received = YES AND QC = PASSED.
--
-- Booking one before both are true is the exact failure the CAPA parameter was
-- introduced to learn from ("crown delivery appointment given before crown
-- arrived"). With this table it stops being a thing to remember.

CREATE TABLE lab_cases (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations(id),
  clinic_id          uuid NOT NULL,
  reference          text NOT NULL,
  patient_id         uuid NOT NULL REFERENCES patients(id),
  vendor             text NOT NULL,
  work_type          text NOT NULL,
  tooth_ref          text NOT NULL,
  shade              text,
  material           text,
  status             text NOT NULL DEFAULT 'CREATED',
  dispatched_at      timestamptz(6),
  expected_return_at timestamptz(6),
  received_at        timestamptz(6),
  qc_result          text,
  qc_by_employee_id  uuid,
  qc_at              timestamptz(6),
  qc_note            text,
  remake_count       integer NOT NULL DEFAULT 0,
  delivered_at       timestamptz(6),
  created_at         timestamptz(6) NOT NULL DEFAULT now(),
  updated_at         timestamptz(6) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX lab_cases_org_reference ON lab_cases (organization_id, reference);
CREATE INDEX lab_cases_org_clinic_status ON lab_cases (organization_id, clinic_id, status);
CREATE INDEX lab_cases_expected_return ON lab_cases (expected_return_at);

ALTER TABLE lab_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_cases FORCE ROW LEVEL SECURITY;

CREATE POLICY lab_cases_two_level ON lab_cases
  USING (organization_id = kubi_current_org()
         AND (kubi_cross_clinic() OR clinic_id = ANY (kubi_current_clinics())))
  WITH CHECK (organization_id = kubi_current_org()
         AND (kubi_cross_clinic() OR clinic_id = ANY (kubi_current_clinics())));

GRANT SELECT, INSERT, UPDATE ON lab_cases TO kubi_app;
REVOKE DELETE, TRUNCATE ON lab_cases FROM kubi_app;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kubi_app' AND rolbypassrls) THEN
    RAISE EXCEPTION 'kubi_app must not hold BYPASSRLS';
  END IF;
END $$;
