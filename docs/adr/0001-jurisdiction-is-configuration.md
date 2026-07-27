# ADR-001 — Jurisdiction is configuration, not architecture

Status: Accepted (Owner review, Phase 0.5) · Owner decision D-01

## Context
KuBi operates initially in India (DPDP Act 2023 + clinical establishment record
rules). The owner condition was explicit: jurisdiction-specific rules must be
configurable and must NOT be hard-coded into the core domain architecture.

## Decision
Jurisdiction resolves through a `compliance_profile` configuration object at
ORGANIZATION scope, carrying retention periods, breach-notification windows,
cross-border transfer permission and consent requirements. No statute-specific
branch appears in the domain layer.

## Consequences
+ A second jurisdiction is a configuration row plus a policy review.
- Every retention and consent path must read config rather than a constant.
- Retention values remain unset pending OD-08 (now closed; values to be loaded).
