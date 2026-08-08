-- When the clinic shuts.
--
-- The owner: "clinic shut time is 6.30 normally with exceptions of some days
-- that is 7". Two facts, so two places:
--
--   clinics.shut_minute        the normal time, one row per clinic
--   clinic_shut_overrides      the days it is not the normal time
--
-- Not a constant, for the same reason four operatories is not a constant: the
-- exception days are the whole point, and a system that only knows the normal
-- time would call every late Thursday an overrun.
--
-- Stored as clinic-local minutes since midnight, as the engine reasons in —
-- 18:30 is 1110. A time-of-day column would have to be interpreted against a
-- zone on every read, and the zone already lives on the clinic.

ALTER TABLE clinics ADD COLUMN shut_minute integer;

COMMENT ON COLUMN clinics.shut_minute IS
  'Clinic-local minutes since midnight at which the clinic normally shuts. '
  'NULL means nobody has said, and the closing target is reported as unknown '
  'rather than guessed.';

CREATE TABLE clinic_shut_overrides (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  clinic_id        uuid NOT NULL REFERENCES clinics(id),

  -- The day this applies to, in the clinic's own calendar.
  on_date          date NOT NULL,
  -- Clinic-local minutes since midnight. 19:00 is 1140.
  shut_minute      integer NOT NULL,
  -- Why, so that a late evening six months ago is still explicable.
  reason           text,

  created_at       timestamptz(6) NOT NULL DEFAULT now()
);

-- One answer per clinic per day. Two rows saying different things about the
-- same evening is the thing this index exists to prevent.
CREATE UNIQUE INDEX clinic_shut_overrides_day
  ON clinic_shut_overrides (organization_id, clinic_id, on_date);

ALTER TABLE clinic_shut_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinic_shut_overrides FORCE ROW LEVEL SECURITY;

CREATE POLICY clinic_shut_overrides_two_level ON clinic_shut_overrides
  USING (organization_id = kubi_current_org()
         AND (kubi_cross_clinic() OR clinic_id = ANY (kubi_current_clinics())))
  WITH CHECK (organization_id = kubi_current_org()
         AND (kubi_cross_clinic() OR clinic_id = ANY (kubi_current_clinics())));

GRANT SELECT, INSERT, UPDATE ON clinic_shut_overrides TO kubi_app;
REVOKE DELETE, TRUNCATE ON clinic_shut_overrides FROM kubi_app;
