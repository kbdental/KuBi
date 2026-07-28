/**
 * KuBi canonical enum register — Phase 0.5 Deliverable 3.
 *
 * This file is the SINGLE source of truth for every enumerated value in KuBi.
 * The API, the web app, the seed loaders and the database all derive from here.
 *
 * Provenance markers used in comments:
 *   DERIVED       — read from FRS v1.0, Developer Build Pack v1.0 or Matrix v2.0
 *   NEW           — introduced by an approved Phase 0 decision or Additional Principle
 *   DECISION      — an owner decision is still open on this value set
 *
 * DO NOT add, rename or reorder values without a corresponding register update.
 * Enum values are persisted and appear in audit records; renaming rewrites history.
 */

// ---------------------------------------------------------------------------
// Evaluation — Additional Principle 1 (ADR-013)
// ---------------------------------------------------------------------------

/**
 * NEW (AP-1). The five-valued result of ANY control, gate, readiness or
 * competency evaluation in KuBi.
 *
 * INVARIANT: UNKNOWN and NOT_CONFIGURED must NEVER be coerced to PASS.
 * Enforcement is configured per-outcome; see ENFORCEMENT_MATRIX below.
 *
 * Discriminator between NOT_APPLICABLE and UNKNOWN — the distinction AP-1
 * exists to protect:
 *   NOT_APPLICABLE requires a POSITIVE rule stating the requirement does not
 *                  apply to this entity.
 *   UNKNOWN        is the result whenever information is absent, unreachable
 *                  or unreadable. Absence of information is never N/A.
 */
export const EvaluationResult = {
  PASS: 'PASS',
  FAIL: 'FAIL',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
  UNKNOWN: 'UNKNOWN',
  NOT_CONFIGURED: 'NOT_CONFIGURED',
} as const;
export type EvaluationResult = (typeof EvaluationResult)[keyof typeof EvaluationResult];

/** DERIVED D-04. How a requirement behaves when its evaluation is not PASS. */
export const EnforcementMode = {
  ADVISORY: 'ADVISORY',
  BLOCK_OVERRIDABLE: 'BLOCK_OVERRIDABLE',
  BLOCK_HARD: 'BLOCK_HARD',
} as const;
export type EnforcementMode = (typeof EnforcementMode)[keyof typeof EnforcementMode];

/** What a gate decision permits the caller to do. */
export const GateDecision = {
  PROCEED: 'PROCEED',
  WARN: 'WARN',
  BLOCK_OVERRIDABLE: 'BLOCK_OVERRIDABLE',
  BLOCK_HARD: 'BLOCK_HARD',
} as const;
export type GateDecision = (typeof GateDecision)[keyof typeof GateDecision];

/** NEW D-04. Authority class required to override a BLOCK_OVERRIDABLE gate. */
export const OverrideAuthority = {
  NONE: 'NONE',
  CLINICAL_AUTHORITY: 'CLINICAL_AUTHORITY',
  MANAGEMENT_AUTHORITY: 'MANAGEMENT_AUTHORITY',
  ORGANIZATION_AUTHORITY: 'ORGANIZATION_AUTHORITY',
} as const;
export type OverrideAuthority = (typeof OverrideAuthority)[keyof typeof OverrideAuthority];

/**
 * The enforcement matrix — Phase 0.5 Deliverable 5.
 *
 * Keyed [EnforcementMode][EvaluationResult] -> GateDecision.
 * This table is the executable form of AP-1. Note that in EVERY mode, UNKNOWN
 * and NOT_CONFIGURED behave at least as strictly as FAIL, and under BLOCK_HARD
 * they are non-overridable.
 */
export const ENFORCEMENT_MATRIX: Readonly<
  Record<EnforcementMode, Readonly<Record<EvaluationResult, GateDecision>>>
