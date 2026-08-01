-- The components a specific implant case needs.
--
-- On the case rather than on the procedure protocol, because two implant
-- surgeries following the same protocol need different platforms, diameters
-- and lengths. That distinction is the whole reason the requirement says
-- counting implants is clinically insufficient.
ALTER TABLE patient_procedures ADD COLUMN component_requirements jsonb;
