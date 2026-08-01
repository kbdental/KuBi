-- Equipment, Inventory, Implant and Sterilization: the tables behind engines
-- 3 and 4, and the reason engine 5 could only ever evaluate consent.
--
-- Compliance asks "are the implant components available?" and "is the surgical
-- kit sterile?". Until now there was nothing to ask, so those requirements
-- returned NOT_CONFIGURED — correct under AP-1, and useless to a clinic. These
-- tables are what let those questions have answers.


CREATE TABLE assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id), clinic_id uuid NOT NULL,
  code text NOT NULL, name text NOT NULL, category text NOT NULL, location text,
  status text NOT NULL DEFAULT 'OPERATIONAL', responsible_employee_id uuid,
  amc_vendor text, amc_expiry_at timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT now(), updated_at timestamptz(6) NOT NULL DEFAULT now()
);

CREATE TABLE maintenance_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  kind text NOT NULL, interval_days integer NOT NULL, lead_time_days integer NOT NULL DEFAULT 7,
  last_serviced_at timestamptz(6), next_due_at timestamptz(6) NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(), updated_at timestamptz(6) NOT NULL DEFAULT now()
);

CREATE TABLE asset_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  period_key text NOT NULL, result text NOT NULL, note text,
  checked_by_employee_id uuid, checked_at timestamptz(6) NOT NULL DEFAULT now()
);

CREATE TABLE breakdowns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  reported_at timestamptz(6) NOT NULL DEFAULT now(), reported_by_employee_id uuid,
  description text NOT NULL, repaired_at timestamptz(6),
  verified_by_employee_id uuid, verified_at timestamptz(6)
);

CREATE TABLE items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id), clinic_id uuid NOT NULL,
  code text NOT NULL, name text NOT NULL, category text NOT NULL, unit text NOT NULL,
  minimum_qty integer NOT NULL, reorder_qty integer NOT NULL, reorder_level integer NOT NULL,
  supplier text, location text,
  created_at timestamptz(6) NOT NULL DEFAULT now(), updated_at timestamptz(6) NOT NULL DEFAULT now()
);

CREATE TABLE stock_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  batch_ref text NOT NULL, quantity integer NOT NULL, expiry_at timestamptz(6),
  received_at timestamptz(6) NOT NULL DEFAULT now()
);

CREATE TABLE implant_skus (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id), clinic_id uuid NOT NULL,
  brand text NOT NULL, line text NOT NULL, platform text NOT NULL,
  diameter_mm double precision, length_mm double precision,
  component_type text NOT NULL, quantity integer NOT NULL DEFAULT 0,
  batch_ref text, expiry_at timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT now(), updated_at timestamptz(6) NOT NULL DEFAULT now()
);

CREATE TABLE sterilization_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id), clinic_id uuid NOT NULL,
  batch_ref text NOT NULL, stage text NOT NULL DEFAULT 'COLLECTED',
  operator_employee_id uuid, pack_count integer NOT NULL DEFAULT 0,
  cycle_number text, cycle_start_at timestamptz(6), cycle_end_at timestamptz(6), cycle_result text,
  released_by_employee_id uuid, released_at timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT now(), updated_at timestamptz(6) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX assets_org_code ON assets (organization_id, code);
CREATE INDEX assets_org_clinic_status ON assets (organization_id, clinic_id, status);
CREATE INDEX maintenance_plans_due ON maintenance_plans (organization_id, next_due_at);
CREATE UNIQUE INDEX asset_checks_asset_period ON asset_checks (asset_id, period_key);
CREATE INDEX breakdowns_org_asset ON breakdowns (organization_id, asset_id);
CREATE UNIQUE INDEX items_org_code ON items (organization_id, code);
CREATE INDEX items_org_clinic ON items (organization_id, clinic_id);
CREATE INDEX stock_batches_org_item ON stock_batches (organization_id, item_id);
CREATE INDEX stock_batches_expiry ON stock_batches (expiry_at);
CREATE INDEX implant_skus_org_clinic_type ON implant_skus (organization_id, clinic_id, component_type);
CREATE UNIQUE INDEX sterilization_batches_org_ref ON sterilization_batches (organization_id, batch_ref);
CREATE INDEX sterilization_batches_org_clinic_stage ON sterilization_batches (organization_id, clinic_id, stage);


-- Same two-level isolation as every other clinic-scoped table.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['assets','maintenance_plans','asset_checks','breakdowns','items','stock_batches','implant_skus','sterilization_batches']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