> = {
  ADVISORY: {
    PASS: 'PROCEED',
    NOT_APPLICABLE: 'PROCEED',
    FAIL: 'WARN',
    UNKNOWN: 'WARN',
    NOT_CONFIGURED: 'WARN',
  },
  BLOCK_OVERRIDABLE: {
    PASS: 'PROCEED',
    NOT_APPLICABLE: 'PROCEED',
    FAIL: 'BLOCK_OVERRIDABLE',
    UNKNOWN: 'BLOCK_OVERRIDABLE',
    NOT_CONFIGURED: 'BLOCK_OVERRIDABLE',
  },
  BLOCK_HARD: {
    PASS: 'PROCEED',
    NOT_APPLICABLE: 'PROCEED',
    FAIL: 'BLOCK_HARD',
    UNKNOWN: 'BLOCK_HARD',
    NOT_CONFIGURED: 'BLOCK_HARD',
  },
} as const;

/**
 * NEW. Gate codes that are structurally non-overridable (D-04, ADR-004).
 * Mirrors config key `safety.immutable_block_hard_gates` at SYSTEM scope.
 * No override permission exists for these in the permission catalogue, so no
 * role can be granted one.
 */
export const IMMUTABLE_BLOCK_HARD_GATES = ['G-05', 'G-07', 'G-14', 'G-15'] as const;

/**
 * Resolve a set of member results to a composite result (gate G-04).
 * The composite NEVER resolves better than its worst member — one unreachable
 * evaluator blocks the whole composite. Precedence: FAIL > UNKNOWN >
 * NOT_CONFIGURED > PASS > NOT_APPLICABLE.
 */
export function resolveComposite(members: readonly EvaluationResult[]): EvaluationResult {
  if (members.length === 0) return EvaluationResult.NOT_CONFIGURED;
  if (members.includes(EvaluationResult.FAIL)) return EvaluationResult.FAIL;
  if (members.includes(EvaluationResult.UNKNOWN)) return EvaluationResult.UNKNOWN;
  if (members.includes(EvaluationResult.NOT_CONFIGURED)) return EvaluationResult.NOT_CONFIGURED;
  if (members.includes(EvaluationResult.PASS)) return EvaluationResult.PASS;
  return EvaluationResult.NOT_APPLICABLE;
}

// ---------------------------------------------------------------------------
// Workflow & activity
// ---------------------------------------------------------------------------

/** DERIVED — FRS §5, Build Pack §4, Matrix v2.0 Enums sheet (all three agree). */
export const ActivityStatus = {
  NOT_DUE: 'NOT_DUE',
  DUE: 'DUE',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  VERIFIED: 'VERIFIED',
  FAILED_VERIFICATION: 'FAILED_VERIFICATION',
  OVERDUE: 'OVERDUE',
  EXCEPTION: 'EXCEPTION',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
  CANCELLED: 'CANCELLED',
} as const;
export type ActivityStatus = (typeof ActivityStatus)[keyof typeof ActivityStatus];

/** DERIVED — all three sources. */
export const Priority = {
  ROUTINE: 'ROUTINE',
  IMPORTANT: 'IMPORTANT',
  CRITICAL: 'CRITICAL',
  PATIENT_SAFETY: 'PATIENT_SAFETY',
} as const;
export type Priority = (typeof Priority)[keyof typeof Priority];

/** DERIVED — all three sources. */
export const TriggerType = {
  TIME: 'TIME',
  EVENT: 'EVENT',
  STATUS_CHANGE: 'STATUS_CHANGE',
  THRESHOLD: 'THRESHOLD',
  DEADLINE: 'DEADLINE',
  DEPENDENCY: 'DEPENDENCY',
  MANUAL: 'MANUAL',
} as const;
export type TriggerType = (typeof TriggerType)[keyof typeof TriggerType];

/** DERIVED — FRS §5. All 6 values observed in Matrix v2.0 column 14. */
export const EvidenceType = {
  SYSTEM: 'SYSTEM',
  CONFIRMATION: 'CONFIRMATION',
  VALUE: 'VALUE',
  ATTACHMENT: 'ATTACHMENT',
  VERIFICATION: 'VERIFICATION',
  SIGNATURE: 'SIGNATURE',
} as const;
export type EvidenceType = (typeof EvidenceType)[keyof typeof EvidenceType];

