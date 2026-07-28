/**
 * KuBi — the five Matrix v2.0 Clinic Opening activities, normalised.
 *
 * Matrix v2.0 is FROZEN and unmodified. This file is the mapping described in
 * the Phase 0.5 normalization spec: Matrix columns → runtime configuration.
 * Where the Matrix text was written for auditors, `title` is rewritten in
 * clinic language for the person doing the work; `standardText` preserves the
 * Matrix wording verbatim.
 *
 * OD-19: due rules use CLINIC_EVENT with a TEMPORARY_FALLBACK marker where
 * the Matrix says "Before first patient" — there is no appointment data yet.
 * Replace with the real first-appointment anchor when appointments land.
 * The marker exists so this cannot silently become permanent business logic.
 *
 * OD-02 + OD-21: selfVerifyAllowed is true for OPN-003 and OPN-004 only.
 */
import {
  Priority, ExecutionMode, Recurrence, InstanceScope, DueRuleKind, SodPolicy,
  EvidenceType, CapaRequirement, RoleCode, FunctionalAssignmentType,
} from '@kubi/contracts';

export interface ChecklistItemSeed {
  label: string;
  requiresValue?: boolean;
  valueUnit?: string;
  valueMin?: number;
  valueMax?: number;
}

export interface ActivityDefinitionSeed {
  code: string;
  title: string;
  standardText: string;
  process: string;
  priority: string;
  executionMode: string;
  recurrence: string;
  instanceScope: string;
  dueRule: Record<string, unknown>;
  assignmentRule: {
    doer: { kind: string; value: string | string[] };
    checker: { kind: string; value: string | string[] };
    owner: { kind: string; value: string };
  };
  sodPolicy: string;
  selfVerifyAllowed: boolean;
  evidenceType: string;
  gateRequirement: string | null;
  gateEnforcementConfigKey: string | null;
  failureDefinition: string;
  escalationPolicy: string;
  capaPolicy: string;
  checklist: ChecklistItemSeed[];
  /** Matrix provenance, carried for audit. */
  matrixRef: string;
}

/** OD-19 temporary fallback: opening time + 15 minutes. */
const BEFORE_FIRST_PATIENT = {
  kind: DueRuleKind.CLINIC_EVENT,
  anchor: 'OPENING',
  offsetMinutes: 15,
  provenance: 'TEMPORARY_FALLBACK',
  note: 'OD-19: "Before first patient" has no appointment anchor yet. Replace when appointment integration lands. Do not treat as permanent policy.',
} as const;

const AT_OPENING = {
  kind: DueRuleKind.CLINIC_EVENT,
  anchor: 'OPENING',
  offsetMinutes: 0,
} as const;

