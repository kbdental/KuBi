/**
 * VS-03 — Clinic Closing, the other half of the day.
 *
 * Opening asks "are we ready to start?". Closing asks a harder question:
 * "is it safe to walk away, and what does tomorrow inherit?" That second half
 * is the part a paper checklist never captures and the part an inspector
 * actually asks about.
 *
 * Same engine as opening — no new machinery. The differences that matter are
 * in the rules, not the code:
 *
 *   - Sterilisation and the drugs cupboard are checked by someone other than
 *     the person who did them, always. Neither is on the self-verify
 *     allowlist, whatever the roster looks like.
 *   - Securing the premises is the LAST thing and is nobody's to self-confirm:
 *     the whole point of a closing check is that a second person agrees the
 *     building is safe to leave.
 *   - The waste and drugs checks are PATIENT_SAFETY, not housekeeping. They
 *     look mundane and are the two that hurt when missed.
 */
import {
  Priority, ExecutionMode, Recurrence, InstanceScope, DueRuleKind, SodPolicy,
  EvidenceType, CapaRequirement, RoleCode, FunctionalAssignmentType, Parameter,
} from '@kubi/contracts';
import type { ActivityDefinitionSeed } from './opening-activities.js';

/**
 * Closing work is anchored to the clinic's closing time, the same way opening
 * is anchored to its opening time. Negative offsets mean "before we close" —
 * a sterilisation run started at closing time is a run nobody waits for.
 */
const BEFORE_CLOSE = (minutes: number) => ({
  kind: DueRuleKind.CLINIC_EVENT,
  anchor: 'CLOSING',
  offsetMinutes: -minutes,
});

const AT_CLOSE = {
  kind: DueRuleKind.CLINIC_EVENT,
  anchor: 'CLOSING',
  offsetMinutes: 0,
} as const;