/** NEW — Phase 0 F-15. Distinguishes engine behaviour from assigned human work. */
export const ExecutionMode = {
  HUMAN: 'HUMAN',
  SYSTEM: 'SYSTEM',
  SYSTEM_WITH_HUMAN_FALLBACK: 'SYSTEM_WITH_HUMAN_FALLBACK',
} as const;
export type ExecutionMode = (typeof ExecutionMode)[keyof typeof ExecutionMode];

/** NEW — Phase 0 F-14. First half of the Matrix "Frequency" column split. */
export const Recurrence = {
  NONE: 'NONE',
  DAILY: 'DAILY',
  WEEKLY: 'WEEKLY',
  MONTHLY: 'MONTHLY',
  QUARTERLY: 'QUARTERLY',
  ANNUAL: 'ANNUAL',
  CONTINUOUS: 'CONTINUOUS',
} as const;
export type Recurrence = (typeof Recurrence)[keyof typeof Recurrence];

/**
 * NEW — Phase 0 F-14. Second half of the "Frequency" split: the entity that
 * gives each activity instance its identity. This value IS the idempotency key
 * component: UNIQUE (definition_id, scope_entity_id, period_key).
 *
 * TREATMENT_PLAN and CONSULTATION are reserved per ADR-011 (Clinic OS) and are
 * intentionally unused in MVP.
 */
export const InstanceScope = {
  CLINIC_DAY: 'CLINIC_DAY',
  PATIENT: 'PATIENT',
  VISIT: 'VISIT',
  APPOINTMENT: 'APPOINTMENT',
  PROCEDURE: 'PROCEDURE',
  SURGERY: 'SURGERY',
  LAB_CASE: 'LAB_CASE',
  STERILIZATION_BATCH: 'STERILIZATION_BATCH',
  IMPLANT: 'IMPLANT',
  STOCK_RECEIPT: 'STOCK_RECEIPT',
  PURCHASE_REQUEST: 'PURCHASE_REQUEST',
  MAINTENANCE_PLAN: 'MAINTENANCE_PLAN',
  BREAKDOWN: 'BREAKDOWN',
  ASSIGNMENT: 'ASSIGNMENT',
  ASSESSMENT: 'ASSESSMENT',
  INCIDENT: 'INCIDENT',
  CAPA: 'CAPA',
  COMPLAINT: 'COMPLAINT',
  AUDIT_FINDING: 'AUDIT_FINDING',
  FOLLOWUP: 'FOLLOWUP',
  EVENT: 'EVENT',
  AD_HOC: 'AD_HOC',
  /** Reserved — ADR-011. Not used in MVP. */
  TREATMENT_PLAN: 'TREATMENT_PLAN',
  /** Reserved — ADR-011. Not used in MVP. */
  CONSULTATION: 'CONSULTATION',
} as const;
export type InstanceScope = (typeof InstanceScope)[keyof typeof InstanceScope];

/** NEW — Phase 0 F-13. Grammar for the 61 free-text Matrix "Due Rule" strings. */
export const DueRuleKind = {
  CLOCK: 'CLOCK',
  CLINIC_EVENT: 'CLINIC_EVENT',
  EVENT_RELATIVE: 'EVENT_RELATIVE',
  PERIOD_END: 'PERIOD_END',
  IMMEDIATE: 'IMMEDIATE',
  /** Defers to a Configuration Key Registry entry. Unset => load-time warning. */
  CONFIG_REF: 'CONFIG_REF',
} as const;
export type DueRuleKind = (typeof DueRuleKind)[keyof typeof DueRuleKind];

/** DERIVED D-07. Segregation-of-duties policy per activity definition. */
export const SodPolicy = {
  STRICT: 'STRICT',
  OVERRIDABLE: 'OVERRIDABLE',
  NOT_REQUIRED: 'NOT_REQUIRED',
} as const;
export type SodPolicy = (typeof SodPolicy)[keyof typeof SodPolicy];