export const OPENING_ACTIVITIES: readonly ActivityDefinitionSeed[] = [
  {
    code: 'OPN-001',
    title: 'Open the clinic',
    standardText: 'Required clinic areas opened before first patient',
    process: 'Opening Readiness',
    priority: Priority.CRITICAL,
    executionMode: ExecutionMode.HUMAN,
    recurrence: Recurrence.DAILY,
    instanceScope: InstanceScope.CLINIC_DAY,
    dueRule: { ...BEFORE_FIRST_PATIENT },
    assignmentRule: {
      doer: { kind: 'FUNCTIONAL_ASSIGNMENT', value: FunctionalAssignmentType.ASSIGNED_ASSISTANT },
      checker: { kind: 'ROLE', value: RoleCode.CLINIC_MANAGER },
      owner: { kind: 'ROLE', value: RoleCode.CLINIC_HEAD },
    },
    sodPolicy: SodPolicy.STRICT,
    selfVerifyAllowed: false,
    evidenceType: EvidenceType.CONFIRMATION,
    gateRequirement: null,
    gateEnforcementConfigKey: null,
    failureDefinition: 'Area not opened',
    escalationPolicy: 'CRITICAL_DEFAULT',
    capaPolicy: CapaRequirement.REQUIRED_ON_REPEAT,
    matrixRef: 'Matrix v2.0 OPN-001',
    checklist: [
      { label: 'Main entrance and shutters open' },
      { label: 'All floors unlocked and lit' },
      { label: 'Water supply running' },
      { label: 'Power and backup checked' },
      { label: 'Waiting area ready for patients' },
    ],
  },
  {
    code: 'OPN-002',
    title: 'Get treatment rooms ready',
    standardText: 'All scheduled operatories clean, stocked and functional',
    process: 'Opening Readiness',
    priority: Priority.CRITICAL,
    executionMode: ExecutionMode.HUMAN,
    recurrence: Recurrence.DAILY,
    instanceScope: InstanceScope.CLINIC_DAY,
    dueRule: { ...BEFORE_FIRST_PATIENT },
    assignmentRule: {
      doer: { kind: 'ROLE', value: RoleCode.DENTAL_ASSISTANT },
      checker: { kind: 'ROLE', value: RoleCode.SENIOR_ASSISTANT },
      owner: { kind: 'ROLE', value: RoleCode.CLINIC_MANAGER },
    },
    sodPolicy: SodPolicy.STRICT,
    selfVerifyAllowed: false,
    evidenceType: EvidenceType.CONFIRMATION,
    // Matrix dependency "Chair/equipment status" — the equipment module does
    // not exist in VS-01, so this resolves NOT_CONFIGURED, never PASS (AP-1).
    gateRequirement: 'CHAIR_EQUIPMENT_STATUS',
    gateEnforcementConfigKey: 'opening.chair_equipment_enforcement',
    failureDefinition: 'Room not ready',
    escalationPolicy: 'CRITICAL_DEFAULT',
    capaPolicy: CapaRequirement.REQUIRED_ON_REPEAT,
    matrixRef: 'Matrix v2.0 OPN-002',
    checklist: [
      { label: 'Surfaces cleaned and disinfected' },
      { label: 'Chair and light working' },
      { label: 'Suction working' },
      { label: 'Instrument tray laid out' },
      { label: 'Consumables stocked' },
    ],
  },
  {
    code: 'OPN-003',
    title: 'Get reception ready',
    standardText: 'Phones, appointment list, payment/reception systems ready',
    process: 'Opening Readiness',
    priority: Priority.IMPORTANT,
    executionMode: ExecutionMode.HUMAN,
    recurrence: Recurrence.DAILY,
    instanceScope: InstanceScope.CLINIC_DAY,
    dueRule: { ...BEFORE_FIRST_PATIENT },
    assignmentRule: {
      doer: { kind: 'ROLE', value: RoleCode.RECEPTION },
      checker: { kind: 'FUNCTIONAL_ASSIGNMENT', value: FunctionalAssignmentType.RECEPTION_LEAD },
      owner: { kind: 'ROLE', value: RoleCode.CLINIC_MANAGER },
    },
    // OD-02 APPROVED: self-verification permitted.
    sodPolicy: SodPolicy.OVERRIDABLE,
    selfVerifyAllowed: true,
    evidenceType: EvidenceType.CONFIRMATION,
    gateRequirement: null,
    gateEnforcementConfigKey: null,
    failureDefinition: 'Reception not ready',
    escalationPolicy: 'IMPORTANT_DEFAULT',
    capaPolicy: CapaRequirement.REQUIRED_ON_REPEAT,
    matrixRef: 'Matrix v2.0 OPN-003',
    checklist: [
      { label: 'Phones working' },
      { label: "Today's appointment list open" },
      { label: 'Payment terminal working' },
      { label: 'Reception desk tidy and stocked' },
    ],
  },
  {
    code: 'OPN-004',
    title: 'Set up the clinic environment',
    standardText: 'AC 24°C where applicable, diffuser/lights as schedule',
    process: 'Opening Readiness',
    priority: Priority.ROUTINE,
    executionMode: ExecutionMode.HUMAN,
    recurrence: Recurrence.DAILY,
    instanceScope: InstanceScope.CLINIC_DAY,
    dueRule: { ...AT_OPENING },
    assignmentRule: {
      // OD-03 interpretation A: either may perform.
      doer: { kind: 'ANY_ROLE', value: [RoleCode.HOUSEKEEPING, RoleCode.DENTAL_ASSISTANT] },
      checker: { kind: 'ROLE', value: RoleCode.CLINIC_MANAGER },
      owner: { kind: 'ROLE', value: RoleCode.CLINIC_MANAGER },
    },
    // OD-21 APPROVED: routine environment reading does not need daily manager
    // counter-verification. Abnormal readings still raise Attention.
    sodPolicy: SodPolicy.OVERRIDABLE,
    selfVerifyAllowed: true,
    evidenceType: EvidenceType.VALUE,
    gateRequirement: null,
    gateEnforcementConfigKey: null,
    failureDefinition: 'Environment outside standard',
    escalationPolicy: 'ROUTINE_DEFAULT',
    capaPolicy: CapaRequirement.NONE,
    matrixRef: 'Matrix v2.0 OPN-004',
    checklist: [
      { label: 'Air conditioning set', requiresValue: true, valueUnit: '°C', valueMin: 22, valueMax: 26 },
      { label: 'Lights on as per schedule' },
      { label: 'Diffuser on' },
    ],
  },
  {
    code: 'OPN-005',
    title: 'Check the emergency kit',
    standardText: 'Emergency equipment/critical items available and accessible',
    process: 'Opening Readiness',
    priority: Priority.PATIENT_SAFETY,
    executionMode: ExecutionMode.HUMAN,
    recurrence: Recurrence.DAILY,
    instanceScope: InstanceScope.CLINIC_DAY,
    dueRule: { ...AT_OPENING },
    assignmentRule: {
      doer: { kind: 'FUNCTIONAL_ASSIGNMENT', value: FunctionalAssignmentType.ASSIGNED_ASSISTANT },
      // OD-03 interpretation A: either may check.
      checker: { kind: 'ANY_ROLE', value: [RoleCode.TREATING_DOCTOR, RoleCode.CLINIC_MANAGER] },
      owner: { kind: 'ROLE', value: RoleCode.CLINICAL_DIRECTOR },
    },
    // PATIENT_SAFETY: never self-verifiable, regardless of roster.
    sodPolicy: SodPolicy.STRICT,
    selfVerifyAllowed: false,
    evidenceType: EvidenceType.VERIFICATION,
    // Matrix dependency "Emergency inventory" — no emergency master exists in
    // VS-01, so this resolves NOT_CONFIGURED. OD-20: enforcement is read from
    // config (BLOCK_OVERRIDABLE against clinic-open status), never hard-coded.
    gateRequirement: 'EMERGENCY_INVENTORY',
    gateEnforcementConfigKey: 'opening.emergency_readiness_enforcement',
    failureDefinition: 'Critical emergency item unavailable',
    escalationPolicy: 'PATIENT_SAFETY_DEFAULT',
    capaPolicy: CapaRequirement.REQUIRED_ON_CRITICAL,
    matrixRef: 'Matrix v2.0 OPN-005',
    checklist: [
      { label: 'Emergency kit present and sealed' },
      { label: 'Oxygen cylinder available and pressure adequate' },
      { label: 'Adrenaline in date' },
      { label: 'Emergency contact list visible' },
    ],
  },
] as const;

/**
 * OD-23 escalation defaults. Configuration-driven, NOT product constants —
 * seeded into config_value so a clinic can change them without a deploy.
 */
export const ESCALATION_DEFAULTS = {
  PATIENT_SAFETY: { escalateAfterMinutes: 60, respectsBusinessHours: false, notifyImmediately: true },
  CRITICAL: { escalateAfterMinutes: 120, respectsBusinessHours: true, notifyImmediately: true },
  IMPORTANT: { escalateAfterMinutes: 1440, respectsBusinessHours: true, notifyImmediately: false },
  ROUTINE: { escalateAfterMinutes: 4320, respectsBusinessHours: true, notifyImmediately: false },
} as const;
