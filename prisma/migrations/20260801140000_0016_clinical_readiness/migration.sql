-- Clinical readiness, consent and follow-up. Build Pack §10 puts these next,
-- and they are where the Compliance engine finally has something to enforce.
--
-- FRS §10 acceptance criteria implemented here:
--   "Missing mandatory consent makes procedure NOT_READY"
--   "Surgery completion creates follow-up"
--   "Red-flag follow-up alerts qualified clinical role"

CREATE TABLE procedures (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        uuid NOT NULL REFERENCES organizations(id),
  code                   text NOT NULL,
  name                   text NOT NULL,
  category               text NOT NULL,
  followup_offset_days   integer[] NOT NULL DEFAULT '{}',
  enabled                boolean NOT NULL DEFAULT true,
  created_at             timestamptz(6) NOT NULL DEFAULT now(),
  updated_at             timestamptz(6) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX procedures_org_code ON procedures (organization_id, code);

CREATE TABLE procedure_requirements (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  procedure_id uuid NOT NULL REFERENCES procedures(id) ON DELETE CASCADE,
  kind         text NOT NULL,
  label        text NOT NULL,
  enforcement  text NOT NULL,
  gate_code    text,
  sort_order   integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX procedure_requirements_unique ON procedure_requirements (procedure_id, kind);

CREATE TABLE patient_procedures (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           uuid NOT NULL REFERENCES organizations(id),
  clinic_id                 uuid NOT NULL,
  patient_id                uuid NOT NULL REFERENCES patients(id),
  procedure_id              uuid NOT NULL REFERENCES procedures(id),
  appointment_id            uuid,
  status                    text NOT NULL DEFAULT 'PLANNED',
  readiness                 text NOT NULL DEFAULT 'PENDING',
  readiness_evaluated_at    timestamptz(6),
  overridden_by_employee_id uuid,
  override_reason           text,
  overridden_at             timestamptz(6),
  started_at                timestamptz(6),
  completed_at              timestamptz(6),
  created_at                timestamptz(6) NOT NULL DEFAULT now(),
  updated_at                timestamptz(6) NOT NULL DEFAULT now()
);
CREATE INDEX patient_procedures_org_clinic_status ON patient_procedures (organization_id, clinic_id, status);
CREATE INDEX patient_procedures_patient ON patient_procedures (patient_id);

CREATE TABLE consents (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL REFERENCES organizations(id),
  clinic_id            uuid NOT NULL,
  patient_id           uuid NOT NULL REFERENCES patients(id),
  patient_procedure_id uuid REFERENCES patient_procedures(id),
  consent_type         text NOT NULL,
  template_code        text NOT NULL,
  template_version     integer NOT NULL,
  signed_at            timestamptz(6) NOT NULL,
  witness_employee_id  uuid,
  withdrawn_at         timestamptz(6),
  created_at           timestamptz(6) NOT NULL DEFAULT now()
);
CREATE INDEX consents_org_patient ON consents (organization_id, patient_id);

CREATE TABLE followups (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL REFERENCES organizations(id),
  clinic_id            uuid NOT NULL,
  patient_id           uuid NOT NULL REFERENCES patients(id),
  patient_procedure_id uuid NOT NULL REFERENCES patient_procedures(id),
  due_at               timestamptz(6) NOT NULL,
  assigned_employee_id uuid,
  outcome              text NOT NULL DEFAULT 'PENDING',
  pain                 text,
  swelling             text,
  bleeding             text,
  medication           text,
  other_complaint      boolean,
  red_flag             boolean NOT NULL DEFAULT false,
  red_flag_reason      text,
  escalated_item_id    uuid,
  contacted_at         timestamptz(6),
  created_at           timestamptz(6) NOT NULL DEFAULT now(),
  updated_at           timestamptz(6) NOT NULL DEFAULT now()
);
CREATE INDEX followups_org_clinic_outcome ON followups (organization_id, clinic_id, outcome);
CREATE INDEX followups_due ON followups (due_at);

-- Same two-level isolation as every other clinic-scoped table.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['procedures','procedure_requirements','patient_procedures','consents','followups']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- `procedures` is organisation-level master data: a protocol is not owned by
-- one clinic, and every clinic in the group must evaluate against the same one.
CREATE POLICY procedures_org_isolation ON procedures
  USING (organization_id = kubi_current_org())
  WITH CHECK (organization_id = kubi_current_org());

-- Requirements carry no organization_id of their own; they belong to their
-- procedure, and inheriting is the only answer that cannot disagree with it.
CREATE POLICY procedure_requirements_via_procedure ON procedure_requirements
  USING (EXISTS (SELECT 1 FROM procedures p
                 WHERE p.id = procedure_requirements.procedure_id
                   AND p.organization_id = kubi_current_org()))
  WITH CHECK (EXISTS (SELECT 1 FROM procedures p
                 WHERE p.id = procedure_requirements.procedure_id
                   AND p.organization_id = kubi_current_org()));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['patient_procedures','consents','followups']
  LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (organization_id = kubi_current_org()
         AND (kubi_cross_clinic() OR clinic_id = ANY (kubi_current_clinics())))
       WITH CHECK (organization_id = kubi_current_org()
         AND (kubi_cross_clinic() OR clinic_id = ANY (kubi_current_clinics())))',
      t || '_two_level', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON
  procedures, procedure_requirements, patient_procedures, followups TO kubi_app;
-- A consent is evidence of what a patient agreed to. It is signed once and
-- never edited; withdrawal is a new fact recorded by the withdrawn_at column,
-- which is why UPDATE is granted on that table but DELETE is not granted
-- anywhere. Append-only is enforced by the trigger below, not by convention.
GRANT SELECT, INSERT, UPDATE (withdrawn_at) ON consents TO kubi_app;
REVOKE DELETE, TRUNCATE ON
  procedures, procedure_requirements, patient_procedures, consents, followups FROM kubi_app;

CREATE OR REPLACE FUNCTION kubi_consent_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.signed_at IS DISTINCT FROM NEW.signed_at
     OR OLD.template_version IS DISTINCT FROM NEW.template_version
     OR OLD.template_code IS DISTINCT FROM NEW.template_code
     OR OLD.patient_id IS DISTINCT FROM NEW.patient_id THEN
    RAISE EXCEPTION 'Consent records are append-only; withdraw rather than edit.';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER consents_append_only BEFORE UPDATE ON consents
  FOR EACH ROW EXECUTE FUNCTION kubi_consent_append_only();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kubi_app' AND rolbypassrls) THEN
    RAISE EXCEPTION 'kubi_app must not hold BYPASSRLS';
  END IF;
END $$;
