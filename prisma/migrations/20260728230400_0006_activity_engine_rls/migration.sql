-- VS-01 activity engine: RLS + least privilege, same pattern as 0002/0004.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'activity_definitions','checklist_item_definitions','activity_instances',
    'checklist_responses','evidence','verifications','attention_items',
    'notifications','ux_events','automation_executions'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (organization_id = kubi_current_org()) WITH CHECK (organization_id = kubi_current_org())',
      t || '_org_isolation', t);
  END LOOP;
END $$;

DROP POLICY activity_instances_org_isolation ON activity_instances;
CREATE POLICY activity_instances_two_level ON activity_instances
  USING (organization_id = kubi_current_org()
         AND (kubi_cross_clinic() OR clinic_id = ANY (kubi_current_clinics())))
  WITH CHECK (organization_id = kubi_current_org()
         AND (kubi_cross_clinic() OR clinic_id = ANY (kubi_current_clinics())));

DROP POLICY attention_items_org_isolation ON attention_items;
CREATE POLICY attention_items_two_level ON attention_items
  USING (organization_id = kubi_current_org()
         AND (kubi_cross_clinic() OR clinic_id = ANY (kubi_current_clinics())))
  WITH CHECK (organization_id = kubi_current_org()
         AND (kubi_cross_clinic() OR clinic_id = ANY (kubi_current_clinics())));

GRANT SELECT, INSERT, UPDATE ON
  activity_definitions, checklist_item_definitions, activity_instances,
  checklist_responses, attention_items, notifications, ux_events,
  automation_executions TO kubi_app;
GRANT SELECT, INSERT ON evidence, verifications TO kubi_app;
REVOKE DELETE, TRUNCATE ON
  activity_definitions, checklist_item_definitions, activity_instances,
  checklist_responses, evidence, verifications, attention_items,
  notifications, ux_events, automation_executions FROM kubi_app;
REVOKE UPDATE ON evidence, verifications FROM kubi_app;

CREATE OR REPLACE FUNCTION kubi_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not permitted', TG_TABLE_NAME, TG_OP;
END; $$;
CREATE TRIGGER evidence_append_only BEFORE UPDATE OR DELETE ON evidence
  FOR EACH ROW EXECUTE FUNCTION kubi_append_only();
CREATE TRIGGER verifications_append_only BEFORE UPDATE OR DELETE ON verifications
  FOR EACH ROW EXECUTE FUNCTION kubi_append_only();