/** DERIVED — Matrix v2.0 column 23. Was undeclared in the v2.0 Enums sheet. */
export const CapaRequirement = {
  NONE: 'NONE',
  REQUIRED_ON_REPEAT: 'REQUIRED_ON_REPEAT',
  REQUIRED_ON_CRITICAL: 'REQUIRED_ON_CRITICAL',
  ALWAYS: 'ALWAYS',
} as const;
export type CapaRequirement = (typeof CapaRequirement)[keyof typeof CapaRequirement];

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

/** DERIVED FRS §5, extended with UNKNOWN per AP-1. */
export const ReadinessStatus = {
  PENDING: 'PENDING',
  READY: 'READY',
  PARTIAL: 'PARTIAL',
  NOT_READY: 'NOT_READY',
  /** NEW — AP-1. Readiness could not be determined. Never treated as READY. */
  UNKNOWN: 'UNKNOWN',
  OVERRIDDEN: 'OVERRIDDEN',
} as const;
export type ReadinessStatus = (typeof ReadinessStatus)[keyof typeof ReadinessStatus];

// ---------------------------------------------------------------------------
// Identity, authority & assignment — Phase 1 control 6
// ---------------------------------------------------------------------------

/**
 * NEW — Phase 0.5 D2 finding. Matrix v2.0 uses 71 distinct actor tokens for
 * 12 roles; they are not all roles. This enum keeps the kinds distinct, which
 * Phase 1 control 6 requires.
 */
export const ActorRefKind = {
  /** A standing job with a permission bundle, assigned per clinic. */
  ROLE: 'ROLE',
  /** A position relative to the record in hand. Carries no standing permission. */
  RECORD_RELATION: 'RECORD_RELATION',
  /** A named clinic responsibility, independent of role. */
  FUNCTIONAL_ASSIGNMENT: 'FUNCTIONAL_ASSIGNMENT',
  /** Not an actor — engine execution. */
  SYSTEM: 'SYSTEM',
  /** Not a KuBi user. Recorded as a party; holds no permission. */
  EXTERNAL: 'EXTERNAL',
} as const;
export type ActorRefKind = (typeof ActorRefKind)[keyof typeof ActorRefKind];

/** DERIVED — FRS §3. Senior/Dental Assistant split; v2.0 distinguishes them throughout. */
export const RoleCode = {
  OWNER_DIRECTOR: 'OWNER_DIRECTOR',
  CLINIC_HEAD: 'CLINIC_HEAD',
  CLINICAL_DIRECTOR: 'CLINICAL_DIRECTOR',
  TREATING_DOCTOR: 'TREATING_DOCTOR',
  CLINIC_MANAGER: 'CLINIC_MANAGER',
  RECEPTION: 'RECEPTION',
  SENIOR_ASSISTANT: 'SENIOR_ASSISTANT',
  DENTAL_ASSISTANT: 'DENTAL_ASSISTANT',
  INVENTORY_COORDINATOR: 'INVENTORY_COORDINATOR',
  LAB_COORDINATOR: 'LAB_COORDINATOR',
  QUALITY_COMPLIANCE: 'QUALITY_COMPLIANCE',
  HOUSEKEEPING: 'HOUSEKEEPING',
  SYSTEM_ADMINISTRATOR: 'SYSTEM_ADMINISTRATOR',
} as const;
export type RoleCode = (typeof RoleCode)[keyof typeof RoleCode];

/**
 * NEW. Permission class determines what checks run BEYOND the grant itself.
 * This is the mechanism that keeps SYSTEM_ADMINISTRATOR away from clinical
 * authority (FRS §3, Phase 1 control 8).
 */
export const PermissionClass = {
  STANDARD: 'STANDARD',
  /** Requires employee.clinical_authority in addition to the grant. */
  CLINICAL: 'CLINICAL',
  /** Requires clinical authority + reason + audit + notification + exception. */
  SAFETY_OVERRIDE: 'SAFETY_OVERRIDE',
  /** Requires MFA re-assertion. */
  ADMIN: 'ADMIN',
  /** Time-boxed, Owner-notified, separately audited. Never a standing grant. */
  BREAK_GLASS: 'BREAK_GLASS',
} as const;
export type PermissionClass = (typeof PermissionClass)[keyof typeof PermissionClass];

