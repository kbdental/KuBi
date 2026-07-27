# ADR-004 — Three-mode enforcement with an immutable hard-gate list

Status: Accepted · Owner decision D-04

## Decision
`ADVISORY` / `BLOCK_OVERRIDABLE` / `BLOCK_HARD`, configured per requirement.
G-05 (sterilization release), G-07 (implant batch), G-14 (communication
consent) and G-15 (sterile pack) are BLOCK_HARD and listed in
`safety.immutable_block_hard_gates` at SYSTEM scope with no write path.

## Enforcement mechanism
"No ordinary override path" is enforced by the ABSENCE of a permission, not by
a runtime check: no override permission exists in the catalogue for these gates,
so no role can be granted one. See `IMMUTABLE_BLOCK_HARD_GATES` in
`packages/contracts/src/enums.ts` and the invariant test in
`tests/unit/enums.test.ts`.

## Consequences
- A genuine emergency needing a hard-gate bypass has no in-system answer and
  requires a documented out-of-band process. This is the intended trade.
