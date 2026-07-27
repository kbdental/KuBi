# ADR-014 — Competency checks are MVP; competency data is Phase 3

Status: Accepted · Additional Principle 2

## Decision
The Assignment engine evaluates G-09 from MVP. With no competency configuration
present it returns `NOT_CONFIGURED`, never `PASS`.

## Rationale
No permissive code path is introduced and later removed — the tightening is a
configuration change, not a code change. A `PASS` default would be exactly the
silent failure AP-1 forbids.