/**
 * NEW — Phase 1 control 8. Roles that may NEVER hold a SAFETY_OVERRIDE or
 * CLINICAL permission, regardless of grant. Enforced at role-definition
 * validation time, not at call time.
 */
export const ROLES_DENIED_CLINICAL_AUTHORITY: readonly RoleCode[] = [
  RoleCode.SYSTEM_ADMINISTRATOR,
] as const;

/** DERIVED Build Pack §4. */
export const CompetencyLevel = {
  NOT_TRAINED: 'NOT_TRAINED',
  TRAINED: 'TRAINED',
  SUPERVISED: 'SUPERVISED',
  INDEPENDENT: 'INDEPENDENT',
  TRAINER: 'TRAINER',
} as const;
export type CompetencyLevel = (typeof CompetencyLevel)[keyof typeof CompetencyLevel];

/** Ordered ranking for competency comparison (G-09). Higher satisfies lower. */
export const COMPETENCY_RANK: Readonly<Record<CompetencyLevel, number>> = {
  NOT_TRAINED: 0,
  TRAINED: 1,
  SUPERVISED: 2,
  INDEPENDENT: 3,
  TRAINER: 4,
} as const;

// ---------------------------------------------------------------------------
// Exceptions, escalation, notification
// ---------------------------------------------------------------------------

/** DERIVED — all three sources. */
export const ExceptionStatus = {
  OPEN: 'OPEN',
  ACKNOWLEDGED: 'ACKNOWLEDGED',
  ACTION_IN_PROGRESS: 'ACTION_IN_PROGRESS',
  RESOLVED: 'RESOLVED',
  VERIFIED: 'VERIFIED',
  CLOSED: 'CLOSED',
} as const;
export type ExceptionStatus = (typeof ExceptionStatus)[keyof typeof ExceptionStatus];

/** DERIVED — mirrors Priority. */
export const ExceptionSeverity = Priority;
export type ExceptionSeverity = Priority;

/** NEW — Phase 0.5 Deliverable 6. Second segment of MODULE.CATEGORY.REASON. */
export const ExceptionCategory = {
  OVERDUE: 'OVERDUE',
  VERIFICATION_FAILED: 'VERIFICATION_FAILED',
  GATE_BLOCKED: 'GATE_BLOCKED',
  GATE_OVERRIDDEN: 'GATE_OVERRIDDEN',
  /**
   * NEW — AP-1. Its own category, deliberately not a flavour of FAIL: a
   * recurring UNKNOWN is a systems defect whose CAPA is engineering, whereas a
   * recurring FAIL is a behaviour problem whose CAPA is training.
   */
  EVALUATION_UNKNOWN: 'EVALUATION_UNKNOWN',
  SLA_BREACH: 'SLA_BREACH',
  THRESHOLD_BREACH: 'THRESHOLD_BREACH',
  PHYSICAL_FAILURE: 'PHYSICAL_FAILURE',
  DATA_INCOMPLETE: 'DATA_INCOMPLETE',
  UNAUTHORIZED_ATTEMPT: 'UNAUTHORIZED_ATTEMPT',
  AUTOMATION_FAILURE: 'AUTOMATION_FAILURE',
  /** Terminal — raised by A30. Does not itself count toward recurrence. */
  RECURRENCE: 'RECURRENCE',
} as const;
export type ExceptionCategory = (typeof ExceptionCategory)[keyof typeof ExceptionCategory];

