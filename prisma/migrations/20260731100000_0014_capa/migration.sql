-- CAPA: the IMPROVE stage of the Operations App §8 loop.
--
--   PLAN -> TRIGGER -> ASSIGN -> EXECUTE -> PROVE -> VERIFY -> ESCALATE
--        -> MEASURE -> IMPROVE
--
-- Everything before IMPROVE already existed. Without it the clinic detects the
-- same failure every day and files it identically every day. The requirement
-- states the purpose: "this is how your clinic starts learning from failures
-- rather than repeatedly correcting them."

CREATE TABLE incidents (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           uuid NOT NULL REFERENCES organizations(id),
  clinic_id                 uuid NOT NULL,
  reference                 text NOT NULL,
  source                    text NOT NULL DEFAULT 'MANUAL',
  parameter                 text NOT NULL,
  priority                  text NOT NULL,
  status                    text NOT NULL DEFAULT 'OPEN',
  summary                   text NOT NULL,
  description               text,
  immediate_correction      text,
  contained_at              timestamptz(6),
  root_cause                text,
  investigated_at           timestamptz(6),
  closed_at                 timestamptz(6),
  source_attention_item_id  uuid,
  source_instance_id        uuid REFERENCES activity_instances(id),
  reported_by_employee_id   uuid,
  owner_employee_id         uuid,
  created_at                timestamptz(6) NOT NULL DEFAULT now(),
  updated_at                timestamptz(6) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX incidents_org_reference ON incidents (organization_id, reference);
CREATE INDEX incidents_org_clinic_status ON incidents (organization_id, clinic_id, status);
CREATE INDEX incidents_org_clinic_parameter ON incidents (organization_id, clinic_id, parameter);

CREATE TABLE capa_actions (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid NOT NULL REFERENCES organizations(id),
  incident_id              uuid NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  type                     text NOT NULL,
  description              text NOT NULL,
  status                   text NOT NULL DEFAULT 'OPEN',
  responsible_employee_id  uuid NOT NULL,
  due_at                   timestamptz(6) NOT NULL,
  completed_at             timestamptz(6),
  verified_by_employee_id  uuid,
  verified_at              timestamptz(6),
  verification_note        text,
  created_at               timestamptz(6) NOT NULL DEFAULT now(),
  updated_at               timestamptz(6) NOT NULL DEFAULT now()
);
CREATE INDEX capa_actions_org_incident ON capa_actions (organization_id, incident_id);
CREATE INDEX capa_actions_responsible_status ON capa_actions (responsible_employee_id, status);

-- Same two-level isolation as every other clinic-scoped table.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['incidents','capa_actions']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

CREATE POLICY incidents_two_level ON incidents
  USING (organization_id = kubi_current_org()
         AND (kubi_cross_clinic() OR clinic_id = ANY (kubi_current_clinics())))
  WITH CHECK (organization_id = kubi_current_org()
         AND (kubi_cross_clinic() OR clinic_id = ANY (kubi_current_clinics())));

-- capa_actions carries no clinic_id of its own: an action belongs to its
-- incident, and inheriting the incident's clinic is the only correct answer.
-- Denormalising clinic_id here would let the two disagree.
CREATE POLICY capa_actions_via_incident ON capa_actions
  USING (organization_id = kubi_current_org()
         AND EXISTS (SELECT 1 FROM incidents i
                     WHERE i.id = capa_actions.incident_id
                       AND (kubi_cross_clinic() OR i.clinic_id = ANY (kubi_current_clinics()))))
  WITH CHECK (organization_id = kubi_current_org()
         AND EXISTS (SELECT 1 FROM incidents i
                     WHERE i.id = capa_actions.incident_id
                       AND (kubi_cross_clinic() OR i.clinic_id = ANY (kubi_current_clinics()))));

GRANT SELECT, INSERT, UPDATE ON incidents, capa_actions TO kubi_app;
REVOKE DELETE, TRUNCATE ON incidents, capa_actions FROM kubi_app;

-- An incident is the clinic's record of what it learned. Deleting one erases
-- the learning, so the runtime role cannot -- exactly as for evidence.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kubi_app' AND rolbypassrls) THEN
    RAISE EXCEPTION 'kubi_app must not hold BYPASSRLS';
  END IF;
END $$;