CREATE POLICY assets_two_level ON assets
  USING (organization_id = kubi_current_org()
         AND (kubi_cross_clinic() OR clinic_id = ANY (kubi_current_clinics())))
  WITH CHECK (organization_id = kubi_current_org()
         AND (kubi_cross_clinic() OR clinic_id = ANY (kubi_current_clinics())));

CREATE POLICY items_two_level ON items
  USING (organization_id = kubi_current_org()
         AND (kubi_cross_clinic() OR clinic_id = ANY (kubi_current_clinics())))
  WITH CHECK (organization_id = kubi_current_org()
         AND (kubi_cross_clinic() OR clinic_id = ANY (kubi_current_clinics())));

CREATE POLICY implant_skus_two_level ON implant_skus
  USING (organization_id = kubi_current_org()
         AND (kubi_cross_clinic() OR clinic_id = ANY (kubi_current_clinics())))
  WITH CHECK (organization_id = kubi_current_org()
         AND (kubi_cross_clinic() OR clinic_id = ANY (kubi_current_clinics())));

CREATE POLICY sterilization_batches_two_level ON sterilization_batches
  USING (organization_id = kubi_current_org()
         AND (kubi_cross_clinic() OR clinic_id = ANY (kubi_current_clinics())))
  WITH CHECK (organization_id = kubi_current_org()
         AND (kubi_cross_clinic() OR clinic_id = ANY (kubi_current_clinics())));

-- No clinic_id of its own: it belongs to its asset, and inheriting is
-- the only answer that cannot disagree with the parent.
CREATE POLICY maintenance_plans_via_parent ON maintenance_plans
  USING (organization_id = kubi_current_org()
         AND EXISTS (SELECT 1 FROM assets p WHERE p.id = maintenance_plans.asset_id
                     AND (kubi_cross_clinic() OR p.clinic_id = ANY (kubi_current_clinics()))))
  WITH CHECK (organization_id = kubi_current_org()
         AND EXISTS (SELECT 1 FROM assets p WHERE p.id = maintenance_plans.asset_id
                     AND (kubi_cross_clinic() OR p.clinic_id = ANY (kubi_current_clinics()))));

-- No clinic_id of its own: it belongs to its asset, and inheriting is
-- the only answer that cannot disagree with the parent.
CREATE POLICY asset_checks_via_parent ON asset_checks
  USING (organization_id = kubi_current_org()
         AND EXISTS (SELECT 1 FROM assets p WHERE p.id = asset_checks.asset_id
                     AND (kubi_cross_clinic() OR p.clinic_id = ANY (kubi_current_clinics()))))
  WITH CHECK (organization_id = kubi_current_org()
         AND EXISTS (SELECT 1 FROM assets p WHERE p.id = asset_checks.asset_id
                     AND (kubi_cross_clinic() OR p.clinic_id = ANY (kubi_current_clinics()))));

-- No clinic_id of its own: it belongs to its asset, and inheriting is
-- the only answer that cannot disagree with the parent.
CREATE POLICY breakdowns_via_parent ON breakdowns
  USING (organization_id = kubi_current_org()
         AND EXISTS (SELECT 1 FROM assets p WHERE p.id = breakdowns.asset_id
                     AND (kubi_cross_clinic() OR p.clinic_id = ANY (kubi_current_clinics()))))
  WITH CHECK (organization_id = kubi_current_org()
         AND EXISTS (SELECT 1 FROM assets p WHERE p.id = breakdowns.asset_id
                     AND (kubi_cross_clinic() OR p.clinic_id = ANY (kubi_current_clinics()))));

-- No clinic_id of its own: it belongs to its item, and inheriting is
-- the only answer that cannot disagree with the parent.
CREATE POLICY stock_batches_via_parent ON stock_batches
  USING (organization_id = kubi_current_org()
         AND EXISTS (SELECT 1 FROM items p WHERE p.id = stock_batches.item_id
                     AND (kubi_cross_clinic() OR p.clinic_id = ANY (kubi_current_clinics()))))
  WITH CHECK (organization_id = kubi_current_org()
         AND EXISTS (SELECT 1 FROM items p WHERE p.id = stock_batches.item_id
                     AND (kubi_cross_clinic() OR p.clinic_id = ANY (kubi_current_clinics()))));


GRANT SELECT, INSERT, UPDATE ON assets, maintenance_plans, asset_checks, breakdowns, items, stock_batches, implant_skus, sterilization_batches TO kubi_app;
REVOKE DELETE, TRUNCATE ON assets, maintenance_plans, asset_checks, breakdowns, items, stock_batches, implant_skus, sterilization_batches FROM kubi_app;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kubi_app' AND rolbypassrls) THEN
    RAISE EXCEPTION 'kubi_app must not hold BYPASSRLS';
  END IF;
END $$;