/** NEW — Deliverable 6. First segment of MODULE.CATEGORY.REASON. */
export const ExceptionModule = {
  ATT: 'ATT', OPN: 'OPN', APT: 'APT', CLN: 'CLN', FUP: 'FUP',
  LAB: 'LAB', STER: 'STER', INV: 'INV', IMP: 'IMP', EQP: 'EQP',
  EMR: 'EMR', TRN: 'TRN', CON: 'CON', CMP: 'CMP', INC: 'INC',
  AUD: 'AUD', CLS: 'CLS', SYS: 'SYS',
} as const;
export type ExceptionModule = (typeof ExceptionModule)[keyof typeof ExceptionModule];

/** DERIVED Build Pack §6. */
export const EscalationLevel = {
  INITIAL: 'INITIAL',
  L1: 'L1',
  L2: 'L2',
  L3: 'L3',
} as const;
export type EscalationLevel = (typeof EscalationLevel)[keyof typeof EscalationLevel];

/** DERIVED FRS §5. */
export const NotificationPriority = {
  P1: 'P1',
  P2: 'P2',
  P3: 'P3',
  P4: 'P4',
} as const;
export type NotificationPriority = (typeof NotificationPriority)[keyof typeof NotificationPriority];

/** DERIVED D-10. IN_APP is the system of record for system notifications. */
export const NotificationChannel = {
  IN_APP: 'IN_APP',
  WHATSAPP: 'WHATSAPP',
  SMS: 'SMS',
  EMAIL: 'EMAIL',
  VOICE: 'VOICE',
} as const;
export type NotificationChannel = (typeof NotificationChannel)[keyof typeof NotificationChannel];

// ---------------------------------------------------------------------------
// Patient, consent & scheduling
// ---------------------------------------------------------------------------

/** NEW — Phase 0 F-10, D-10. Consent is typed by purpose, separately revocable. */
export const ConsentType = {
  CLINICAL_PROCEDURE: 'CLINICAL_PROCEDURE',
  DATA_PROCESSING: 'DATA_PROCESSING',
  COMMUNICATION_CHANNEL: 'COMMUNICATION_CHANNEL',
  MARKETING: 'MARKETING',
  IMAGE_USE: 'IMAGE_USE',
} as const;
export type ConsentType = (typeof ConsentType)[keyof typeof ConsentType];

/** DERIVED FRS §6. */
export const AppointmentStatus = {
  SCHEDULED: 'SCHEDULED',
  CONFIRMED: 'CONFIRMED',
  ARRIVED: 'ARRIVED',
  WAITING: 'WAITING',
  SEATED: 'SEATED',
  IN_TREATMENT: 'IN_TREATMENT',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  RESCHEDULED: 'RESCHEDULED',
  NO_SHOW: 'NO_SHOW',
} as const;
export type AppointmentStatus = (typeof AppointmentStatus)[keyof typeof AppointmentStatus];

/**
 * DECISION — OD-06 OPEN. Build Pack §5 names only SURGERY and IMPLANT_SURGERY.
 * The remaining values are PROPOSED and awaiting owner confirmation. They are
 * declared here so the type exists, but no procedure protocol may be seeded
 * against an unconfirmed category.
 */
export const ProcedureCategory = {
  CONSULTATION: 'CONSULTATION',
  DIAGNOSTIC: 'DIAGNOSTIC',
  PREVENTIVE: 'PREVENTIVE',
  RESTORATIVE: 'RESTORATIVE',
  ENDODONTIC: 'ENDODONTIC',
  PERIODONTAL: 'PERIODONTAL',
  PROSTHETIC: 'PROSTHETIC',
  ORTHODONTIC: 'ORTHODONTIC',
  SURGERY: 'SURGERY',
  IMPLANT_SURGERY: 'IMPLANT_SURGERY',
  EMERGENCY: 'EMERGENCY',
} as const;
export type ProcedureCategory = (typeof ProcedureCategory)[keyof typeof ProcedureCategory];

/** DERIVED Build Pack §5 — the only two categories the sources confirm. */
export const CONFIRMED_PROCEDURE_CATEGORIES: readonly ProcedureCategory[] = [
  ProcedureCategory.SURGERY,
  ProcedureCategory.IMPLANT_SURGERY,
] as const;

