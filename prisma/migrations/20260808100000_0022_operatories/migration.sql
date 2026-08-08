-- The operatory master.
--
-- The owner: "i have got 4 operatories but you will have to make a master to
-- decide the number of operatories". So four is a row count, not a constant,
-- and a fifth operatory is an INSERT rather than a release.
--
-- What an operatory is, deliberately narrowly:
--
--   dental chair, x-ray, hand instruments, suction outlet
--
-- and nothing else. The owner again: "do not put special instruments and
-- equipments as they can be taken any where on a movable trolley". Those are
-- checked once for the clinic by the dental assistant, because she is the one
-- who checks the working — not once per room, which would count the same
-- scanner four times and still not know where it was.
--
-- Suction is centralised: each operatory has an outlet whose working is
-- checked here, while the plant itself is one clinic-level check.

CREATE TABLE operatories (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  clinic_id        uuid NOT NULL,

  -- How a person says it: "Operatory 2".
  label            text NOT NULL,
  -- Left to right along the corridor, so the morning list reads in the order
  -- somebody actually walks it.
  position         integer NOT NULL,

  -- Which of the four standard checks apply. All true for this clinic; kept
  -- as columns rather than assumed so a room without an x-ray is master data
  -- and not an exception someone remembers.
  has_chair        boolean NOT NULL DEFAULT true,
  has_xray         boolean NOT NULL DEFAULT true,
  has_suction      boolean NOT NULL DEFAULT true,
  has_instruments  boolean NOT NULL DEFAULT true,

  -- Master data is archived, never deleted (working agreement).
  archived_at      timestamptz(6),

  created_at       timestamptz(6) NOT NULL DEFAULT now(),
  updated_at       timestamptz(6) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX operatories_position
  ON operatories (organization_id, clinic_id, position)
  WHERE archived_at IS NULL;
CREATE INDEX operatories_clinic ON operatories (organization_id, clinic_id);

ALTER TABLE operatories ENABLE ROW LEVEL SECURITY;
ALTER TABLE operatories FORCE ROW LEVEL SECURITY;

CREATE POLICY operatories_two_level ON operatories
  USING (organization_id = kubi_current_org()
         AND (kubi_cross_clinic() OR clinic_id = ANY (kubi_current_clinics())))
  WITH CHECK (organization_id = kubi_current_org()
         AND (kubi_cross_clinic() OR clinic_id = ANY (kubi_current_clinics())));

GRANT SELECT, INSERT, UPDATE ON operatories TO kubi_app;
REVOKE DELETE, TRUNCATE ON operatories FROM kubi_app;