export const CLOSING_ACTIVITIES: readonly ActivityDefinitionSeed[] = [
  {
    code: 'CLS-001',
    parameter: Parameter.INFECTION_CONTROL,
    title: 'Finish the sterilisation run',
    standardText: 'All used instruments processed, cycle recorded, nothing left in the dirty zone overnight',
    process: 'Closing Readiness',
    priority: Priority.PATIENT_SAFETY,
    executionMode: ExecutionMode.HUMAN,
    recurrence: Recurrence.DAILY,
    instanceScope: InstanceScope.CLINIC_DAY,
    dueRule: { ...BEFORE_CLOSE(45) },
    assignmentRule: {
      doer: { kind: 'FUNCTIONAL_ASSIGNMENT', value: FunctionalAssignmentType.ASSIGNED_ASSISTANT },
      checker: { kind: 'ANY_ROLE', value: [RoleCode.SENIOR_ASSISTANT, RoleCode.CLINIC_MANAGER] },
      owner: { kind: 'ROLE', value: RoleCode.CLINICAL_DIRECTOR },
    },
    // Instruments left unprocessed overnight is tomorrow's problem arriving
    // as today's shortcut. Never self-confirmed.
    sodPolicy: SodPolicy.STRICT,
    selfVerifyAllowed: false,
    evidenceType: EvidenceType.VERIFICATION,
    gateRequirement: null,
    gateEnforcementConfigKey: null,
    failureDefinition: 'Instruments left unprocessed or cycle not recorded',
    escalationPolicy: 'PATIENT_SAFETY_DEFAULT',
    capaPolicy: CapaRequirement.REQUIRED_ON_CRITICAL,
    matrixRef: 'VS-03 closing set',
    checklist: [
      { label: 'All used instruments through the cycle' },
      { label: 'Cycle result recorded' },
      { label: 'Dirty zone empty' },
      { label: 'Autoclave switched off' },
    ],
  },
  {
    code: 'CLS-002',
    parameter: Parameter.SAFETY_EMERGENCY,
    title: 'Lock up the drugs cupboard',
    standardText: 'Controlled and emergency drugs counted against the register, cupboard locked, keys accounted for',
    process: 'Closing Readiness',
    priority: Priority.PATIENT_SAFETY,
    executionMode: ExecutionMode.HUMAN,
    recurrence: Recurrence.DAILY,
    instanceScope: InstanceScope.CLINIC_DAY,
    dueRule: { ...BEFORE_CLOSE(30) },
    assignmentRule: {
      doer: { kind: 'ROLE', value: RoleCode.SENIOR_ASSISTANT },
      checker: { kind: 'ROLE', value: RoleCode.CLINIC_MANAGER },
      owner: { kind: 'ROLE', value: RoleCode.CLINICAL_DIRECTOR },
    },
    sodPolicy: SodPolicy.STRICT,
    selfVerifyAllowed: false,
    evidenceType: EvidenceType.VERIFICATION,
    gateRequirement: null,
    gateEnforcementConfigKey: null,
    failureDefinition: 'Count does not match the register, or cupboard left unlocked',
    escalationPolicy: 'PATIENT_SAFETY_DEFAULT',
    capaPolicy: CapaRequirement.REQUIRED_ON_CRITICAL,
    matrixRef: 'VS-03 closing set',
    checklist: [
      { label: 'Count matches the register' },
      { label: 'Cupboard locked' },
      { label: 'Keys back in the safe' },
    ],
  },
  {
    code: 'CLS-003',
    parameter: Parameter.INFECTION_CONTROL,
    title: 'Clear the day’s waste',
    standardText: 'Clinical and sharps waste bagged, labelled and moved to the store; nothing left in treatment rooms',
    process: 'Closing Readiness',
    priority: Priority.CRITICAL,
    executionMode: ExecutionMode.HUMAN,
    recurrence: Recurrence.DAILY,
    instanceScope: InstanceScope.CLINIC_DAY,
    dueRule: { ...BEFORE_CLOSE(30) },
    assignmentRule: {
      doer: { kind: 'ROLE', value: RoleCode.HOUSEKEEPING },
      checker: { kind: 'ROLE', value: RoleCode.SENIOR_ASSISTANT },
      owner: { kind: 'ROLE', value: RoleCode.CLINIC_MANAGER },
    },
    sodPolicy: SodPolicy.OVERRIDABLE,
    selfVerifyAllowed: false,
    evidenceType: EvidenceType.CONFIRMATION,
    gateRequirement: null,
    gateEnforcementConfigKey: null,
    failureDefinition: 'Clinical or sharps waste left in a treatment room overnight',
    escalationPolicy: 'STANDARD',
    capaPolicy: CapaRequirement.REQUIRED_ON_CRITICAL,
    matrixRef: 'VS-03 closing set',
    checklist: [
      { label: 'Sharps containers below the fill line' },
      { label: 'Clinical waste bagged and labelled' },
      { label: 'Treatment rooms clear' },
    ],
  },
  {
    code: 'CLS-004',
    parameter: Parameter.SAFETY_EMERGENCY,
    title: 'Secure the clinic',
    standardText: 'Equipment off, compressor drained, doors and shutters locked, alarm set',
    process: 'Closing Readiness',
    priority: Priority.CRITICAL,
    executionMode: ExecutionMode.HUMAN,
    recurrence: Recurrence.DAILY,
    instanceScope: InstanceScope.CLINIC_DAY,
    dueRule: { ...AT_CLOSE },
    assignmentRule: {
      doer: { kind: 'ROLE', value: RoleCode.RECEPTION },
      checker: { kind: 'ROLE', value: RoleCode.CLINIC_MANAGER },
      owner: { kind: 'ROLE', value: RoleCode.CLINIC_HEAD },
    },
    // The last person out does not get to be the one who agrees it was done.
    sodPolicy: SodPolicy.STRICT,
    selfVerifyAllowed: false,
    evidenceType: EvidenceType.VERIFICATION,
    gateRequirement: null,
    gateEnforcementConfigKey: null,
    failureDefinition: 'Clinic left unsecured or alarm not set',
    escalationPolicy: 'STANDARD',
    capaPolicy: CapaRequirement.REQUIRED_ON_CRITICAL,
    matrixRef: 'VS-03 closing set',
    checklist: [
      { label: 'All equipment powered down' },
      { label: 'Compressor drained' },
      { label: 'Doors and shutters locked' },
      { label: 'Alarm set' },
    ],
  },
] as const;