/** NEW D-05. */
export const AllergySeverity = {
  MILD: 'MILD',
  MODERATE: 'MODERATE',
  SEVERE: 'SEVERE',
  ANAPHYLACTIC: 'ANAPHYLACTIC',
} as const;
export type AllergySeverity = (typeof AllergySeverity)[keyof typeof AllergySeverity];

/** DERIVED FUP-002 / FUP-003. */
export const FollowupOutcome = {
  PENDING: 'PENDING',
  CONTACTED_WELL: 'CONTACTED_WELL',
  CONTACTED_CONCERN: 'CONTACTED_CONCERN',
  RED_FLAG: 'RED_FLAG',
  NO_RESPONSE: 'NO_RESPONSE',
  REFUSED: 'REFUSED',
  ESCALATED: 'ESCALATED',
} as const;
export type FollowupOutcome = (typeof FollowupOutcome)[keyof typeof FollowupOutcome];

// ---------------------------------------------------------------------------
// Operations (Phase 2 — declared now so due rules and gates resolve)
// ---------------------------------------------------------------------------

/** DERIVED Build Pack §4. */
export const AssetStatus = {
  OPERATIONAL: 'OPERATIONAL',
  RESTRICTED: 'RESTRICTED',
  OUT_OF_SERVICE: 'OUT_OF_SERVICE',
  UNDER_REPAIR: 'UNDER_REPAIR',
  RETIRED: 'RETIRED',
} as const;
export type AssetStatus = (typeof AssetStatus)[keyof typeof AssetStatus];

/** DERIVED STER-001…006. */
export const SterilizationStage = {
  COLLECTED: 'COLLECTED',
  ULTRASONIC: 'ULTRASONIC',
  INSPECTED: 'INSPECTED',
  PACKED: 'PACKED',
  AUTOCLAVED: 'AUTOCLAVED',
  VERIFIED: 'VERIFIED',
  RELEASED: 'RELEASED',
  QUARANTINED: 'QUARANTINED',
  FAILED: 'FAILED',
} as const;
export type SterilizationStage = (typeof SterilizationStage)[keyof typeof SterilizationStage];

/**
 * DERIVED STER-004, extended with INCONCLUSIVE per AP-1 (correction C-08).
 * A two-valued result forces an unreadable indicator to become PASS or FAIL by
 * default; the first is a patient-safety failure, the second destroys a valid
 * batch. INCONCLUSIVE maps to EvaluationResult.UNKNOWN at gate G-05 and holds
 * the batch in QUARANTINED.
 */
export const CycleResult = {
  PASS: 'PASS',
  FAIL: 'FAIL',
  INCONCLUSIVE: 'INCONCLUSIVE',
} as const;
export type CycleResult = (typeof CycleResult)[keyof typeof CycleResult];

/** DERIVED LAB-001…007, A11. */
export const LabCaseStatus = {
  CREATED: 'CREATED',
  DISPATCHED: 'DISPATCHED',
  IN_PROGRESS_VENDOR: 'IN_PROGRESS_VENDOR',
  RECEIVED_CLINIC: 'RECEIVED_CLINIC',
  QC_PENDING: 'QC_PENDING',
  QC_PASSED: 'QC_PASSED',
  QC_FAILED: 'QC_FAILED',
  REMAKE: 'REMAKE',
  PATIENT_READY: 'PATIENT_READY',
  DELIVERED: 'DELIVERED',
  CANCELLED: 'CANCELLED',
} as const;
export type LabCaseStatus = (typeof LabCaseStatus)[keyof typeof LabCaseStatus];

