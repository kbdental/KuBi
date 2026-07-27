# ADR-002 — One patient identity per organisation

Status: Accepted · Owner decision D-02

## Decision
A single organisation-wide UHID. Clinic visibility is a permission
(`patient:view_all_clinics`), not a data boundary.

## Consequences
+ No duplicate record can hide an allergy or implant history.
- Patient rows are org-scoped while most tables are clinic-scoped, so the
  tenancy guard has two modes. Both are exercised by the RLS suite (T3/T4).
