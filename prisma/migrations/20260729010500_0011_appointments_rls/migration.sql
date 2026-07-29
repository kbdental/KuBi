-- VS-02 appointments: RLS + least privilege, same pattern as 0002/0004/0006.
--
-- Appointments are the first table to carry a link to a PATIENT alongside a
-- time and a place, so getting isolation right here matters more than it did
-- for a checklist. Two-level from the start: an appointment belongs to one
-- clinic, and a person scoped to another clinic must not see it exists.
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments FORCE ROW LEVEL SECURITY;

CREATE POLICY appointments_two_level ON appointments
  USING (organization_id = kubi_current_org()
         AND (kubi_cross_clinic() OR clinic_id = ANY (kubi_current_clinics())))
  WITH CHECK (organization_id = kubi_current_org()
         AND (kubi_cross_clinic() OR clinic_id = ANY (kubi_current_clinics())));

GRANT SELECT, INSERT, UPDATE ON appointments TO kubi_app;
-- No DELETE, per the working agreement: an appointment is cancelled, never
-- removed. "It was never booked" and "it was cancelled" are different facts
-- and a clinic needs to be able to tell them apart afterwards.
REVOKE DELETE, TRUNCATE ON appointments FROM kubi_app;

-- A cancelled appointment keeps its reason. Clearing the reason while leaving
-- the status would leave an unexplained cancellation in the record.
CREATE OR REPLACE FUNCTION kubi_appointment_cancel_keeps_reason() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'CANCELLED'
     AND (NEW.cancel_reason IS NULL OR btrim(NEW.cancel_reason) = '') THEN
    RAISE EXCEPTION 'A cancelled appointment must record why.';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER appointments_cancel_keeps_reason
  BEFORE INSERT OR UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION kubi_appointment_cancel_keeps_reason();

-- Re-assert the invariant that matters everywhere.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kubi_app' AND rolbypassrls) THEN
    RAISE EXCEPTION 'kubi_app must not hold BYPASSRLS';
  END IF;
END $$;