/** DERIVED INV-002 / INV-003 / INV-008. */
export const StockTransactionType = {
  RECEIPT: 'RECEIPT',
  ISSUE: 'ISSUE',
  RETURN: 'RETURN',
  ADJUSTMENT: 'ADJUSTMENT',
  WRITE_OFF: 'WRITE_OFF',
  TRANSFER_IN: 'TRANSFER_IN',
  TRANSFER_OUT: 'TRANSFER_OUT',
  EXPIRY_WRITE_OFF: 'EXPIRY_WRITE_OFF',
} as const;
export type StockTransactionType =
  (typeof StockTransactionType)[keyof typeof StockTransactionType];

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** NEW — Phase 0 §15. Resolution chain, most specific first. */
export const ConfigScope = {
  ACTIVITY: 'ACTIVITY',
  PROCEDURE: 'PROCEDURE',
  ROLE: 'ROLE',
  CLINIC: 'CLINIC',
  ORGANIZATION: 'ORGANIZATION',
  /** Platform-only. No write path is exposed in any API. */
  SYSTEM: 'SYSTEM',
} as const;
export type ConfigScope = (typeof ConfigScope)[keyof typeof ConfigScope];

/** Ordered resolution chain — first non-null wins. */
export const CONFIG_RESOLUTION_ORDER: readonly ConfigScope[] = [
  ConfigScope.ACTIVITY,
  ConfigScope.PROCEDURE,
  ConfigScope.ROLE,
  ConfigScope.CLINIC,
  ConfigScope.ORGANIZATION,
  ConfigScope.SYSTEM,
] as const;

/** NEW — Deliverable 8. Provenance marker carried by every seeded register row. */
export const Provenance = {
  DERIVED: 'DERIVED',
  DECISION_REQUIRED: 'DECISION_REQUIRED',
  NOT_SPECIFIED: 'NOT_SPECIFIED',
  NEW: 'NEW',
} as const;
export type Provenance = (typeof Provenance)[keyof typeof Provenance];

// ---------------------------------------------------------------------------
// Phase 2 — functional assignments
// ---------------------------------------------------------------------------

/**
 * NEW — Phase 2. The 9 FUNCTIONAL_ASSIGNMENT tokens identified in Phase 0.5
 * D2 as per-clinic responsibilities, distinct from standing roles. Deriving
 * activity Doer/Checker/Owner grants FROM these is Workflow/Assignment engine
 * work (Phase 3+); Phase 2 only establishes the data model and evaluator.
 */
export const FunctionalAssignmentType = {
  EQUIPMENT_OWNER: 'EQUIPMENT_OWNER',
  IMPLANT_COORDINATOR: 'IMPLANT_COORDINATOR',
  TRAINER: 'TRAINER',
  QUALIFIED_ASSESSOR: 'QUALIFIED_ASSESSOR',
  APPROVER: 'APPROVER',
  RECEPTION_LEAD: 'RECEPTION_LEAD',
  CLINICAL_LEAD: 'CLINICAL_LEAD',
  /**
   * OD-03 Q4: represented as a functional/competency-based authorization,
   * NOT a generic RBAC role. `scopeRef` on FunctionalAssignment may narrow
   * this to a specific equipment category; absence of a category-specific
   * grant means the evaluator returns NOT_CONFIGURED, never PASS.
   */
  QUALIFIED_VERIFIER: 'QUALIFIED_VERIFIER',
  ASSIGNED_ASSISTANT: 'ASSIGNED_ASSISTANT',
} as const;
export type FunctionalAssignmentType =
  (typeof FunctionalAssignmentType)[keyof typeof FunctionalAssignmentType];

/** Registry of every enum in this file, for the contract-drift test. */
export const ENUM_REGISTER = {
  EvaluationResult, EnforcementMode, GateDecision, OverrideAuthority,
  ActivityStatus, Priority, TriggerType, EvidenceType, ExecutionMode,
  Recurrence, InstanceScope, DueRuleKind, SodPolicy, CapaRequirement,
  ReadinessStatus, ActorRefKind, RoleCode, PermissionClass, CompetencyLevel,
  ExceptionStatus, ExceptionCategory, ExceptionModule, EscalationLevel,
  NotificationPriority, NotificationChannel, ConsentType, AppointmentStatus,
  ProcedureCategory, AllergySeverity, FollowupOutcome, AssetStatus,
  SterilizationStage, CycleResult, LabCaseStatus, StockTransactionType,
  ConfigScope, Provenance, FunctionalAssignmentType,
} as const;
