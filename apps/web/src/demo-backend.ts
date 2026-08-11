/**
 * A stand-in for the KuBi server, running in the browser.
 *
 * This exists so the real app can be handed over as one file that opens and
 * works — no database, no API process, no network. Every screen, component and
 * piece of copy below is the actual product; only the thing answering the
 * requests is different.
 *
 * IMPORTANT, and stated plainly because it matters: the rules reimplemented
 * here are a FAITHFUL COPY, not the enforcement. Real enforcement lives on the
 * server and is what the 127 tests cover. A browser can always be lied to.
 * This file exists to let a person click through a morning, not to be the
 * security model — which is exactly why the real one is not in the browser.
 *
 * The rules copied here, and why each is worth reproducing:
 *   - only the assignee may start or finish a task (record relation)
 *   - a requirement that cannot be confirmed blocks finishing (AP-1)
 *   - releasing that block is management authority, not the assignee's
 *   - a released block is per task, per day
 *   - the verifier may not be the doer, unless the activity allows it
 *   - a visit's status transitions are a fixed table; finished is terminal
 *   - cancelling always records a reason
 */

import {
  PARAMETER_SPEC, TaskOrigin, Engine, ladder, ORIGIN_LABEL,
  SCORE_SPEC, SCORE_ORDER, outcomeOf, operationalScore, rollUp, rungAt,
  RULES, TriggerEvent, ActionKind, fire, notificationsFor, AuditAction,
  type Notification, type AuditEntry,
  STERILIZATION_SAME_DAY, ACTIVITY_LIBRARY,
  type ManagementScore,
  type Responsibility, type EscalationRung,
  DAILY_STANDARD, provenanceOf, minutesFromOpening, standardById,
  type WorkProvenance,
  retentionOrder, DORMANT_AFTER_DAYS, CLOSING_OUTCOMES, headlineFor,
  ClinicEvent, emptyWorld, record as recordEvent,
  readiness, closing, decisions, decisionsFor, escalatedTo, mostImportant,
  sweep, board, FLOWS,
  careFor, careForAll, careOwedBy, TREATMENTS, NOTHING_KNOWN, UNRATIFIED_CATALOGUE,
  ASSETS, equipment as equipmentView, assetWorkFor, UNRATIFIED_REGISTER,
  ClinicEvent as CE,
  type World, type Operatory, type RoleCode,
  type Booking, type PatientFacts, type Care, type CareTask, type ReadinessEvent,
  type AssetRecord, type AssetTask,
} from '@kubi/contracts';

type Role =
  | 'OWNER_DIRECTOR'
  | 'DENTAL_ASSISTANT' | 'CLINIC_MANAGER' | 'SENIOR_ASSISTANT' | 'RECEPTION'
  | 'TREATING_DOCTOR' | 'LAB_COORDINATOR' | 'STERILIZATION_TECHNICIAN' | 'HOUSEKEEPING';

interface Person {
  key: string;
  email: string;
  employeeId: string;
  displayLabel: string;
  roles: Role[];
}

export const PEOPLE: Person[] = [
  { key: 'priya', email: 'priya@synthetic.test', employeeId: 'e-priya', displayLabel: 'Dental assistant', roles: ['DENTAL_ASSISTANT'] },
  { key: 'rahul', email: 'rahul@synthetic.test', employeeId: 'e-rahul', displayLabel: 'Clinic manager', roles: ['CLINIC_MANAGER'] },
  { key: 'anita', email: 'anita@synthetic.test', employeeId: 'e-anita', displayLabel: 'Senior assistant', roles: ['SENIOR_ASSISTANT'] },
  { key: 'kavita', email: 'kavita@synthetic.test', employeeId: 'e-kavita', displayLabel: 'Reception', roles: ['RECEPTION'] },
  // The owner was missing entirely, which meant the one view the requirement
  // describes in most detail -- "you should not see 150 tasks" -- could not be
  // reached by anybody.
  { key: 'deepak', email: 'deepak@synthetic.test', employeeId: 'e-deepak', displayLabel: 'Owner', roles: ['OWNER_DIRECTOR'] },
  // Phase 1 builds the clinical workflow: doctor, assistant, lab, reception,
  // sterilisation. Three of those five had no person to sign in as, so the
  // screens could not be reached at all.
  { key: 'mehta', email: 'mehta@synthetic.test', employeeId: 'e-mehta', displayLabel: 'Doctor', roles: ['TREATING_DOCTOR'] },
  { key: 'suresh', email: 'suresh@synthetic.test', employeeId: 'e-suresh', displayLabel: 'Lab coordinator', roles: ['LAB_COORDINATOR'] },
  { key: 'ramesh', email: 'ramesh@synthetic.test', employeeId: 'e-ramesh', displayLabel: 'Housekeeping', roles: ['HOUSEKEEPING'] },
  { key: 'lakshmi', email: 'lakshmi@synthetic.test', employeeId: 'e-lakshmi', displayLabel: 'Sterilisation', roles: ['STERILIZATION_TECHNICIAN'] },
];

export const DEMO_PASSWORD = 'SyntheticDemo123!';

/** Who may decide it is safe to finish without a confirmation. */
const MAY_RELEASE: Role[] = ['CLINIC_MANAGER'];
/** Who may move a visit along. */
const MAY_MOVE_VISITS: Role[] = ['RECEPTION', 'CLINIC_MANAGER'];
/** Who may see how the clinic as a whole is running, rather than their own day. */
const MAY_SEE_CLINIC: Role[] = ['CLINIC_MANAGER', 'OWNER_DIRECTOR'];

interface Item { id: string; label: string; requiresValue?: boolean; unit?: string }

/**
 * The 16 control parameters. The axis the owner's dashboard rolls up — what
 * KIND of control an activity is, as opposed to which workflow it sits in.
 */
const PARAMETERS = [
  'ATTENDANCE_LEAVE', 'OPENING_READINESS', 'CLEANLINESS', 'MAINTENANCE_UTILITIES',
  'INFECTION_CONTROL', 'ROOM_CHAIR_READINESS', 'APPOINTMENT_CONTROL', 'PATIENT_JOURNEY',
  'CLINICAL_DOCUMENTATION', 'SURGICAL_HIGH_RISK', 'FOLLOWUP_EXPERIENCE', 'LABORATORY',
  'INVENTORY_IMPLANTS', 'STAFF_CONDUCT', 'SAFETY_EMERGENCY', 'QUALITY_CAPA',
] as const;
type ParameterKey = (typeof PARAMETERS)[number];

interface Task {
  id: string;
  code: string;
  /** Which of the 16 control heads this belongs to. */
  parameter: ParameterKey;
  /**
   * Which half of the day this belongs to. Counted separately, always.
   *
   * 'Daily Standard' is the third value and is deliberately outside the two
   * tallies: the opening and closing progress bars answer "can the clinic
   * open", and the hourly washroom round is not part of that question.
   */
  process: 'Opening Readiness' | 'Closing Readiness' | 'Daily Standard';
  title: string;
  standard: string;
  assignee: string;
  items: Item[];
  selfVerifyAllowed: boolean;
  checkerRoles: Role[];
  /** The plain-language message when the requirement cannot be confirmed. */
  cantConfirm: string | null;
  minutesFromOpening: number;
  status: 'DUE' | 'IN_PROGRESS' | 'COMPLETED' | 'VERIFIED';
  responses: Record<string, { checked: boolean; value: number | null }>;
  blockedBy: string | null;
  releasedAt: number | null;
  completedBy: string | null;
  /**
   * The row in the owner's daily operating standard this came from.
   *
   * Null only where a task predates the library. Everything generated carries
   * it, and it is what lets any task answer "why am I doing this" without
   * storing a copy of the answer that could drift.
   */
  standardId: string | null;
}

/**
 * Why a task exists, and who the four people are.
 *
 * Derived rather than stored per task: in the real system this comes off the
 * activity record, and duplicating it onto every instance is how the copies
 * drift. The demo derives it the same way so the two cannot disagree.
 *
 * The four levels exist to kill one failure — "I thought somebody else had
 * done it". An assignee and a checker cannot express it: neither of them is
 * accountable for the result, and neither hears about it when it does not
 * happen.
 */
/**
 * The patient-event cascade — engine B made visible.
 *
 * The argument prototype B made better than anything in A: nobody types these
 * in. Record the clinical event and the system raises the work it implies, to
 * the right person, at the right time.
 */
/**
 * The cascade, now produced by the automation engine rather than typed out.
 *
 * This was a hardcoded list sitting next to a real rule engine — which meant
 * the screen demonstrating "nobody types these in" was itself typed in. Firing
 * R-PROC-01 for real means the demo cannot drift from the rule, and changing
 * the rule changes the demo.
 */
const CASCADE_SPAWN = fire(RULES, TriggerEvent.PROCEDURE_COMPLETED)
  .flatMap((outcome) => outcome.actions)
  .filter((a) => a.kind === ActionKind.RAISE)
  .map((a) => ({
    // "Tomorrow" and "Within 24h" are the matrix's own words; the grouping is
    // derived from them rather than stored a second time.
    when: /tomorrow/i.test(a.due ?? '') ? 'Tomorrow'
      : /24h|later|within/i.test(a.due ?? '') ? 'Later' : 'Today',
    role: a.to,
    title: a.say,
    due: a.due ?? 'Today',
    activityId: a.activityId ?? null,
  }));

/**
 * Confirmation state, per the §6 example. Kept beside the visits rather than
 * on them because in the real system these are interaction records — a call
 * attempt is an event with a time and a person, not a flag.
 */
const CONFIRM_ATTEMPTS: Record<string, number> = { v4: 2, v5: 1 };
const REMINDER_SENT: string[] = ['v1', 'v2', 'v3'];
const SPECIAL_INSTRUCTIONS: Record<string, string> = {
  v2: 'Nil by mouth from 06:00 — surgery',
  v4: 'Bring previous OPG',
};

/**
 * Append to the audit trail.
 *
 * Every state change goes through here, including the refusals — a trail that
 * records only what succeeded cannot answer the question an auditor actually
 * asks, which is what the system stopped and why.
 */
function audit(
  action: AuditAction, activityId: string, subject: string, by: string,
  extra: Partial<AuditEntry> = {},
): void {
  db.audit.push({
    id: `au-${db.nextAuditId++}`,
    at: new Date().toISOString(),
    action, activityId, subject, by, ...extra,
  });
}

function workSpecFor(t: Task): {
  origin: TaskOrigin; engine: Engine; trigger: string;
  responsibility: Responsibility; escalation: EscalationRung[];
  kpi: string | null;
} {
  const infection = t.parameter === 'INFECTION_CONTROL';
  const safety = t.parameter === 'SAFETY_EMERGENCY';

  const responsibility: Responsibility = {
    doer: 'DENTAL_ASSISTANT' as Responsibility['doer'],
    checker: t.selfVerifyAllowed ? null : (t.checkerRoles[0] ?? 'SENIOR_ASSISTANT') as never,
    // Accountable for the result, whoever happened to do it. Clinical work
    // answers to the clinical director; the rest to the clinic manager.
    owner: (infection || safety ? 'CLINICAL_DIRECTOR' : 'CLINIC_MANAGER') as never,
    escalation: 'CLINIC_HEAD' as never,
  };

  // Patient-safety work escalates faster. The ladder is data precisely so this
  // is a different row rather than a different service.
  const minutes: [number, number, number] = infection || safety ? [10, 20, 40] : [15, 30, 60];

  const KPI: Partial<Record<ParameterKey, string>> = {
    INFECTION_CONTROL: 'Same-day sterilisation compliance',
    OPENING_READINESS: 'Opening on-time %',
    SAFETY_EMERGENCY: 'Emergency readiness %',
    ROOM_CHAIR_READINESS: 'Chairside readiness %',
    CLEANLINESS: 'Cleanliness compliance %',
  };

  return {
    origin: TaskOrigin.RECURRING,
    engine: Engine.TIME,
    trigger: t.process === 'Opening Readiness'
      ? 'Clinic opening' : 'Clinic closing',
    responsibility,
    escalation: ladder(responsibility, minutes),
    kpi: KPI[t.parameter] ?? null,
  };
}

/** One row of the retention list, shaped exactly as the real API returns it. */
interface DemoRetention {
  patientId: string;
  patientLabel: string;
  uhid: string;
  reason: 'NEVER_STARTED' | 'STOPPED_MID_TREATMENT';
  daysSinceLastVisit: number;
  stake: string;
  outreach: {
    id: string;
    raisedAt: string;
    contactedAt: string | null;
    outcome: string | null;
    note: string | null;
  } | null;
}

interface Attention {
  id: string;
  code: string;
  headline: string;
  severity: 'PATIENT_SAFETY' | 'CRITICAL' | 'IMPORTANT' | 'ROUTINE';
  detail: string | null;
  owner: string;
  dueAt: number | null;
  instanceId: string | null;
  needsAuthorisation: boolean;
  open: boolean;
}

/** One corrective or preventive action. */
interface CapaAction {
  id: string;
  type: 'CORRECTIVE' | 'PREVENTIVE';
  status: 'OPEN' | 'ACTION_IN_PROGRESS' | 'IMPLEMENTED' | 'EFFECTIVENESS_PENDING'
    | 'EFFECTIVE' | 'CLOSED';
  description: string;
  responsible: string;
  responsibleName: string;
  dueInDays: number;
  verifiedBy: string | null;
  verificationNote: string | null;
  /** How many times this fix was found ineffective and sent back round. */
  ineffectiveCount: number;
}

/**
 * An incident travelling the IMPROVE stage of the loop.
 *
 * The chain is the requirement's: what happened -> immediate correction ->
 * root cause -> corrective and preventive actions -> verification -> closed.
 * Nulls are meaningful here: a null rootCause is not "none", it is "nobody has
 * asked why yet", which is the thing the screen must make impossible to miss.
 */
interface Incident {
  id: string;
  reference: string;
  parameter: ParameterKey;
  priority: string;
  status: 'OPEN' | 'CONTAINED' | 'INVESTIGATED' | 'ACTIONS_PLANNED' | 'VERIFYING' | 'CLOSED';
  ageDays: number;
  summary: string;
  description: string | null;
  immediateCorrection: string | null;
  rootCause: string | null;
  actions: CapaAction[];
}


/** One requirement on a procedure protocol, as the readiness engine reports it. */
interface Requirement {
  kind: string;
  label: string;
  enforcement: 'ADVISORY' | 'BLOCK_OVERRIDABLE' | 'BLOCK_HARD';
  result: 'PASS' | 'FAIL' | 'UNKNOWN' | 'NOT_CONFIGURED' | 'NOT_APPLICABLE';
  detail: string;
}

/**
 * A procedure booked for a patient, with its readiness.
 *
 * The point of this screen in the requirement is that the DOCTOR sees the
 * exact missing requirement before the patient reaches the chair, rather than
 * discovering it when they ask for the component. So each requirement carries
 * its own result and its own reason, and the screen never summarises them
 * into a single word.
 */
interface PatientProcedure {
  id: string;
  patientLabel: string;
  patientUhid: string;
  procedureName: string;
  category: string;
  whenLabel: string;
  status: 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED';
  requirements: Requirement[];
  overriddenBy: string | null;
  overrideReason: string | null;
  /** Medical alerts ride at the top of the record, never inside a tab. */
  alerts: string[];
}

/** A post-operative follow-up call, with the structured response. */
interface DemoFollowup {
  id: string;
  patientLabel: string;
  patientUhid: string;
  procedureName: string;
  dueLabel: string;
  overdue: boolean;
  outcome: 'PENDING' | 'CONTACTED_WELL' | 'RED_FLAG' | 'NO_RESPONSE';
  pain: string | null;
  swelling: string | null;
  bleeding: string | null;
  medication: string | null;
  redFlagReason: string | null;
}


/** One asset, as the Equipment engine reports it. */
interface DemoAsset {
  id: string;
  code: string;
  name: string;
  category: string;
  status: 'OPERATIONAL' | 'RESTRICTED' | 'OUT_OF_SERVICE' | 'UNDER_REPAIR' | 'RETIRED';
  location: string;
  checkedToday: 'PASS' | 'FAIL' | null;
  nextServiceInDays: number | null;
  serviceKind: string | null;
}

/** A stock line. `available` excludes expired batches — that is the point. */
interface DemoStock {
  id: string;
  code: string;
  name: string;
  unit: string;
  available: number;
  onHand: number;
  minimumQty: number;
  reorderLevel: number;
  state: 'OK' | 'REORDER' | 'SHORTAGE';
  expiringSoon: number;
  expired: number;
}

/** Implant stock, to the component. Quantity alone is insufficient. */
interface DemoImplant {
  id: string;
  brand: string;
  line: string;
  platform: string;
  componentType: string;
  size: string;
  quantity: number;
  expiringSoon: boolean;
}

/** A sterilisation batch mid-journey. Not a closing tick. */
interface DemoBatch {
  id: string;
  batchRef: string;
  stage: string;
  packCount: number;
  operator: string;
  cycleResult: 'PASS' | 'FAIL' | 'INCONCLUSIVE' | null;
}

/**
 * A laboratory case. `delivery.ready` is the crown gate — received AND
 * QC-passed — and the reason is carried so the screen can say why, not merely
 * refuse.
 */
interface DemoLabCase {
  id: string;
  reference: string;
  patientLabel: string;
  vendor: string;
  workType: string;
  toothRef: string;
  status: string;
  expectedLabel: string | null;
  overdue: boolean;
  qcResult: 'PASS' | 'FAIL' | null;
  remakeCount: number;
  nextStep: string | null;
  deliveryReady: boolean;
  deliveryReason: string | null;
}

interface Visit {
  id: string;
  patientLabel: string;
  patientUhid: string;
  visitType: string;
  chairLabel: string;
  startsInMinutes: number;
  minutes: number;
  status: 'BOOKED' | 'ARRIVED' | 'IN_CHAIR' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
  arrivedAt: number | null;
  cancelReason?: string;
}

const STATUS_LABEL: Record<Visit['status'], string> = {
  BOOKED: 'Expected', ARRIVED: 'Waiting', IN_CHAIR: 'In the chair',
  COMPLETED: 'Finished', CANCELLED: 'Cancelled', NO_SHOW: "Didn't come",
};

const ALLOWED: Record<Visit['status'], Visit['status'][]> = {
  BOOKED: ['ARRIVED', 'CANCELLED', 'NO_SHOW'],
  ARRIVED: ['IN_CHAIR', 'CANCELLED', 'NO_SHOW'],
  IN_CHAIR: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [], CANCELLED: [], NO_SHOW: [],
};

const PROBLEM_KINDS = [
  { key: 'NOT_WORKING', label: 'Not working' },
  { key: 'MISSING', label: 'Missing' },
  { key: 'NOT_CLEAN', label: 'Not clean' },
  { key: 'OTHER', label: 'Something else' },
];

// ---------------------------------------------------------------------------
// The morning. Times are relative to when the file is opened, so the demo is
// always mid-morning and slightly behind — which is when a clinic actually
// needs this screen.
// ---------------------------------------------------------------------------

const OPENED_AT = Date.now();
/** Opening was due 12 minutes ago: late enough to matter, not a disaster. */
const OPENING_DUE = OPENED_AT - 12 * 60_000;
/** Eleven hours after opening — the demo's day is a real clinic day long. */
const CLOSING_DUE = OPENING_DUE + 660 * 60_000;

function freshState() {
  const seeded: Array<Omit<Task, 'standardId'>> = [
    {
      id: 't-004', code: 'OPN-004', parameter: 'OPENING_READINESS', process: 'Opening Readiness', title: 'Set up the clinic environment',
      standard: 'AC 24°C where applicable, diffuser and lights as schedule',
      assignee: 'e-priya', selfVerifyAllowed: true, checkerRoles: [],
      cantConfirm: null, minutesFromOpening: -30, status: 'DUE',
      items: [
        { id: 'i-401', label: 'Air conditioning set', requiresValue: true, unit: '°C' },
        { id: 'i-402', label: 'Lights on as per schedule' },
        { id: 'i-403', label: 'Diffuser on' },
      ],
      responses: {}, blockedBy: null, releasedAt: null, completedBy: null,
    },
    {
      id: 't-005', code: 'OPN-005', parameter: 'SAFETY_EMERGENCY', process: 'Opening Readiness', title: 'Check the emergency kit',
      standard: 'Emergency equipment and critical items available and accessible',
      assignee: 'e-priya', selfVerifyAllowed: false, checkerRoles: ['CLINIC_MANAGER'],
      cantConfirm: "We can't confirm the emergency kit list yet",
      minutesFromOpening: -30, status: 'DUE',
      items: [
        { id: 'i-501', label: 'Emergency kit present and sealed' },
        { id: 'i-502', label: 'Oxygen cylinder available and pressure adequate' },
        { id: 'i-503', label: 'Adrenaline in date' },
        { id: 'i-504', label: 'Emergency contact list visible' },
      ],
      responses: {}, blockedBy: null, releasedAt: null, completedBy: null,
    },
    {
      id: 't-001', code: 'OPN-001', parameter: 'OPENING_READINESS', process: 'Opening Readiness', title: 'Open the clinic',
      standard: 'Required clinic areas opened before first patient',
      assignee: 'e-priya', selfVerifyAllowed: false, checkerRoles: ['CLINIC_MANAGER'],
      cantConfirm: null, minutesFromOpening: -15, status: 'DUE',
      items: [
        { id: 'i-101', label: 'Main entrance and shutters open' },
        { id: 'i-102', label: 'All floors unlocked and lit' },
        { id: 'i-103', label: 'Water supply running' },
        { id: 'i-104', label: 'Power and backup checked' },
        { id: 'i-105', label: 'Waiting area ready for patients' },
      ],
      responses: {}, blockedBy: null, releasedAt: null, completedBy: null,
    },
    {
      // Already done and waiting on Anita, so a second pair of eyes has
      // something real to look at the moment you switch to her.
      id: 't-002', code: 'OPN-002', parameter: 'ROOM_CHAIR_READINESS', process: 'Opening Readiness', title: 'Get treatment rooms ready',
      standard: 'All scheduled operatories clean, stocked and functional',
      assignee: 'e-priya', selfVerifyAllowed: false, checkerRoles: ['SENIOR_ASSISTANT'],
      cantConfirm: null, minutesFromOpening: -15, status: 'COMPLETED',
      items: [
        { id: 'i-201', label: 'Every room clean' },
        { id: 'i-202', label: 'Instruments laid out' },
        { id: 'i-203', label: 'Suction working' },
        { id: 'i-204', label: 'Chairs tested' },
      ],
      responses: {
        'i-201': { checked: true, value: null },
        'i-202': { checked: true, value: null },
        'i-203': { checked: true, value: null },
        // Left unticked on purpose: the checker is meant to see it as unticked
        // rather than have it quietly omitted.
        'i-204': { checked: false, value: null },
      },
      blockedBy: null, releasedAt: null, completedBy: 'e-priya',
    },
    {
      // Kavita got reception open and confirmed it herself — this activity is
      // on the OD-02 self-verify allowlist. Done and CONFIRMED rather than
      // merely done, so the dashboard has something real in it: a clinic
      // thirty minutes into its morning with literally nothing confirmed is
      // an unusually bad day, not a representative one.
      id: 't-003', code: 'OPN-003', parameter: 'OPENING_READINESS', process: 'Opening Readiness', title: 'Get reception ready',
      standard: 'Reception open, systems on, waiting area presentable',
      assignee: 'e-kavita', selfVerifyAllowed: true, checkerRoles: [],
      cantConfirm: null, minutesFromOpening: -15, status: 'VERIFIED',
      items: [
        { id: 'i-301', label: 'Computers and card machine on' },
        { id: 'i-302', label: 'Appointment list printed' },
        { id: 'i-303', label: 'Waiting area tidy' },
      ],
      responses: {
        'i-301': { checked: true, value: null },
        'i-302': { checked: true, value: null },
        'i-303': { checked: true, value: null },
      },
      blockedBy: null, releasedAt: null, completedBy: 'e-kavita',
    },
    // Already done before anyone opened the app — a real morning has history
    // behind it, and Anita has something genuine waiting to be checked.
    {
      id: 't-006', code: 'OPN-006', parameter: 'INFECTION_CONTROL', process: 'Opening Readiness', title: 'Run the autoclave test cycle',
      standard: 'Daily steriliser test passed and recorded before instruments are used',
      assignee: 'e-anita', selfVerifyAllowed: false, checkerRoles: ['CLINIC_MANAGER'],
      cantConfirm: null, minutesFromOpening: -45, status: 'COMPLETED',
      items: [
        { id: 'i-601', label: 'Test pack loaded' },
        { id: 'i-602', label: 'Cycle completed without fault' },
        { id: 'i-603', label: 'Indicator strip changed correctly' },
        { id: 'i-604', label: 'Result recorded in the log' },
      ],
      responses: {
        'i-601': { checked: true, value: null },
        'i-602': { checked: true, value: null },
        'i-603': { checked: true, value: null },
        'i-604': { checked: false, value: null },
      },
      blockedBy: null, releasedAt: null, completedBy: 'e-anita',
    },
    // ---- the other half of the day ----
    // Closing checks exist from the morning on purpose: a check nobody can see
    // until 19:00 is a check nobody plans their afternoon around. They are
    // counted separately from opening everywhere, because "2 of 11 areas ready"
    // at 09:30 would be a lie about a clinic that is in fact ready.
      {
        id: 't-101', code: 'CLS-001', parameter: 'INFECTION_CONTROL', process: 'Closing Readiness',
        title: 'Finish the sterilisation run',
        standard: 'All used instruments processed, cycle recorded, nothing left in the dirty zone overnight',
        assignee: 'e-priya', selfVerifyAllowed: false, checkerRoles: ['SENIOR_ASSISTANT', 'CLINIC_MANAGER'],
        cantConfirm: null, minutesFromOpening: 615, status: 'DUE',
        items: [
          { id: 'i-1101', label: 'All used instruments through the cycle' },
          { id: 'i-1102', label: 'Cycle result recorded' },
          { id: 'i-1103', label: 'Dirty zone empty' },
          { id: 'i-1104', label: 'Autoclave switched off' },
        ],
        responses: {}, blockedBy: null, releasedAt: null, completedBy: null,
      },
      {
        id: 't-102', code: 'CLS-002', parameter: 'SAFETY_EMERGENCY', process: 'Closing Readiness',
        title: 'Lock up the drugs cupboard',
        standard: 'Controlled and emergency drugs counted against the register, cupboard locked, keys accounted for',
        assignee: 'e-anita', selfVerifyAllowed: false, checkerRoles: ['CLINIC_MANAGER'],
        cantConfirm: null, minutesFromOpening: 630, status: 'DUE',
        items: [
          { id: 'i-1201', label: 'Count matches the register' },
          { id: 'i-1202', label: 'Cupboard locked' },
          { id: 'i-1203', label: 'Keys back in the safe' },
        ],
        responses: {}, blockedBy: null, releasedAt: null, completedBy: null,
      },
      {
        id: 't-103', code: 'CLS-004', parameter: 'SAFETY_EMERGENCY', process: 'Closing Readiness',
        title: 'Secure the clinic',
        standard: 'Equipment off, compressor drained, doors and shutters locked, alarm set',
        assignee: 'e-kavita', selfVerifyAllowed: false, checkerRoles: ['CLINIC_MANAGER'],
        cantConfirm: null, minutesFromOpening: 660, status: 'DUE',
        items: [
          { id: 'i-1301', label: 'All equipment powered down' },
          { id: 'i-1302', label: 'Compressor drained' },
          { id: 'i-1303', label: 'Doors and shutters locked' },
          { id: 'i-1304', label: 'Alarm set' },
        ],
        responses: {}, blockedBy: null, releasedAt: null, completedBy: null,
      },
    {
      id: 't-007', code: 'OPN-007', parameter: 'INVENTORY_IMPLANTS', process: 'Opening Readiness', title: 'Check the fridge temperature',
      standard: 'Cold chain intact: 2–8°C, recorded daily',
      assignee: 'e-priya', selfVerifyAllowed: true, checkerRoles: [],
      cantConfirm: null, minutesFromOpening: 45, status: 'DUE',
      items: [
        { id: 'i-701', label: 'Fridge temperature within range', requiresValue: true, unit: '°C' },
        { id: 'i-702', label: 'Nothing stored past its date' },
      ],
      responses: {}, blockedBy: null, releasedAt: null, completedBy: null,
    },
  ];

  /**
   * The day, taken from the owner's operating standard.
   *
   * Connection 1. Until now the tasks above were the whole day and they were
   * written by hand — a demonstration of a clinic rather than this clinic's
   * own standard. The forty-seven non-negotiables are the standard, so they
   * are the day.
   *
   * Two rules keep it honest:
   *
   * 1. **Nothing is duplicated.** Where a hand-written task already covers a
   *    control the standard names, the standard is linked to it rather than
   *    raised again. Priya does not get two "check the emergency kit" tasks
   *    because one file wrote it twice.
   * 2. **Patient work is not on the clock.** The thirteen EVERY_PATIENT
   *    non-negotiables are raised by a patient arriving, and minutesFromOpening
   *    returns null for them, so they never appear on a timeline that would
   *    claim a schedule the clinic does not have.
   */
  const ROLE_EMPLOYEE: Record<string, string> = {
    HOUSEKEEPING: 'e-ramesh',
    DENTAL_ASSISTANT: 'e-priya',
    RECEPTION: 'e-kavita',
    CLINIC_MANAGER: 'e-rahul',
    TREATING_DOCTOR: 'e-mehta',
  };

  // Which controls the hand-written tasks already cover.
  const alreadyCovered = new Set(seeded.map((t) => t.code));

  const tasks: Task[] = seeded.map((t) => ({
    ...t,
    // Trace a hand-written task back to the standard it satisfies, where one
    // names the same control. Matching on the control rather than on the title
    // is deliberate — titles are written for a person and drift.
    standardId: DAILY_STANDARD.find((d) => d.covers === t.code)?.id ?? null,
  }));

  let generated = 0;
  for (const std of DAILY_STANDARD) {
    if (std.covers && alreadyCovered.has(std.covers)) continue;
    const minutes = minutesFromOpening(std);
    if (minutes === null) continue;              // patient-driven, never on the clock
    const assignee = ROLE_EMPLOYEE[std.role];
    if (!assignee) continue;                     // no such person in the demo clinic
    generated += 1;
    tasks.push({
      id: `t-std-${std.id}`,
      // Where nothing governs it, the code says so rather than borrowing one.
      code: std.covers ?? 'NO CONTROL',
      parameter: 'OPENING_READINESS',
      process: 'Daily Standard',
      // The owner's own wording, both lines. Rewriting them here would be a
      // second copy of the standard, which is the thing the library prevents.
      title: std.task,
      standard: std.standard,
      assignee,
      selfVerifyAllowed: true,
      checkerRoles: [],
      cantConfirm: null,
      minutesFromOpening: minutes,
      status: 'DUE',
      items: [{ id: `i-${std.id}`, label: std.task }],
      responses: {},
      blockedBy: null,
      releasedAt: null,
      completedBy: null,
      standardId: std.id,
    });
  }
  void generated;

  const visits: Visit[] = [
    { id: 'v1', patientLabel: 'SYNTHETIC Meera J.', patientUhid: 'SYN-1001', visitType: 'Check-up', chairLabel: 'Chair 1', startsInMinutes: 18, minutes: 30, status: 'BOOKED', arrivedAt: null },
    { id: 'v2', patientLabel: 'SYNTHETIC Arjun P.', patientUhid: 'SYN-1002', visitType: 'Root canal', chairLabel: 'Chair 2', startsInMinutes: 48, minutes: 45, status: 'BOOKED', arrivedAt: null },
    { id: 'v3', patientLabel: 'SYNTHETIC Fatima S.', patientUhid: 'SYN-1003', visitType: 'Scaling', chairLabel: 'Chair 1', startsInMinutes: 48, minutes: 30, status: 'BOOKED', arrivedAt: null },
    { id: 'v4', patientLabel: 'SYNTHETIC Daniel R.', patientUhid: 'SYN-1004', visitType: 'Filling', chairLabel: 'Chair 1', startsInMinutes: 108, minutes: 30, status: 'CANCELLED', arrivedAt: null, cancelReason: 'SYNTHETIC: patient rescheduled to next week' },
    { id: 'v5', patientLabel: 'SYNTHETIC Priyanka N.', patientUhid: 'SYN-1005', visitType: 'Crown fitting', chairLabel: 'Chair 2', startsInMinutes: 138, minutes: 60, status: 'BOOKED', arrivedAt: null },
    { id: 'v6', patientLabel: 'SYNTHETIC Imran Q.', patientUhid: 'SYN-1006', visitType: 'Check-up', chairLabel: 'Chair 1', startsInMinutes: 198, minutes: 30, status: 'BOOKED', arrivedAt: null },
  ];

  // A morning that has already been running: the app is not a blank slate
  // when somebody picks up the tablet at 09:00.
  const attention: Attention[] = [
    {
      id: 'a-seed-1', code: 'OPN.OVERDUE',
      headline: 'Autoclave log line is missing for the test cycle',
      severity: 'CRITICAL',
      detail: 'The cycle passed but the result was not written into the log.',
      owner: 'e-rahul', dueAt: OPENED_AT + 40 * 60_000,
      instanceId: 't-006', needsAuthorisation: false, open: true,
    },
    {
      id: 'a-seed-2', code: 'SCH.SUPPLY',
      headline: 'Gloves down to the last box in Chair 2',
      severity: 'IMPORTANT',
      detail: 'Reported yesterday evening by the closing assistant.',
      owner: 'e-rahul', dueAt: OPENED_AT + 5 * 60 * 60_000,
      instanceId: null, needsAuthorisation: false, open: true,
    },
  ];

  /**
   * The IMPROVE stage, mid-flight.
   *
   * Three incidents deliberately sitting at three different points of the
   * loop, because the whole idea is that an incident is not "open" or "closed"
   * but somewhere on a journey, and the screen's job is to say which step is
   * owed next. The crown one is the requirement's own example.
   */
  const incidents: Incident[] = [
    {
      id: 'inc-1', reference: 'INC-2026-0007', parameter: 'LABORATORY',
      priority: 'IMPORTANT', status: 'OPEN', ageDays: 0,
      summary: 'Crown delivery appointment given before the crown arrived',
      description: 'Mrs Shah was booked for Thursday. The lab case is still in production.',
      immediateCorrection: null, rootCause: null, actions: [],
    },
    {
      id: 'inc-2', reference: 'INC-2026-0006', parameter: 'INFECTION_CONTROL',
      priority: 'PATIENT_SAFETY', status: 'CONTAINED', ageDays: 1,
      summary: 'Autoclave cycle closed without the log line being verified',
      description: null,
      immediateCorrection: 'Cycle re-run and the batch re-verified before the first patient.',
      rootCause: null, actions: [],
    },
    {
      id: 'inc-3', reference: 'INC-2026-0004', parameter: 'APPOINTMENT_CONTROL',
      priority: 'IMPORTANT', status: 'VERIFYING', ageDays: 4,
      summary: 'Three patients not confirmed before the morning cutoff',
      description: null,
      immediateCorrection: 'All three called by 10:15 and confirmed.',
      rootCause: 'The confirmation list is worked from memory; nobody owns it before 9:45.',
      actions: [
        {
          id: 'act-1', type: 'CORRECTIVE', status: 'EFFECTIVE',
          description: 'Call the three patients and confirm',
          responsible: 'e-kavita', responsibleName: 'Kavita', dueInDays: -2,
          verifiedBy: 'Clinic manager', verificationNote: null, ineffectiveCount: 0,
        },
        {
          // Deliberately on its second attempt: the first fix was a reminder
          // in the huddle, it did not work, and the loop sent it back. A demo
          // where every fix works first time teaches the wrong thing.
          id: 'act-2', type: 'PREVENTIVE', status: 'EFFECTIVENESS_PENDING',
          description: 'Confirmation becomes a named 09:30 task owned by reception, with its own deadline',
          responsible: 'e-rahul', responsibleName: 'Rahul', dueInDays: 1,
          verifiedBy: null, verificationNote: null, ineffectiveCount: 1,
        },
      ],
    },
  ];


  /**
   * Three procedures at three different readiness states, because a screen
   * that only ever shows READY teaches nothing about what it is for.
   *
   * The implant case is the requirement's own worked example: the component is
   * unavailable, and KuBi says so before the patient reaches the chair rather
   * than when the doctor asks for it.
   */
  const patientProcedures: PatientProcedure[] = [
    {
      id: 'pp-1', patientLabel: 'SYNTHETIC Arjun P.', patientUhid: 'SYN-1002',
      procedureName: 'Root canal treatment', category: 'ENDODONTIC',
      whenLabel: 'Today, 10:30', status: 'PLANNED',
      alerts: ['Penicillin allergy'],
      overriddenBy: null, overrideReason: null,
      requirements: [
        { kind: 'MEDICAL_HISTORY', label: 'Medical history current', enforcement: 'BLOCK_HARD',
          result: 'PASS', detail: 'Updated 12 days ago.' },
        { kind: 'RADIOGRAPH', label: 'Relevant radiograph', enforcement: 'BLOCK_HARD',
          result: 'PASS', detail: 'Periapical taken at consultation.' },
        { kind: 'CONSENT', label: 'Signed consent', enforcement: 'BLOCK_HARD',
          result: 'FAIL', detail: 'No signed consent for this procedure.' },
        { kind: 'TREATMENT_PLAN', label: 'Treatment plan documented', enforcement: 'BLOCK_OVERRIDABLE',
          result: 'PASS', detail: 'Plan accepted 12 days ago.' },
      ],
    },
    {
      id: 'pp-2', patientLabel: 'SYNTHETIC Priyanka N.', patientUhid: 'SYN-1005',
      procedureName: 'Implant surgery', category: 'IMPLANT_SURGERY',
      whenLabel: 'Today, 12:30', status: 'PLANNED',
      alerts: ['Type 2 diabetes', 'On anticoagulant'],
      overriddenBy: null, overrideReason: null,
      requirements: [
        { kind: 'CONSENT', label: 'Signed consent', enforcement: 'BLOCK_HARD',
          result: 'PASS', detail: 'Signed IMPL-SURG v4.' },
        { kind: 'MEDICAL_HISTORY', label: 'Medical history current', enforcement: 'BLOCK_HARD',
          result: 'PASS', detail: 'Updated this morning.' },
        { kind: 'PRE_OP_RECORDS', label: 'Pre-op scan', enforcement: 'BLOCK_HARD',
          result: 'PASS', detail: 'CBCT on file.' },
        { kind: 'IMPLANT_AVAILABLE', label: 'Implant components in stock', enforcement: 'BLOCK_HARD',
          result: 'FAIL', detail: 'Healing abutment 4.5×5 not in stock.' },
        { kind: 'STERILE_KIT', label: 'Surgical kit sterile', enforcement: 'BLOCK_HARD',
          result: 'PASS', detail: 'Batch STER-0912 released 08:40.' },
        { kind: 'EMERGENCY_READY', label: 'Emergency readiness', enforcement: 'BLOCK_HARD',
          result: 'NOT_CONFIGURED', detail: 'Emergency readiness cannot be confirmed yet — no evaluator.' },
      ],
    },
    {
      id: 'pp-3', patientLabel: 'SYNTHETIC Fatima S.', patientUhid: 'SYN-1003',
      procedureName: 'Scaling and polishing', category: 'PREVENTIVE',
      whenLabel: 'Today, 10:30', status: 'PLANNED',
      alerts: [],
      overriddenBy: null, overrideReason: null,
      requirements: [
        { kind: 'MEDICAL_HISTORY', label: 'Medical history current', enforcement: 'BLOCK_HARD',
          result: 'PASS', detail: 'Updated 3 months ago.' },
        { kind: 'CONSENT', label: 'Signed consent', enforcement: 'ADVISORY',
          result: 'PASS', detail: 'Signed GEN-TX v2.' },
      ],
    },
  ];

  /**
   * Follow-ups, including one red flag already raised.
   *
   * The red flag was decided by the rule, not by whoever made the call — which
   * is the whole design point, so the demo shows the symptoms alongside it.
   */
  const followups: DemoFollowup[] = [
    {
      id: 'fu-1', patientLabel: 'SYNTHETIC Rakesh T.', patientUhid: 'SYN-0994',
      procedureName: 'Implant surgery', dueLabel: 'Yesterday', overdue: true,
      outcome: 'RED_FLAG', pain: 'SEVERE', swelling: 'EXCESSIVE',
      bleeding: 'NO', medication: 'TAKING',
      redFlagReason: 'Severe pain with excessive swelling',
    },
    {
      id: 'fu-2', patientLabel: 'SYNTHETIC Sunita M.', patientUhid: 'SYN-0987',
      procedureName: 'Surgical extraction', dueLabel: 'Today', overdue: false,
      outcome: 'PENDING', pain: null, swelling: null, bleeding: null,
      medication: null, redFlagReason: null,
    },
    {
      id: 'fu-3', patientLabel: 'SYNTHETIC Vikram D.', patientUhid: 'SYN-0981',
      procedureName: 'Implant surgery', dueLabel: 'Today', overdue: false,
      outcome: 'CONTACTED_WELL', pain: 'MILD', swelling: 'EXPECTED',
      bleeding: 'NO', medication: 'TAKING', redFlagReason: null,
    },
  ];


  /**
   * Assets, stock and sterilisation, deliberately not all healthy.
   *
   * A screen that only ever shows green teaches nothing about what it is for,
   * and each of these is one of the requirement's own named exceptions:
   * equipment service overdue, stock below minimum, instrument sterilisation
   * pending.
   */
  const assets: DemoAsset[] = [
    { id: 'a1', code: 'CHAIR-01', name: 'Dental chair 1', category: 'DENTAL_CHAIR', status: 'OPERATIONAL', location: 'Room 1', checkedToday: 'PASS', nextServiceInDays: 96, serviceKind: 'SERVICE' },
    { id: 'a2', code: 'CHAIR-02', name: 'Dental chair 2', category: 'DENTAL_CHAIR', status: 'OUT_OF_SERVICE', location: 'Room 2', checkedToday: 'FAIL', nextServiceInDays: 40, serviceKind: 'SERVICE' },
    { id: 'a3', code: 'AUTOCLAVE-01', name: 'Autoclave 1', category: 'AUTOCLAVE', status: 'OPERATIONAL', location: 'Sterile bay', checkedToday: 'PASS', nextServiceInDays: 4, serviceKind: 'CALIBRATION' },
    { id: 'a4', code: 'COMPRESSOR-01', name: 'Compressor', category: 'UTILITY', status: 'OPERATIONAL', location: 'Plant room', checkedToday: null, nextServiceInDays: 210, serviceKind: 'SERVICE' },
    { id: 'a5', code: 'OPG-01', name: 'OPG unit', category: 'IMAGING', status: 'OPERATIONAL', location: 'Imaging', checkedToday: 'PASS', nextServiceInDays: 61, serviceKind: 'CALIBRATION' },
  ];

  const stock: DemoStock[] = [
    { id: 's1', code: 'GLV-NIT-M', name: 'Nitrile gloves (M)', unit: 'BOX', available: 4, onHand: 10, minimumQty: 2, reorderLevel: 5, state: 'REORDER', expiringSoon: 0, expired: 1 },
    { id: 's2', code: 'MSK-SUR', name: 'Surgical masks', unit: 'BOX', available: 2, onHand: 2, minimumQty: 5, reorderLevel: 10, state: 'SHORTAGE', expiringSoon: 0, expired: 0 },
    { id: 's3', code: 'GZE-STR', name: 'Sterile gauze', unit: 'PACK', available: 18, onHand: 18, minimumQty: 6, reorderLevel: 12, state: 'OK', expiringSoon: 2, expired: 0 },
    { id: 's4', code: 'RVG-SLV', name: 'RVG sleeves', unit: 'BOX', available: 9, onHand: 9, minimumQty: 3, reorderLevel: 6, state: 'OK', expiringSoon: 0, expired: 0 },
    { id: 's5', code: 'ANS-LID', name: 'Local anaesthetic', unit: 'BOX', available: 7, onHand: 11, minimumQty: 4, reorderLevel: 8, state: 'REORDER', expiringSoon: 1, expired: 1 },
  ];

  const implants: DemoImplant[] = [
    { id: 'i1', brand: 'Nobel', line: 'Active', platform: 'NP', componentType: 'IMPLANT', size: '3.5×10', quantity: 3, expiringSoon: false },
    { id: 'i2', brand: 'Nobel', line: 'Active', platform: 'NP', componentType: 'IMPLANT', size: '4.3×11.5', quantity: 2, expiringSoon: false },
    // The case booked for 12:30 needs this one. It is the reason that surgery
    // cannot start, and the Compliance engine reads it from here.
    { id: 'i3', brand: 'Nobel', line: 'Active', platform: 'NP', componentType: 'HEALING_ABUTMENT', size: '4.5×5', quantity: 0, expiringSoon: false },
    { id: 'i4', brand: 'Nobel', line: 'Active', platform: 'NP', componentType: 'IMPRESSION_COMPONENT', size: '—', quantity: 4, expiringSoon: false },
    { id: 'i5', brand: 'Straumann', line: 'BLT', platform: 'RC', componentType: 'IMPLANT', size: '4.1×8', quantity: 1, expiringSoon: true },
  ];

  /**
   * Lab cases at four points of the lifecycle, including the requirement's own
   * worst case: a crown that has arrived but has not been checked, which is
   * exactly the state a booking screen is most likely to treat as good enough.
   */
  const labCases: DemoLabCase[] = [
    {
      id: 'l1', reference: 'LAB-2026-0031', patientLabel: 'SYNTHETIC Priyanka N.',
      vendor: 'Precision Dental Lab', workType: 'Crown', toothRef: '26',
      status: 'QC_PENDING', expectedLabel: 'yesterday', overdue: false,
      qcResult: null, remakeCount: 0, nextStep: 'Doctor to check the case',
      deliveryReady: false,
      deliveryReason: 'LAB-2026-0031 has arrived but has not been checked.',
    },
    {
      id: 'l2', reference: 'LAB-2026-0029', patientLabel: 'SYNTHETIC Imran Q.',
      vendor: 'Precision Dental Lab', workType: 'Bridge', toothRef: '34–36',
      status: 'IN_PROGRESS_VENDOR', expectedLabel: '3 days ago', overdue: true,
      qcResult: null, remakeCount: 0, nextStep: 'Waiting on the laboratory',
      deliveryReady: false,
      deliveryReason: 'LAB-2026-0029 has not arrived from the laboratory yet.',
    },
    {
      id: 'l3', reference: 'LAB-2026-0027', patientLabel: 'SYNTHETIC Meera J.',
      vendor: 'Apex Ceramics', workType: 'Crown', toothRef: '16',
      status: 'REMAKE', expectedLabel: null, overdue: false,
      qcResult: 'FAIL', remakeCount: 2, nextStep: 'Re-dispatch for remake',
      deliveryReady: false,
      deliveryReason: 'LAB-2026-0027 failed its check and is being remade.',
    },
    {
      id: 'l4', reference: 'LAB-2026-0024', patientLabel: 'SYNTHETIC Arjun P.',
      vendor: 'Precision Dental Lab', workType: 'Veneer', toothRef: '11',
      status: 'PATIENT_READY', expectedLabel: 'last Tuesday', overdue: false,
      qcResult: 'PASS', remakeCount: 0, nextStep: 'Book the delivery appointment',
      deliveryReady: true, deliveryReason: null,
    },
  ];

  const batches: DemoBatch[] = [
    { id: 'b1', batchRef: 'STER-0912', stage: 'RELEASED', packCount: 12, operator: 'Sterilisation', cycleResult: 'PASS' },
    { id: 'b2', batchRef: 'STER-0913', stage: 'AUTOCLAVED', packCount: 9, operator: 'Sterilisation', cycleResult: 'PASS' },
    { id: 'b3', batchRef: 'STER-0914', stage: 'ULTRASONIC', packCount: 7, operator: 'Senior assistant', cycleResult: null },
    { id: 'b4', batchRef: 'STER-0911', stage: 'QUARANTINED', packCount: 6, operator: 'Sterilisation', cycleResult: 'INCONCLUSIVE' },
  ];

  /**
   * Patients who have gone quiet, as the retention rule would find them.
   *
   * Synthetic, and named as such. Four rows, chosen so the screen shows every
   * state it has to handle rather than four of the same: two mid-treatment
   * (one already picked up by a colleague), one who never started, and — not
   * in this list at all — the patient who booked last week, whose absence is
   * the point. See packages/contracts/src/retention.ts.
   */
  const retention: DemoRetention[] = [
    {
      patientId: 'rp-1', patientLabel: 'SYNTHETIC Meera R.', uhid: 'SYN-1041',
      reason: 'STOPPED_MID_TREATMENT', daysSinceLastVisit: 63,
      stake: '1 treatment left unfinished', outreach: null,
    },
    {
      patientId: 'rp-2', patientLabel: 'SYNTHETIC Kabir S.', uhid: 'SYN-1077',
      reason: 'STOPPED_MID_TREATMENT', daysSinceLastVisit: 41,
      stake: '2 treatments left unfinished',
      // Already claimed and rung once, with no answer. On screen this is the
      // difference between "nobody has called" and "somebody tried".
      outreach: {
        id: 'ro-2', raisedAt: new Date(Date.now() - 2 * 864e5).toISOString(),
        contactedAt: new Date(Date.now() - 864e5).toISOString(),
        outcome: 'NO_ANSWER', note: null,
      },
    },
    {
      patientId: 'rp-3', patientLabel: 'SYNTHETIC Devika N.', uhid: 'SYN-1108',
      reason: 'NEVER_STARTED', daysSinceLastVisit: 118,
      stake: '3 planned treatments never begun', outreach: null,
    },
    {
      patientId: 'rp-4', patientLabel: 'SYNTHETIC Rohan T.', uhid: 'SYN-1132',
      reason: 'NEVER_STARTED', daysSinceLastVisit: 34,
      stake: '1 planned treatment never begun', outreach: null,
    },
  ];

  return {
    tasks, visits, attention, incidents, patientProcedures, followups,
    assets, stock, implants, batches, labCases, retention,
    retentionContacted: 0, retentionReturning: 0,
    nextIncidentNumber: 8,
    /**
     * The audit trail. Append-only by construction — nothing in this file
     * updates or removes an entry, and the contracts layer offers no way to.
     */
    audit: [] as AuditEntry[],
    nextAuditId: 1,
    /** Engine B demo state — has the clinical event been recorded yet. */
    cascadeFired: false,
    /**
     * Engine D. The seven checks before an implant may start. Two fail on
     * purpose: a gate that is satisfied on first render proves nothing.
     */
    gate: [
      { id: 'g1', label: 'Consent signed', met: false },
      { id: 'g2', label: 'Medical history updated', met: true },
      { id: 'g3', label: 'Pre-op instructions given', met: true },
      { id: 'g4', label: 'Medication reminder completed', met: true },
      { id: 'g5', label: 'Implant and components available', met: true },
      { id: 'g6', label: 'Surgical kit sterilised', met: false },
      { id: 'g7', label: 'Pre-op records available', met: true },
    ],
    signedIn: null as Person | null,
    /**
     * The engine's world, held in the browser.
     *
     * Not a mock. `readiness()`, `closing()`, `decisions()` and `record()` are
     * the product's own functions, imported unchanged — they are pure
     * `(world, now) => X`, which is exactly what makes this possible. So the
     * two engine screens in this file are running the real rules, and a
     * refusal here is the same sentence the server would give.
     *
     * What is still a stand-in is *enforcement*: a browser can be lied to, and
     * the server is where that matters. This is for clicking through a
     * morning, not for security.
     */
    world: startedMorning(),
    /**
     * Set by the demo's "Jump to the end of the day" control. A real clinic
     * gets here by working through eleven hours; a person reviewing the app in
     * five minutes should not have to. Nothing else in this file reads the
     * wall clock differently — the flag only stands in for time having passed.
     */
    endOfDay: false,
  };
}

/**
 * The six days before today, oldest first — a synthetic history, so the week
 * chart has something to say the moment the file opens.
 *
 * One entry is deliberately `null`: the clinic was shut, and a shut day must
 * draw as absent rather than as 0% readiness. That is the rule the real
 * overview service keeps, and a demo that quietly drew it as zero would be
 * teaching the wrong thing about the product.
 */
const HISTORY: Array<{ readiness: number | null; independentOf: number; independent: number }> = [
  { readiness: 100, independentOf: 7, independent: 6 },
  { readiness: 86, independentOf: 6, independent: 4 },
  { readiness: 100, independentOf: 7, independent: 6 },
  { readiness: null, independentOf: 0, independent: 0 },
  { readiness: 71, independentOf: 5, independent: 3 },
  { readiness: 100, independentOf: 7, independent: 7 },
];

/** Four operatories, as the clinic has. */
const DEMO_OPERATORIES: Operatory[] = [1, 2, 3, 4].map((n) => ({
  id: `op-${n}`, label: `Operatory ${n}`, position: n,
}));

/**
 * The demo's clinic clock: quarter past nine.
 *
 * Deliberately fixed rather than read from the viewer's watch. A file opened
 * at three in the afternoon would otherwise show a morning that was five hours
 * overdue before anybody touched it, and a file opened at six in the morning
 * would show one with four hours in hand — the same file telling two people
 * different things about the same clinic.
 *
 * 09:15 is chosen because it is mid-morning: the clinic is open, the first
 * patient is at ten, and there is enough time left that the list reads as work
 * rather than as an emergency.
 */
const DEMO_MINUTE = 9 * 60 + 15;
function demoMinute(): number { return DEMO_MINUTE; }

/**
 * A morning already under way.
 *
 * The clinic is unlocked, two rooms are prepared and the run has been
 * released — so the file opens on a clinic that is halfway through its
 * morning rather than on a cold building. Everything after that is the
 * viewer's to drive, and "Start again" comes back here.
 *
 * Recorded through `record()` like any other event, so the demo's opening
 * state obeys the same rules as everything the viewer does next. A seed that
 * wrote the world directly could put it in a state the engine would never
 * allow, and then the first click would look like a bug.
 */
function startedMorning(): World {
  let w = emptyWorld(8 * 60 + 30, {
    operatories: DEMO_OPERATORIES,
    firstPatientAt: 10 * 60,
    shutAt: 18 * 60 + 30,
  });
  const say = (type: ClinicEvent, subjectId: string, by: RoleCode, label?: string) => {
    const out = recordEvent({ ...w }, {
      type, subjectId, by, ...(label ? { subjectLabel: label } : {}),
    });
    if (out.ok) w = out.world;
  };
  say(ClinicEvent.CLINIC_UNLOCKED, 'today', 'RECEPTION' as RoleCode, 'the clinic');
  w = { ...w, now: 8 * 60 + 50 };
  say(ClinicEvent.OPERATORY_READY, 'op-1', 'DENTAL_ASSISTANT' as RoleCode, 'Operatory 1');
  say(ClinicEvent.OPERATORY_READY, 'op-2', 'DENTAL_ASSISTANT' as RoleCode, 'Operatory 2');
  w = { ...w, now: 9 * 60 };
  const b = 'batch-am';
  say(ClinicEvent.BATCH_COLLECTED, b, 'STERILIZATION_TECHNICIAN' as RoleCode, 'STER-AM');
  say(ClinicEvent.BATCH_ULTRASONIC_DONE, b, 'STERILIZATION_TECHNICIAN' as RoleCode);
  say(ClinicEvent.BATCH_PACKED, b, 'STERILIZATION_TECHNICIAN' as RoleCode);
  say(ClinicEvent.BATCH_AUTOCLAVED, b, 'STERILIZATION_TECHNICIAN' as RoleCode);
  say(ClinicEvent.BATCH_RELEASED, b, 'SENIOR_ASSISTANT' as RoleCode);
  return { ...w, now: DEMO_MINUTE };
}

let db = freshState();

/** Start the morning again from the top. */
export function resetDemo() {
  const who = db.signedIn;
  db = freshState();
  db.signedIn = who;
}

/**
 * Wind the demo forward to closing time.
 *
 * The morning is worked through — every opening check confirmed, most patients
 * seen — and the end-of-day set becomes due. Deliberately NOT a clean day: one
 * patient arrived and never went through, one never came, and the autoclave log
 * line is still open. A handover with nothing on it proves nothing; the screen
 * exists precisely for the days that do not end tidily.
 */
export function jumpToEndOfDay() {
  db.endOfDay = true;
  for (const t of db.tasks) {
    if (t.process !== 'Opening Readiness') continue;
    t.status = 'VERIFIED';
    t.completedBy ??= t.assignee;
    t.blockedBy = null;
    // Everything the morning asked for was confirmed, so the checklists read
    // as genuinely done rather than as blank rows marked complete.
    for (const i of t.items) {
      t.responses[i.id] = { checked: true, value: i.requiresValue ? 24 : null };
    }
  }
  const seen = ['v1', 'v2', 'v5'];
  for (const v of db.visits) {
    if (seen.includes(v.id)) { v.status = 'COMPLETED'; continue; }
    if (v.id === 'v3') { v.status = 'ARRIVED'; v.arrivedAt = Date.now() - 40 * 60_000; continue; }
    if (v.id === 'v6') v.status = 'NO_SHOW';
  }
}

/* -------------------------------------------------------------------------
 * Synthetic bookings for the patient event engine
 *
 * Six treatments across six categories, at real hours of the demo day. None
 * is a task list — each is one row, and every requirement on screen was
 * derived from it by the engine.
 * ---------------------------------------------------------------------- */

const at = (h: number, m = 0) => h * 60 + m;

export const DEMO_BOOKINGS: Booking[] = [
  { id: 'bk-1', treatmentCode: 'IMPLANT', patientLabel: 'Anita Rao', at: at(11, 0), sitting: 1 },
  { id: 'bk-2', treatmentCode: 'EXTRACT', patientLabel: 'Sunil Mehta', at: at(12, 30), sitting: 1 },
  { id: 'bk-3', treatmentCode: 'RCT_POST', patientLabel: 'Farah Qureshi', at: at(14, 0), sitting: 1 },
  { id: 'bk-4', treatmentCode: 'SCALE', patientLabel: 'Devika Nair', at: at(15, 30), sitting: 1 },
  { id: 'bk-5', treatmentCode: 'CROWN', patientLabel: 'Imran Shaikh', at: at(16, 15), sitting: 2 },
  { id: 'bk-6', treatmentCode: 'EMERG_ABSCESS', patientLabel: 'Rakesh Pillai', at: at(17, 0), sitting: 1 },
];

/**
 * What is known about each of them, and it is not the same for each.
 *
 * Sunil is anticoagulated, which adds work. Rakesh walked in this afternoon
 * and nobody has asked him anything, which is why his abscess will not start
 * — not because anything is wrong with him, but because nobody knows.
 */
const KNOWN: PatientFacts = {
  anticoagulated: false, prophylaxisIndicated: false, diabetic: false,
  antiresorptive: false, pregnant: false, penicillinAllergy: false,
  smoker: false, minor: false,
};

const DEMO_FACTS: Record<string, PatientFacts> = {
  'bk-1': { ...KNOWN, smoker: true },
  'bk-2': { ...KNOWN, anticoagulated: true },
  'bk-3': { ...KNOWN, diabetic: true },
  'bk-4': KNOWN,
  'bk-5': KNOWN,
  'bk-6': NOTHING_KNOWN,
};

const factsFor = (bookingId: string): PatientFacts =>
  DEMO_FACTS[bookingId] ?? NOTHING_KNOWN;

/**
 * How far each booking has got — as events, not as state.
 *
 * A demo where nothing has been done makes every card block on the same first
 * item, which shows the list and hides the engine. So each booking is worked
 * up to a different point and each one is held by something different:
 *
 *   Anita     ready to go, one advisory outstanding
 *   Sunil     everything done except the bleeding plan — he is anticoagulated
 *   Farah     consent and rubber dam still to come
 *   Devika    clear
 *   Imran     waiting on the laboratory
 *   Rakesh    walked in this afternoon and nobody has asked him anything
 *
 * `except` names what has NOT been done. Everything else blocking is reported
 * met, which is done by asking the engine what is outstanding rather than by
 * listing item ids here — so this stays true when the protocol changes.
 */
const DEMO_PROGRESS: Record<string, readonly string[]> = {
  'bk-1': ['GUIDE'],
  'bk-2': ['ANTICOAG'],
  'bk-3': ['CONSENT', 'DAM'],
  'bk-4': [],
  'bk-5': ['LAB_BACK', 'FIT_APPT'],
  'bk-6': [],
};

/**
 * Nothing here is a state field. Every one of these is a `CARE_ITEM_MET`
 * event, exactly as a person tapping Done would produce, and the screen
 * derives everything it shows from them.
 *
 * Deliveries appear only once the day has been wound forward, because a
 * treatment at 16:15 has not happened at 09:15 and pretending otherwise would
 * be the one thing the design principle forbids.
 */
function careProgressEvents(now: number, endOfDay: boolean): ReadinessEvent[] {
  const out: ReadinessEvent[] = [];
  for (const b of DEMO_BOOKINGS) {
    const skip = DEMO_PROGRESS[b.id] ?? [];
    const fresh = careFor(b, factsFor(b.id), [], now);
    if (fresh === null) continue;
    for (const t of fresh.before) {
      if (t.state !== 'OUTSTANDING' || skip.includes(t.id)) continue;
      out.push({
        type: ClinicEvent.CARE_ITEM_MET,
        subjectId: `${b.id}#${t.id}`,
        at: Math.min(t.dueAt, now),
      });
    }
    if (endOfDay && b.at <= now) {
      out.push({ type: ClinicEvent.TREATMENT_DELIVERED, subjectId: b.id, at: b.at + 30 });
    }
  }
  return out;
}

const careTaskView = (t: CareTask) => ({
  id: t.id, label: t.label, owner: t.owner as string,
  stage: t.stage, gate: t.gate, state: t.state,
  dueAt: t.dueAt, doneAt: t.doneAt, late: t.late,
  because: t.because, standsAsideBecause: t.standsAsideBecause,
});

const careView = (c: Care) => ({
  bookingId: c.booking.id,
  patientLabel: c.booking.patientLabel,
  treatmentCode: c.treatment.code,
  treatmentName: c.treatment.name,
  category: c.treatment.category as string,
  at: c.booking.at,
  sitting: c.booking.sitting,
  sittings: c.treatment.sittings,
  before: c.before.map(careTaskView),
  after: c.after.map(careTaskView),
  open: c.open.map(careTaskView),
  mayStart: c.mayStart,
  blockedBy: c.blockedBy,
  unknownFacts: c.unknownFacts as string[],
  delivered: c.delivered,
  owedAfter: c.owedAfter.map(careTaskView),
});

/* -------------------------------------------------------------------------
 * Synthetic service history for the equipment engine
 *
 * Every date here is an event, exactly as a person tapping "serviced" would
 * produce. Nothing is a status field.
 *
 * Deliberately uneven, and two of the unevennesses are the point:
 *
 *   AUTOCLAVE-01  spore test nine days ago — a week is the interval, so the
 *                 autoclave is unusable and says why
 *   COMPRESSOR-01 service 190 days ago against a 180-day interval — overdue
 *   SEALER-01     no history at all — not "nothing due", which is what the
 *                 obvious arithmetic would say
 *   UPS-01        no history at all
 *   CHAIR-03      failed this morning and not yet restored
 * ---------------------------------------------------------------------- */

/** Days ago, as a minute on the demo clock. */
const daysAgo = (now: number, n: number) => now - n * 24 * 60;

/** Assets whose history is deliberately absent. */
const NO_HISTORY = new Set(['SEALER-01', 'UPS-01']);

/** Cycles that are deliberately behind, by however many days. */
const BEHIND: Record<string, number> = {
  'AUTOCLAVE-01#SPORE': 9,
  'COMPRESSOR-01#SERVICE': 190,
  'FRIDGE-01#TEMP_LOG': 12,
  'CURE-02#RADIOMETER': 44,
  'SERVER-01#RESTORE_TEST': 120,
};

function assetHistory(now: number): ReadinessEvent[] {
  const out: ReadinessEvent[] = [];
  for (const a of ASSETS) {
    if (NO_HISTORY.has(a.tag)) continue;
    for (const c of a.cycles) {
      const key = `${a.tag}#${c.id}`;
      // Behind where the table says so; otherwise a third of the way through
      // the interval, so most of the register is quietly in date.
      const ago = BEHIND[key] ?? Math.floor(c.everyDays / 3);
      out.push({ type: CE.ASSET_SERVICED, subjectId: key, at: daysAgo(now, ago) });
    }
    // The morning's checks, all done except the ones nobody got to.
    if (a.dailyCheck !== null && a.tag !== 'PUMP-01' && a.tag !== 'OXYGEN-01') {
      out.push({ type: CE.ASSET_CHECKED, subjectId: a.tag, at: now - 45 });
    }
  }
  // One chair down since first thing, and one long-closed failure behind it.
  out.push({ type: CE.ASSET_FAILED, subjectId: 'CHAIR-03', at: now - 130 });
  out.push({ type: CE.ASSET_FAILED, subjectId: 'SUCTION-01', at: daysAgo(now, 20) });
  out.push({ type: CE.ASSET_RESTORED, subjectId: 'SUCTION-01', at: daysAgo(now, 20) + 300 });
  return out;
}

/** A minute rendered as a day, because a service date is not a clock time. */
const dayWord = (m: number | null, now: number): string | null => {
  if (m === null) return null;
  const d = Math.round((now - m) / (24 * 60));
  if (d === 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d > 0) return `${d} days ago`;
  return `in ${-d} days`;
};

const assetTaskView = (t: AssetTask) => ({
  assetTag: t.assetTag, assetName: t.assetName, cycleId: t.cycleId,
  label: t.label, owner: t.owner as string, dueAt: t.dueAt,
  overdue: t.overdue, daysLate: t.daysLate, blocks: t.blocks, because: t.because,
});

const assetView = (r: AssetRecord, _events: readonly ReadinessEvent[], now: number) => ({
  tag: r.asset.tag, name: r.asset.name, category: r.asset.category as string,
  location: r.asset.location, responsible: r.asset.responsible as string,
  criticality: r.asset.criticality as string,
  make: r.asset.make, model: r.asset.model, serial: r.asset.serial,
  state: r.state, headline: r.headline,
  hasServiceCycle: r.hasServiceCycle,
  lastServicedDay: dayWord(r.lastServicedAt, now),
  nextServiceDay: dayWord(r.nextServiceAt, now),
  checkDue: r.checkDue, dailyCheck: r.asset.dailyCheck,
  breakdowns: r.breakdowns, downtimeMinutes: r.downtimeMinutes,
  amcAction: r.amcAction,
  amcVendor: r.asset.amc?.vendor ?? null,
  amcCovers: r.asset.amc?.covers ?? null,
  documents: [...r.asset.documents],
  unknowns: [...r.unknowns],
  cycles: r.asset.cycles.map((c) => ({
    id: c.id, label: c.label, everyDays: c.everyDays,
    owner: c.owner as string, blocks: c.blocks,
    due: r.due.find((t) => t.cycleId === c.id)
      ? assetTaskView(r.due.find((t) => t.cycleId === c.id)!) : null,
  })),
});

export function signInAs(key: string) {
  db.signedIn = PEOPLE.find((p) => p.key === key) ?? null;
}

/**
 * The clinic's vital signs, for the screen shown before anyone takes command.
 *
 * Read straight off the same state every other screen reads, so the front door
 * and the command centre can never disagree about whether the clinic is ready.
 * Available without signing in because this is the shell's own status display,
 * not the application — a cockpit shows aircraft state before the pilot
 * identifies themselves.
 */
export function clinicPulse() {
  const opening = tally('Opening Readiness');
  const visits = db.visits.filter((v) => v.status !== 'CANCELLED');
  const critical = db.attention.filter((a) => a.open && a.severity === 'PATIENT_SAFETY');
  const important = db.attention.filter((a) => a.open && a.severity !== 'PATIENT_SAFETY');
  const assetsDown = db.assets.filter((a) => a.status !== 'OPERATIONAL');
  const sterileReady = db.batches.some((b) => b.stage === 'RELEASED');

  const done = db.tasks.filter((t) => ['COMPLETED', 'VERIFIED'].includes(t.status)).length;
  const total = db.tasks.length;

  return {
    clinicName: 'SYNTHETIC KB Dental Andheri',
    // OPEN once the opening set is done and nothing safety-critical is blocking.
    open: !!opening?.complete && assetsDown.length === 0 && sterileReady,
    openingDone: opening?.done ?? 0,
    openingTotal: opening?.total ?? 0,
    /** A real fraction of real work. Null when there is nothing to measure. */
    health: total === 0 ? null : Math.round((done / total) * 100),
    patients: visits.length,
    inChair: db.visits.filter((v) => v.status === 'IN_CHAIR').length,
    // KuBi has no rota, so this is doctors with a patient booked today, said
    // as that rather than as "doctors on shift", which it does not know.
    doctorsBooked: new Set(db.visits.filter((v) => v.status !== 'CANCELLED')
      .map((v) => v.chairLabel)).size,
    critical: critical.length,
    important: important.length,
    firstPatientInMinutes: nextVisit()?.startsInMinutes ?? null,
  };
}

export function currentPerson(): Person | null {
  return db.signedIn;
}

// ---------------------------------------------------------------------------

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** The world at this minute. The demo's end-of-day control moves the clock. */
function engineWorld(): World {
  return { ...db.world, now: db.endOfDay ? 18 * 60 + 40 : demoMinute() };
}

/** Whoever is signed in, as a role the engine knows. */
function engineRole(): RoleCode {
  return (db.signedIn?.roles[0] ?? 'RECEPTION') as RoleCode;
}

const startOf = (t: Task) => OPENING_DUE + t.minutesFromOpening * 60_000;
const visitStart = (v: Visit) => OPENED_AT + v.startsInMinutes * 60_000;

function raise(a: Omit<Attention, 'id' | 'open'>) {
  // Deduplicated the way the real attention service is: same code, same source,
  // still open, becomes one item rather than fifty.
  const existing = db.attention.find(
    (x) => x.open && x.code === a.code && x.instanceId === a.instanceId,
  );
  if (existing) return existing;
  const item: Attention = { ...a, id: `a-${db.attention.length + 1}`, open: true };
  db.attention.push(item);
  return item;
}

/**
 * Counts for one half of the day. Null when that half does not exist, which is
 * not the same as "none done" and must never render as a zero.
 */
/**
 * Why this task exists, for the person holding the tablet.
 *
 * Connection 3. Derived from the standard every time rather than copied onto
 * the task, so a task can never claim a standard it no longer matches.
 * Returns null for the handful of tasks that predate the library — an absent
 * trace is honest; an invented one is not.
 */
function traceOf(t: Task): WorkProvenance | null {
  if (!t.standardId) return null;
  const std = standardById(t.standardId);
  return std ? provenanceOf(std) : null;
}

function tally(process: Task['process']) {
  const forProcess = db.tasks.filter((t) => t.process === process);
  if (forProcess.length === 0) return null;
  const done = forProcess.filter((t) => ['COMPLETED', 'VERIFIED'].includes(t.status)).length;
  return { total: forProcess.length, done, complete: done === forProcess.length };
}

/**
 * The 16 parameters rolled into one score — a faithful copy of the server's
 * rules, including the three that stop a dashboard lying:
 *
 *   - nothing to measure is GREY and null, never a zero
 *   - GREY is excluded from the roll-up rather than averaged in as an absence
 *   - a patient-safety problem makes its parameter RED whatever the arithmetic
 */
function operationalHealth() {
  const GREEN_AT = 95;
  const AMBER_AT = 80;

  const rag = (percent: number | null, hasPatientSafety: boolean) => {
    if (hasPatientSafety) return 'RED';
    if (percent === null) return 'GREY';
    if (percent >= GREEN_AT) return 'GREEN';
    if (percent >= AMBER_AT) return 'AMBER';
    return 'RED';
  };

  const parameterOf = (a: Attention): ParameterKey => {
    const t = db.tasks.find((x) => x.id === a.instanceId);
    // Anything we cannot place goes to quality rather than being dropped: an
    // exception nobody can see is worse than one filed under the wrong head.
    return t?.parameter ?? 'QUALITY_CAPA';
  };

  const open = db.attention.filter((a) => a.open);

  const parameters = PARAMETERS.map((parameter) => {
    const mine = db.tasks.filter((t) => t.parameter === parameter);
    // Confirmed by someone, not merely claimed by the doer.
    const done = mine.filter((t) => t.status === 'VERIFIED').length;
    const myProblems = open.filter((a) => parameterOf(a) === parameter);
    const patientSafety = myProblems.filter((a) => a.severity === 'PATIENT_SAFETY').length;
    const percent = mine.length === 0 ? null : Math.round((done / mine.length) * 100);
    const outstanding = mine.length - done;

    const because = patientSafety > 0
      ? (patientSafety === 1
        ? 'A patient safety problem is open.'
        : `${patientSafety} patient safety problems are open.`)
      : outstanding > 0 && myProblems.length > 0
        ? `${outstanding} not confirmed, ${myProblems.length} ${myProblems.length === 1 ? 'problem' : 'problems'} open.`
        : outstanding > 0
          ? `${outstanding} of ${mine.length} not confirmed yet.`
          : myProblems.length > 0
            ? `${myProblems.length} ${myProblems.length === 1 ? 'problem' : 'problems'} still open.`
            : null;

    return {
      parameter,
      percent,
      status: rag(percent, patientSafety > 0),
      done,
      total: mine.length,
      openProblems: myProblems.length,
      patientSafetyProblems: patientSafety,
      because,
    };
  });

  const measured = parameters.filter((p) => p.percent !== null);
  const overall = measured.length === 0
    ? null
    : Math.round(measured.reduce((n, p) => n + p.percent!, 0) / measured.length);

  const RANK: Record<string, number> = { RED: 0, AMBER: 1, GREEN: 2, GREY: 3 };
  parameters.sort((a, b) =>
    RANK[a.status]! - RANK[b.status]!
    || b.patientSafetyProblems - a.patientSafetyProblems
    || b.openProblems - a.openProblems
    || (a.percent ?? 101) - (b.percent ?? 101));

  return {
    percent: overall,
    status: rag(overall, parameters.some((p) => p.patientSafetyProblems > 0)),
    parameters,
    needsAttention: {
      critical: open.filter((a) => a.severity === 'PATIENT_SAFETY' || a.severity === 'CRITICAL').length,
      attention: open.filter((a) => a.severity !== 'PATIENT_SAFETY' && a.severity !== 'CRITICAL').length,
    },
  };
}

/**
 * Briefing helpers.
 *
 * A section with no items is still rendered — it says "opening is done" rather
 * than vanishing. A section that disappears when it is satisfied teaches
 * people that its absence means nothing to do, which is indistinguishable from
 * it being broken.
 */
interface BriefItem {
  id: string; kind: 'task' | 'fact'; text: string; detail: string | null;
  /** Which of the five object types raised this. */
  origin: TaskOrigin;
  taskId: string | null; priority: string | null; tone: string | null;
  blockedBy: string | null; activityCode: string | null;
  /** Whose work it is, when it is not the reader's. Job title, never a name. */
  owner?: string | null;
}

function section(
  key: string, label: string, tone: string, hint: string | null,
  emptyText: string, items: BriefItem[],
) {
  return { key, label, tone, hint, emptyText, items };
}

function briefing(
  roleLabel: string, question: string,
  work: { total: number; done: number } | null,
  sections: ReturnType<typeof section>[],
) {
  // One answer, then one action, then everything else. Derived from the
  // sections rather than authored, so a screen can never claim a headline its
  // own content does not support — including the claim that something can be
  // done about it. headlineFor() is shared with the real API precisely because
  // this logic was duplicated and both copies had the same bug.
  const headline = headlineFor(sections);
  return { roleLabel, question, work, headline, sections };
}

/**
 * A task's risk class, from the parameter it belongs to. The real service
 * reads this off the activity; the demo derives it so the rails match what the
 * frozen matrix says rather than being decorative.
 */
function priorityOf(t: Task): string {
  if (t.parameter === 'SAFETY_EMERGENCY' || t.parameter === 'INFECTION_CONTROL') {
    return 'PATIENT_SAFETY';
  }
  if (t.parameter === 'OPENING_READINESS' || t.parameter === 'ROOM_CHAIR_READINESS') {
    return 'CRITICAL';
  }
  return t.checkerRoles.length > 0 ? 'IMPORTANT' : 'ROUTINE';
}

function nextVisit(): Visit | null {
  const upcoming = db.visits
    .filter((v) => ['BOOKED', 'ARRIVED', 'IN_CHAIR'].includes(v.status))
    .sort((a, b) => a.startsInMinutes - b.startsInMinutes);
  return upcoming[0] ?? null;
}

function taskView(t: Task, me: Person) {
  return {
    id: t.id,
    title: t.title,
    standard: t.standard,
    status: t.status,
    dueAt: new Date(startOf(t)).toISOString(),
    isMine: t.assignee === me.employeeId,
    needsSomeoneElseToCheck: !t.selfVerifyAllowed,
    items: t.items.map((i) => ({
      id: i.id,
      label: i.label,
      requiresValue: i.requiresValue ?? false,
      unit: i.unit ?? null,
      checked: t.responses[i.id]?.checked ?? false,
      value: t.responses[i.id]?.value ?? null,
    })),
    cantConfirm: t.cantConfirm,
    canOverrideBlock: t.cantConfirm !== null,
    blockedBy: t.blockedBy,
    problemKinds: PROBLEM_KINDS,
    // The row in the owner's own operating standard this came from. Distinct
    // from `spec` below: spec is the control model, this is the clinic's own
    // sentence about what good looks like.
    why: traceOf(t),
    // Why this exists, who the four people are, and what it moves. Without
    // these a task is a tickable box, which is the thing the owner said this
    // must not degrade into.
    spec: (() => {
      const w = workSpecFor(t);
      return {
        origin: w.origin,
        originLabel: ORIGIN_LABEL[w.origin],
        engine: w.engine,
        trigger: w.trigger,
        parameter: t.parameter,
        process: t.process,
        responsibility: w.responsibility,
        escalation: w.escalation,
        kpi: w.kpi,
      };
    })(),
  };
}

const STAGES = ['OPEN', 'CONTAINED', 'INVESTIGATED', 'ACTIONS_PLANNED', 'VERIFYING', 'CLOSED'] as const;

/**
 * What this incident is waiting for, in one clause.
 *
 * A status word tells somebody where a thing is; it does not tell them what to
 * do. The requirement asks management to see deviations rather than lists, and
 * a deviation nobody knows how to clear is just a different kind of list.
 */
function nextStepFor(inc: Incident): string | null {
  switch (inc.status) {
    case 'OPEN': return 'Record what was done about it today';
    case 'CONTAINED': return 'Record why it happened';
    case 'INVESTIGATED':
      return inc.actions.some((a) => a.type === 'PREVENTIVE')
        ? 'Add a corrective action'
        : 'Add a preventive action — what stops the next one';
    case 'ACTIONS_PLANNED': {
      const n = inc.actions.filter((a) => a.status === 'OPEN' || a.status === 'ACTION_IN_PROGRESS').length;
      return n > 0 ? `${n} action${n === 1 ? '' : 's'} still to do` : null;
    }
    case 'VERIFYING': {
      const n = inc.actions.filter((a) => a.status === 'EFFECTIVENESS_PENDING').length;
      return n > 0
        ? `${n} action${n === 1 ? '' : 's'} waiting on an effectiveness check — did it actually work?`
        : null;
    }
    default: return null;
  }
}

function incidentView(inc: Incident) {
  return {
    ...inc,
    stage: STAGES.indexOf(inc.status),
    stageCount: STAGES.length,
    blockedBy: nextStepFor(inc),
    openActions: inc.actions.filter((a) => a.status !== 'EFFECTIVE' && a.status !== 'CLOSED').length,
    totalActions: inc.actions.length,
    canClose: inc.actions.length > 0
      && inc.actions.some((a) => a.type === 'PREVENTIVE')
      && inc.actions.every((a) => a.status === 'EFFECTIVE' || a.status === 'CLOSED'),
  };
}

/** The same red-flag rule the server holds. A demo that disagreed would lie. */
function redFlagReason(r: { pain: string | null; swelling: string | null;
  bleeding: string | null; medication: string | null }): string | null {
  if (r.pain === 'SEVERE' && r.swelling === 'EXCESSIVE') return 'Severe pain with excessive swelling';
  if (r.bleeding === 'YES') return 'Bleeding reported';
  if (r.swelling === 'EXCESSIVE') return 'Excessive swelling';
  if (r.pain === 'SEVERE') return 'Severe pain';
  if (r.medication === 'PROBLEM') return 'Problem with medication';
  return null;
}

/**
 * The enforcement matrix, in the demo, matching packages/contracts exactly.
 *
 * In EVERY mode, UNKNOWN and NOT_CONFIGURED behave at least as strictly as
 * FAIL. That is AP-1, and a demo that quietly let an unevaluable requirement
 * pass would teach precisely the wrong thing about the product.
 */
const MATRIX: Record<string, Record<string, string>> = {
  ADVISORY: { PASS: 'PROCEED', NOT_APPLICABLE: 'PROCEED', FAIL: 'WARN', UNKNOWN: 'WARN', NOT_CONFIGURED: 'WARN' },
  BLOCK_OVERRIDABLE: { PASS: 'PROCEED', NOT_APPLICABLE: 'PROCEED', FAIL: 'BLOCK_OVERRIDABLE', UNKNOWN: 'BLOCK_OVERRIDABLE', NOT_CONFIGURED: 'BLOCK_OVERRIDABLE' },
  BLOCK_HARD: { PASS: 'PROCEED', NOT_APPLICABLE: 'PROCEED', FAIL: 'BLOCK_HARD', UNKNOWN: 'BLOCK_HARD', NOT_CONFIGURED: 'BLOCK_HARD' },
};
const DECISION_RANK: Record<string, number> = {
  BLOCK_HARD: 0, BLOCK_OVERRIDABLE: 1, WARN: 2, PROCEED: 3,
};

function readinessView(pp: PatientProcedure) {
  const requirements = pp.requirements.map((r) => ({
    ...r, decision: MATRIX[r.enforcement]![r.result]!,
  }));
  const decision = requirements.reduce(
    (worst, r) => (DECISION_RANK[r.decision]! < DECISION_RANK[worst]! ? r.decision : worst),
    'PROCEED',
  );
  const blocking = requirements
    .filter((r) => r.decision !== 'PROCEED')
    .sort((a, b) => DECISION_RANK[a.decision]! - DECISION_RANK[b.decision]!);

  const status = pp.overriddenBy ? 'OVERRIDDEN'
    : decision === 'PROCEED' ? 'READY'
    // "Could not be determined" is its own answer, never NOT_READY.
    : requirements.some((r) => r.result === 'UNKNOWN' || r.result === 'NOT_CONFIGURED') ? 'PENDING'
    : requirements.some((r) => r.result === 'PASS') ? 'PARTIAL' : 'NOT_READY';

  return {
    ...pp, requirements, decision, blocking, status,
    overridable: decision === 'BLOCK_OVERRIDABLE',
    metCount: requirements.filter((r) => r.result === 'PASS').length,
  };
}

/**
 * The eight management scores of §7, with a target and a seven-day trend.
 *
 * Derived from the demo's own state where the demo has state to derive from,
 * and fixed where it does not -- a domain whose module is not built yet
 * reports GREY rather than an invented percentage. Showing a number for
 * something KuBi cannot measure is exactly the kind of lie this product is
 * meant to stop.
 */
function ownerDomains() {
  const opening = tally('Opening Readiness');
  const openingScore = opening && opening.total > 0
    ? Math.round((opening.done / opening.total) * 100) : null;
  // No opening set at all is an absence, not a nought.

  // Patient care is only measurable once somebody has actually been through.
  // At 08:52 nobody has, and that is EARLY, not a failure -- scoring it 0%
  // would paint a clinic that has done nothing wrong bright red, which is the
  // exact failure mode the GREY rule exists to prevent.
  const seen = db.visits.filter((v) => v.status === 'COMPLETED').length;
  const expected = db.visits.filter((v) => v.status !== 'CANCELLED').length;
  const patientCare = seen === 0 ? null : Math.round((seen / expected) * 100);

  // Share of stock lines that are not short, and of assets that are in
  // service. Both are counts of things the clinic can act on today.
  const inventoryScore = db.stock.length === 0 ? null
    : Math.round((db.stock.filter((s) => s.state === 'OK').length / db.stock.length) * 100);
  const equipmentScore = db.assets.length === 0 ? null
    : Math.round((db.assets.filter((a) => a.status === 'OPERATIONAL').length / db.assets.length) * 100);

  const rag = (score: number | null, target: number) => {
    if (score === null) return 'GREY';
    if (score >= target) return 'GREEN';
    return score >= target - 10 ? 'AMBER' : 'RED';
  };

  const d = (
    name: string, score: number | null, target: number,
    trend: number[], note: string, built = true,
  ) => ({
    name, score, target, trend, note,
    status: built ? rag(score, target) : 'GREY',
    // A domain nothing measures yet says so, rather than scoring zero.
    built,
  });

  return [
    d('Clinic Readiness', openingScore, 100,
      openingScore === null ? [] : [100, 86, 100, 71, 100, 100, openingScore],
      'No opening set generated today',
      openingScore !== null),
    d('Patient Care', patientCare, 95,
      patientCare === null ? [] : [96, 94, 97, 93, 96, 95, patientCare],
      'No patients have been through yet today',
      patientCare !== null),
    d('Clinical Documentation', 88, 100, [92, 90, 88, 91, 89, 87, 88],
      'Cases with complete required records'),
    d('Infection Control', 100, 100, [100, 100, 96, 100, 100, 100, 100],
      'Sterilisation, PPE and biomedical waste'),
    d('Appointments', 83, 95, [88, 91, 86, 84, 82, 85, 83],
      'Confirmation, cancellation, no-show, utilisation'),
    d('Lab', null, 90, [], 'Lab case module not built yet', false),
    // Inventory and Equipment are measurable now that those engines exist.
    // Derived from the same rows the Operations screen shows, so the owner's
    // number and the manager's list can never disagree.
    d('Inventory', inventoryScore, 95,
      inventoryScore === null ? [] : [97, 96, 94, 95, 93, 94, inventoryScore],
      'No stock items are set up yet',
      inventoryScore !== null),
    d('Equipment', equipmentScore, 95,
      equipmentScore === null ? [] : [100, 100, 91, 100, 100, 91, equipmentScore],
      'No assets are registered yet',
      equipmentScore !== null),
    d('Team', 94, 95, [96, 95, 92, 94, 95, 93, 94],
      'Attendance, task completion, SOP adherence, training'),
  ];
}

function handle(url: string, method: string, body: Record<string, unknown>): Response {
  const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0]!;
  const me = db.signedIn;

  if (path === '/api/v1/auth/login' && method === 'POST') {
    const person = PEOPLE.find((p) => p.email === String(body.email ?? '').trim().toLowerCase());
    if (!person || body.password !== DEMO_PASSWORD) {
      return json({ error: 'Email or password is incorrect.' }, 401);
    }
    db.signedIn = person;
    return json({ displayLabel: person.displayLabel, roleCodes: person.roles });
  }

  if (path === '/api/v1/auth/logout') { db.signedIn = null; return json({ ok: true }); }
  if (!me) return json({ error: 'Not signed in' }, 401);

  if (path === '/api/v1/auth/me') {
    return json({
      displayLabel: me.displayLabel, roleCodes: me.roles,
      clinicIds: ['c-1'], crossClinic: false,
    });
  }

  // ---- TODAY ----
  if (path === '/api/v1/my-day') {
    const now = Date.now();
    const mine = db.tasks
      .filter((t) => t.assignee === me.employeeId && ['DUE', 'IN_PROGRESS'].includes(t.status))
      .sort((a, b) => startOf(a) - startOf(b));

    const buckets: Record<string, unknown[]> = { OVERDUE: [], NOW: [], NEXT: [], LATER: [] };
    for (const t of mine) {
      const mins = (startOf(t) - now) / 60_000;
      const bucket = mins < 0 ? 'OVERDUE' : mins <= 60 ? 'NOW' : mins <= 240 ? 'NEXT' : 'LATER';
      buckets[bucket]!.push({
        id: t.id, title: t.title, standard: t.standard,
        dueAt: new Date(startOf(t)).toISOString(),
        status: mins < 0 ? 'OVERDUE' : t.status,
        started: t.status === 'IN_PROGRESS',
        blockedBy: t.blockedBy,
        // Every task traces to a standard somebody wrote down. This is the
        // thing no competitor can show, and it costs one field.
        why: traceOf(t),
      });
    }

    const opening = tally('Opening Readiness');
    const closing = tally('Closing Readiness');
    const inChair = db.visits.some((v) => v.status === 'IN_CHAIR');
    const next = nextVisit();

    const phase = (() => {
      if (!opening) return null;
      if (!opening.complete) return 'OPENING';
      if (inChair) return 'SEEING_PATIENTS';
      // Somebody still in the chair outranks the clock: the day is not closing
      // down while a patient is being treated, whatever the time says.
      if (closing?.complete) return 'CLOSED';
      if (closing && (db.endOfDay || now >= CLOSING_DUE || closing.done > 0)) return 'CLOSING';
      return 'OPEN';
    })();

    return json({
      buckets,
      attentionCount: db.attention.filter((a) => a.open && a.owner === me.employeeId).length,
      clinic: {
        name: 'SYNTHETIC KB Dental Andheri',
        // The viewer's own zone, so a demo opened anywhere reads naturally.
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        phase,
        opening,
        closing,
        readyBy: new Date(OPENING_DUE).toISOString(),
        closingAt: new Date(CLOSING_DUE).toISOString(),
        firstPatientAt: next ? new Date(visitStart(next)).toISOString() : null,
      },
      opening,
    });
  }

  // ---- what tomorrow inherits ----
  if (path === '/api/v1/handover') {
    const line = (headline: string, detail: string | null, severity: string) =>
      ({ headline, detail, severity });
    const rank: Record<string, number> = {
      PATIENT_SAFETY: 0, CRITICAL: 1, IMPORTANT: 2, ROUTINE: 3,
    };
    const bySeverity = (a: { severity: string }, b: { severity: string }) =>
      (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9);
    // Priority mirrors the seed: emergency and sterilisation are patient
    // safety, opening and securing the building are critical, the rest routine.
    const priorityOf = (t: Task) =>
      t.code === 'OPN-005' || t.code === 'CLS-001' || t.code === 'CLS-002'
        ? 'PATIENT_SAFETY'
        : t.code === 'OPN-001' || t.code === 'CLS-004' ? 'CRITICAL' : 'IMPORTANT';

    const unfinished = db.tasks
      .filter((t) => t.status === 'DUE' || t.status === 'IN_PROGRESS')
      .map((t) => line(
        t.title,
        t.blockedBy ? 'On hold — a problem was reported and is not sorted yet.' : t.standard,
        priorityOf(t),
      ))
      .sort(bySeverity);

    const waitingOnSomeone = db.tasks
      .filter((t) => t.status === 'COMPLETED')
      .map((t) => line(t.title, 'Finished, but still waiting for someone to confirm it.', priorityOf(t)))
      .sort(bySeverity);

    const stillOpen = db.attention.filter((a) => a.open)
      .map((a) => line(a.headline, a.detail, a.severity))
      .sort(bySeverity);

    const patientsNotSeen = db.visits
      .filter((v) => ['BOOKED', 'ARRIVED', 'NO_SHOW'].includes(v.status))
      .map((v) => line(
        `${v.visitType} was not seen`,
        v.status === 'NO_SHOW'
          ? 'Marked as not arrived.'
          : v.status === 'ARRIVED'
            ? 'Arrived but never went through — needs a call.'
            : 'Still expected, and the day has ended.',
        v.status === 'ARRIVED' ? 'CRITICAL' : 'IMPORTANT',
      ));

    return json({
      periodKey: new Date().toISOString().slice(0, 10),
      clear: unfinished.length === 0 && waitingOnSomeone.length === 0
        && stillOpen.length === 0 && patientsNotSeen.length === 0,
      unfinished, waitingOnSomeone, stillOpen, patientsNotSeen,
    });
  }

  // ---- one task ----
  const taskMatch = /^\/api\/v1\/tasks\/([^/]+)(\/(start|complete|report-problem|authorise))?$/.exec(path);
  if (taskMatch) {
    const t = db.tasks.find((x) => x.id === taskMatch[1]);
    if (!t) return json({ error: 'Not found' }, 404);
    const action = taskMatch[3];

    if (!action) return json(taskView(t, me));

    if (action === 'authorise') {
      if (!me.roles.some((r) => MAY_RELEASE.includes(r))) {
        return json({ error: 'You do not have authority to let this go ahead.' }, 403);
      }
      if (!String(body.reason ?? '').trim()) {
        return json({ error: 'Please say why it is safe to go ahead.' }, 400);
      }
      t.releasedAt = Date.now();
      const ask = db.attention.find((a) => a.instanceId === t.id && a.needsAuthorisation && a.open);
      if (ask) ask.open = false;
      return json({ ok: true });
    }

    // Record relation: only the assignee may act on the work itself.
    if (t.assignee !== me.employeeId) {
      return json({ error: 'This task is assigned to someone else.' }, 403);
    }

    if (action === 'start') {
      t.status = 'IN_PROGRESS';
      audit(AuditAction.STARTED, t.code, t.title, me.displayLabel);
      return json({ status: t.status });
    }

    if (action === 'report-problem') {
      const item = t.items.find((i) => i.id === body.itemId);
      const kind = PROBLEM_KINDS.find((k) => k.key === body.kind)?.label ?? 'Problem';
      const headline = item ? `${item.label} — ${kind.toLowerCase()}` : `${t.title} — ${kind.toLowerCase()}`;
      t.blockedBy = headline;
      const a = raise({
        code: 'OPN.PROBLEM', headline, severity: 'PATIENT_SAFETY',
        detail: (body.note as string) ?? null, owner: 'e-rahul',
        dueAt: Date.now() + 30 * 60_000, instanceId: t.id, needsAuthorisation: false,
      });
      return json({ headline: a.headline, id: a.id });
    }

    if (action === 'complete') {
      for (const r of (body.responses as Array<{ itemId: string; checked: boolean; numericValue?: number }>) ?? []) {
        t.responses[r.itemId] = { checked: r.checked, value: r.numericValue ?? null };
      }

      // AP-1: a requirement that cannot be confirmed must not read as a pass.
      if (t.cantConfirm && !t.releasedAt) {
        if (!me.roles.some((r) => MAY_RELEASE.includes(r))) {
          raise({
            code: 'OPN.GATE.NEEDS_AUTHORISATION',
            headline: `${t.title} needs a manager's go-ahead`,
            severity: 'PATIENT_SAFETY',
            detail: `${t.cantConfirm}. Whoever is doing it cannot finish until someone with the authority says it is safe.`,
            owner: 'e-rahul', dueAt: null, instanceId: t.id, needsAuthorisation: true,
          });
          audit(AuditAction.BLOCKED, t.code, t.title, 'Compliance engine', {
            deviation: t.cantConfirm,
          });
          return json({
            error: `${t.cantConfirm}. A manager has been asked to look at it — you don't need to chase them.`,
            canOverride: false,
          }, 409);
        }
        if (!String(body.overrideReason ?? '').trim()) {
          audit(AuditAction.OVERRIDE_REQUESTED, t.code, t.title, me.displayLabel, {
            deviation: t.cantConfirm,
          });
          return json({
            error: `${t.cantConfirm}. Report a problem, or record why it is safe to go ahead.`,
            canOverride: true,
          }, 409);
        }
        audit(AuditAction.OVERRIDE_GRANTED, t.code, t.title, me.displayLabel, {
          deviation: `${t.cantConfirm} — allowed: ${String(body.overrideReason).trim()}`,
        });
      }

      t.status = 'COMPLETED';
      t.completedBy = me.employeeId;
      // What was recorded, not merely that something was.
      const recorded = t.items
        .map((i) => {
          const r = t.responses[i.id];
          return r?.value != null ? `${i.label} ${r.value}${i.unit ?? ''}` : null;
        })
        .filter(Boolean).join(' · ');
      audit(AuditAction.COMPLETED, t.code, t.title, me.displayLabel, {
        evidence: t.items.some((i) => i.requiresValue) ? 'VALUE' : 'CONFIRMATION',
        ...(recorded ? { evidenceValue: recorded } : {}),
      });

      const outOfRange: Array<{ label: string; value: number; unit: string | null }> = [];
      const ac = t.responses['i-401'];
      if (ac?.value != null && (ac.value < 20 || ac.value > 26)) {
        outOfRange.push({ label: 'Air conditioning set', value: ac.value, unit: '°C' });
        audit(AuditAction.DEVIATION_RAISED, t.code, t.title, 'Exception engine', {
          deviation: `Air conditioning ${ac.value}°C, outside 20–26°C`,
        });
        raise({
          code: 'OPN.THRESHOLD', headline: `Air conditioning set is outside the normal range (${ac.value}°C)`,
          severity: 'IMPORTANT', detail: null, owner: 'e-rahul',
          dueAt: Date.now() + 120 * 60_000, instanceId: t.id, needsAuthorisation: false,
        });
      }

      if (t.selfVerifyAllowed) {
        t.status = 'VERIFIED';
        // Self-verification is recorded as exactly that. `independentlyVerified`
        // will correctly report false for it later.
        audit(AuditAction.VERIFIED, t.code, t.title, me.displayLabel, {
          verifiedBy: me.displayLabel,
        });
        return json({ status: 'VERIFIED', selfVerified: true, waitingForCheck: false, outOfRange });
      }
      return json({ status: 'COMPLETED', selfVerified: false, waitingForCheck: true, outOfRange });
    }
  }

  // ---- ATTENTION ----
  /* ═══════════════════════════════════════════════════════════════════
     THE ENGINE — the real functions, running in the browser

     Nothing below reimplements a rule. `record()` decides whether an event
     may be recorded, `readiness()` and `closing()` calculate the morning and
     the evening, and `decisions()` orders the work. All four are imported
     from the product unchanged, which is only possible because they are pure.
     ═══════════════════════════════════════════════════════════════════ */

  if (path === '/api/v1/clinic') {
    const w = engineWorld();
    const now = w.now;
    return json({
      now,
      first: mostImportant(w, now),
      decisions: decisions(w, now),
      unlocked: w.events.some((e) => e.type === ClinicEvent.CLINIC_UNLOCKED),
      role: engineRole(),
      readiness: readiness(w.events, w.operatories, w.firstPatientAt, now),
      closing: closing(w.events, w.operatories, w.shutAt, now),
      board: board(w, now),
      late: sweep(w, now).alerts,
      flows: w.flows.filter((f) => !f.done).map((f) => ({
        id: f.id, kind: f.kind, subjectLabel: f.subjectLabel,
        node: FLOWS[f.kind].nodes[f.at]?.id ?? null,
      })),
      eventCount: w.events.length,
    });
  }

  /* ═══════════════════════════════════════════════════════════════════
     THE PATIENT EVENT ENGINE

     Again the real functions. `careForAll` derives every requirement and
     consequence from the bookings below — nothing here is a task list, and
     removing a booking removes its work without anybody deleting a row.

     The facts are deliberately uneven. One patient is fully known, one is on
     a blood thinner, and one has never been asked anything — because a demo
     where every patient is straightforward never shows the rule that matters.
     ═══════════════════════════════════════════════════════════════════ */

  if (path === '/api/v1/patient-events') {
    const w = engineWorld();
    const now = w.now;
    const all = careForAll(DEMO_BOOKINGS, factsFor,
      [...w.events, ...careProgressEvents(now, db.endOfDay)], now);
    const role = engineRole() as RoleCode;

    return json({
      now,
      role,
      care: all.map(careView),
      mine: careOwedBy(all, role).map((t) => {
        const owner = all.find((c) => c.open.includes(t));
        return {
          ...careTaskView(t),
          patientLabel: owner?.booking.patientLabel ?? '',
          bookingId: owner?.booking.id ?? '',
        };
      }),
      catalogue: {
        treatments: TREATMENTS.length,
        categories: new Set(TREATMENTS.map((t) => t.category)).size,
        items: TREATMENTS.reduce((n, t) => n + t.items.length, 0),
      },
      unratified: UNRATIFIED_CATALOGUE,
    });
  }

  /* ═══════════════════════════════════════════════════════════════════
     THE EQUIPMENT ENGINE

     The real functions again. Nothing below decides what is due — the
     register holds each asset's intervals, the log holds what was done, and
     `equipment()` does the arithmetic.

     The service history is deliberately uneven, because a register where
     everything was serviced last week shows a table and hides the engine.
     Two assets have no history at all, which is the state the whole file
     exists to stop being read as "nothing due".
     ═══════════════════════════════════════════════════════════════════ */

  if (path === '/api/v1/equipment') {
    const w = engineWorld();
    const now = w.now;
    const events = assetHistory(now);
    const v = equipmentView(ASSETS, events, now);
    const role = engineRole() as RoleCode;
    const named = (r: AssetRecord) => ({ tag: r.asset.tag, name: r.asset.name });

    return json({
      now,
      role,
      records: v.records.map((r) => assetView(r, events, now)),
      tasks: v.tasks.map(assetTaskView),
      mine: assetWorkFor(v, role).map(assetTaskView),
      down: v.down.map(named),
      unusable: v.unusable.map(named),
      unserviced: v.unserviced.map(named),
      checksDue: v.checksDue.map(named),
      categories: [...new Set(ASSETS.map((a) => a.category))],
      unratified: UNRATIFIED_REGISTER,
    });
  }

  if (path === '/api/v1/now') {
    const w = engineWorld();
    const role = engineRole();
    return json({
      now: w.now, role,
      mine: decisionsFor(w, role, w.now),
      escalated: escalatedTo(w, role, w.now),
    });
  }

  if (path === '/api/v1/events' && method === 'POST') {
    const b = body as { type: string; subjectId: string; subjectLabel?: string };
    const w = engineWorld();
    const out = recordEvent(w, {
      type: b.type as ClinicEvent,
      subjectId: b.subjectId,
      by: engineRole(),
      ...(b.subjectLabel ? { subjectLabel: b.subjectLabel } : {}),
    });
    // A refusal is a state of the clinic, not a failure of the request — and
    // it writes nothing, here exactly as on the server.
    if (!out.ok) return json({ ok: false, refusal: out.refusal });
    db.world = out.world;
    return json({ ok: true, duplicate: false, consequences: out.consequences });
  }

  if (path === '/api/v1/attention') {
    const order = { PATIENT_SAFETY: 0, CRITICAL: 1, IMPORTANT: 2, ROUTINE: 3 };
    return json(db.attention.filter((a) => a.open)
      .sort((a, b) => order[a.severity] - order[b.severity])
      .map((a) => ({
        id: a.id, headline: a.headline, severity: a.severity, detail: a.detail,
        mine: a.owner === me.employeeId,
        dueAt: a.dueAt ? new Date(a.dueAt).toISOString() : null,
        escalated: false, instanceId: a.instanceId, needsAuthorisation: a.needsAuthorisation,
      })));
  }

  const resolveMatch = /^\/api\/v1\/attention\/([^/]+)\/resolve$/.exec(path);
  if (resolveMatch) {
    if (!me.roles.some((r) => (['CLINIC_MANAGER'] as Role[]).includes(r))) {
      return json({ error: 'You do not have permission to resolve this.' }, 403);
    }
    const a = db.attention.find((x) => x.id === resolveMatch[1]);
    if (a) {
      a.open = false;
      const t = db.tasks.find((x) => x.id === a.instanceId);
      if (t) t.blockedBy = null;   // resolving unblocks the task it was holding
    }
    return json({ ok: true });
  }

  // ---- CHECKS ----
  if (path === '/api/v1/checks') {
    return json(db.tasks
      .filter((t) => t.status === 'COMPLETED'
        && t.completedBy !== me.employeeId
        && t.checkerRoles.some((r) => me.roles.includes(r)))
      .map((t) => ({
        id: t.id, title: t.title, standard: t.standard,
        completedAt: new Date().toISOString(),
      })));
  }

  const checkMatch = /^\/api\/v1\/checks\/([^/]+)$/.exec(path);
  if (checkMatch) {
    const t = db.tasks.find((x) => x.id === checkMatch[1]);
    if (!t) return json({ error: 'Not found' }, 404);
    if (t.completedBy === me.employeeId) {
      return json({ error: 'You cannot confirm your own work on this task.' }, 403);
    }
    if (method === 'GET') {
      return json({
        id: t.id, title: t.title, standard: t.standard,
        completedAt: new Date().toISOString(),
        items: t.items.map((i) => ({
          id: i.id, label: i.label,
          checked: t.responses[i.id]?.checked ?? false,
          value: t.responses[i.id]?.value ?? null,
          unit: i.unit ?? null,
        })),
      });
    }
    if (!t.checkerRoles.some((r) => me.roles.includes(r))) {
      return json({ error: 'You are not one of the people who can check this.' }, 403);
    }
    t.status = body.result === 'PASS' ? 'VERIFIED' : 'IN_PROGRESS';
    if (body.result === 'FAIL') t.completedBy = null;
    return json({ status: t.status });
  }

  // ---- THE CLINIC AT A GLANCE ----
  if (path === '/api/v1/overview') {
    // A 403 here is the correct answer for most people, not a failure: an
    // assistant has a day, a manager has a clinic.
    if (!me.roles.some((r) => MAY_SEE_CLINIC.includes(r))) {
      return json({ error: 'You do not have permission to see clinic-wide performance.' }, 403);
    }
    const now = Date.now();
    const dayKey = (offsetDays: number) =>
      new Date(now - offsetDays * 86_400_000).toISOString().slice(0, 10);

    // Readiness means "ready to see patients", so it is the opening set alone.
    // Folding tonight's checks in would cap readiness in the low sixties every
    // morning and never recover.
    const openingTasks = db.tasks.filter((t) => t.process === 'Opening Readiness');
    const confirmed = openingTasks.filter((t) => t.status === 'VERIFIED');
    const total = openingTasks.length;
    const week = [
      ...HISTORY.map((h, i) => ({
        periodKey: dayKey(HISTORY.length - i),
        readiness: h.readiness,
        onTime: h.readiness === null ? null : h.readiness === 100,
      })),
      {
        periodKey: dayKey(0),
        readiness: total === 0 ? null : Math.round((confirmed.length / total) * 100),
        onTime: confirmed.length === total,
      },
    ];

    // Independence is counted over the week, because one day is noise. Today's
    // share comes from the activities themselves: anything whose activity needs
    // a second pair of eyes and has been confirmed was confirmed by someone
    // other than the doer, because the demo refuses self-checks the same way
    // the server does.
    const todayIndependent = confirmed.filter((t) => !t.selfVerifyAllowed).length;
    const pastTotal = HISTORY.reduce((n, h) => n + h.independentOf, 0);
    const pastIndependent = HISTORY.reduce((n, h) => n + h.independent, 0);
    const indTotal = pastTotal + confirmed.length;
    const indIndependent = pastIndependent + todayIndependent;

    const openItems = db.attention.filter((a) => a.open);
    const visitCount = (s: Visit['status']) => db.visits.filter((v) => v.status === s).length;

    return json({
      health: operationalHealth(),
      readiness: {
        done: confirmed.length,
        total,
        percent: total === 0 ? null : Math.round((confirmed.length / total) * 100),
      },
      patients: {
        seen: visitCount('COMPLETED'),
        expected: db.visits.length - visitCount('CANCELLED'),
        waiting: visitCount('ARRIVED'),
        notSeen: visitCount('NO_SHOW'),
      },
      problems: {
        open: openItems.length,
        patientSafety: openItems.filter((a) => a.severity === 'PATIENT_SAFETY').length,
        overdue: openItems.filter((a) => a.dueAt !== null && a.dueAt < now).length,
      },
      week,
      independentChecks: {
        independent: indIndependent,
        total: indTotal,
        percent: indTotal === 0 ? null : Math.round((indIndependent / indTotal) * 100),
      },
    });
  }

  // ---- THE DAY ----
  if (path === '/api/v1/schedule') {
    const now = Date.now();
    return json({
      periodKey: new Date().toISOString().slice(0, 10),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      rows: db.visits
        .slice()
        .sort((a, b) => a.startsInMinutes - b.startsInMinutes)
        .map((v) => ({
          id: v.id, patientLabel: v.patientLabel, patientUhid: v.patientUhid,
          visitType: v.visitType, chairLabel: v.chairLabel,
          scheduledStart: new Date(visitStart(v)).toISOString(),
          scheduledEnd: new Date(visitStart(v) + v.minutes * 60_000).toISOString(),
          status: v.status, statusLabel: STATUS_LABEL[v.status],
          waitingMinutes: v.arrivedAt && v.status === 'ARRIVED'
            ? Math.max(0, Math.round((now - v.arrivedAt) / 60_000)) : null,
          arrivedAt: v.arrivedAt ? new Date(v.arrivedAt).toISOString() : null,
        })),
    });
  }

  const visitMatch = /^\/api\/v1\/appointments\/([^/]+)\/status$/.exec(path);
  if (visitMatch) {
    if (!me.roles.some((r) => MAY_MOVE_VISITS.includes(r))) {
      return json({ error: 'You do not have permission to change this visit.' }, 403);
    }
    const v = db.visits.find((x) => x.id === visitMatch[1]);
    if (!v) return json({ error: 'Not found' }, 404);
    const to = body.to as Visit['status'];
    if (!ALLOWED[v.status].includes(to)) {
      return json({
        error: `This visit is already marked "${STATUS_LABEL[v.status]}", so it cannot be changed to "${STATUS_LABEL[to]}".`,
      }, 409);
    }
    if (to === 'CANCELLED' && !String(body.reason ?? '').trim()) {
      return json({ error: 'Please say why this visit is being cancelled.' }, 409);
    }
    v.status = to;
    if (to === 'ARRIVED') {
      // Arrived a little while ago, so "waiting N min" has something to show.
      v.arrivedAt = Date.now() - 16 * 60_000;
    }
    return json({ status: v.status });
  }


  // ---- CAPA: the IMPROVE stage of the loop ----
  //
  // These refusals mirror the server's exactly. A demo that let you close an
  // incident the real system would refuse would be teaching the wrong product.

  if (path === '/api/v1/incidents' && method === 'GET') {
    if (!MAY_SEE_CLINIC.some((r) => me.roles.includes(r))) return json({ error: 'Forbidden' }, 403);
    return json(db.incidents.map(incidentView));
  }

  if (path === '/api/v1/incidents' && method === 'POST') {
    const summary = String(body.summary ?? '').trim();
    if (!summary) return json({ error: 'Say what happened.' }, 409);
    const inc: Incident = {
      id: `inc-${db.nextIncidentNumber}`,
      reference: `INC-2026-${String(db.nextIncidentNumber).padStart(4, '0')}`,
      parameter: (body.parameter as ParameterKey) ?? 'QUALITY_CAPA',
      priority: String(body.priority ?? 'IMPORTANT'),
      status: 'OPEN', ageDays: 0, summary,
      description: (body.description as string) || null,
      immediateCorrection: null, rootCause: null, actions: [],
    };
    db.nextIncidentNumber += 1;
    db.incidents.unshift(inc);
    return json(incidentView(inc));
  }

  const incMatch = /^\/api\/v1\/incidents\/([^/]+)(?:\/(\w+))?$/.exec(path);
  if (incMatch) {
    const inc = db.incidents.find((i) => i.id === incMatch[1]);
    if (!inc) return json({ error: 'Not found' }, 404);
    const step = incMatch[2];

    if (!step && method === 'GET') return json(incidentView(inc));

    if (step === 'contain') {
      const text = String(body.immediateCorrection ?? '').trim();
      if (inc.status !== 'OPEN') return json({ error: 'Already past containment.' }, 409);
      if (!text) return json({ error: 'Say what was done about it today.' }, 409);
      inc.immediateCorrection = text;
      inc.status = 'CONTAINED';
      return json(incidentView(inc));
    }

    if (step === 'investigate') {
      const text = String(body.rootCause ?? '').trim();
      // The patient in the chair cannot wait for a root cause analysis, so
      // containment comes first and is never confused with the fix.
      if (inc.status !== 'CONTAINED') {
        return json({ error: 'Record what was done about today before asking why it happened.' }, 409);
      }
      if (!text) return json({ error: 'Say why it happened.' }, 409);
      inc.rootCause = text;
      inc.status = 'INVESTIGATED';
      return json(incidentView(inc));
    }

    if (step === 'actions') {
      // Jumping straight to a fix is the habit CAPA exists to break.
      if (inc.status !== 'INVESTIGATED' && inc.status !== 'ACTIONS_PLANNED') {
        return json({ error: 'Record a root cause before planning actions.' }, 409);
      }
      const description = String(body.description ?? '').trim();
      if (!description) return json({ error: 'Say what will be done.' }, 409);
      const responsible = String(body.responsibleEmployeeId ?? 'e-rahul');
      inc.actions.push({
        id: `act-${Math.random().toString(36).slice(2, 8)}`,
        type: body.type === 'PREVENTIVE' ? 'PREVENTIVE' : 'CORRECTIVE',
        status: 'OPEN', description,
        responsible,
        responsibleName: PEOPLE.find((p) => p.employeeId === responsible)?.displayLabel ?? 'Rahul',
        dueInDays: Number(body.dueInDays ?? 7),
        verifiedBy: null, verificationNote: null, ineffectiveCount: 0,
      });
      const hasC = inc.actions.some((a) => a.type === 'CORRECTIVE');
      const hasP = inc.actions.some((a) => a.type === 'PREVENTIVE');
      if (hasC && hasP && inc.status === 'INVESTIGATED') inc.status = 'ACTIONS_PLANNED';
      return json(incidentView(inc));
    }

    if (step === 'close') {
      if (inc.actions.length === 0) {
        return json({ error: 'An incident closed without an action has taught the clinic nothing.' }, 409);
      }
      // The requirement's central point: "simply correcting today's appointment
      // doesn't solve the operational problem."
      if (!inc.actions.some((a) => a.type === 'PREVENTIVE')) {
        return json({ error: 'No preventive action. Correcting this one instance does not stop the next.' }, 409);
      }
      const unproven = inc.actions.filter((a) => a.status !== 'EFFECTIVE' && a.status !== 'CLOSED').length;
      if (unproven > 0) {
        return json({
          error: `${unproven} action${unproven === 1 ? '' : 's'} not yet proven effective.`,
        }, 409);
      }
      inc.status = 'CLOSED';
      return json(incidentView(inc));
    }
  }

  const actMatch = /^\/api\/v1\/capa-actions\/([^/]+)\/(\w+)$/.exec(path);
  if (actMatch) {
    const inc = db.incidents.find((i) => i.actions.some((a) => a.id === actMatch[1]));
    const action = inc?.actions.find((a) => a.id === actMatch[1]);
    if (!inc || !action) return json({ error: 'Not found' }, 404);

    if (actMatch[2] === 'implement') {
      // Carried out is not the same as "it worked".
      action.status = 'EFFECTIVENESS_PENDING';
    } else if (actMatch[2] === 'effectiveness') {
      if (action.status !== 'EFFECTIVENESS_PENDING') {
        return json({ error: 'An action must be implemented before its effectiveness can be checked.' }, 409);
      }
      // Same reason a doer cannot confirm their own activity.
      if (action.responsible === me.employeeId) {
        return json({
          error: 'A CAPA action must be checked by someone other than the person responsible for it.',
        }, 409);
      }
      if (body.effective === false) {
        // FRS §6: "ineffective loops back."
        action.status = 'ACTION_IN_PROGRESS';
        action.ineffectiveCount += 1;
        action.verificationNote = (body.note as string) || null;
        if (inc.status === 'VERIFYING') inc.status = 'ACTIONS_PLANNED';
        return json(incidentView(inc));
      }
      action.status = 'EFFECTIVE';
      action.verifiedBy = me.displayLabel;
      action.verificationNote = (body.note as string) || null;
    }
    const allDone = inc.actions.every(
      (a) => a.status === 'EFFECTIVENESS_PENDING' || a.status === 'EFFECTIVE' || a.status === 'CLOSED',
    );
    if (allDone && inc.status === 'ACTIONS_PLANNED') inc.status = 'VERIFYING';
    return json(incidentView(inc));
  }

  /**
   * The Owner MIS.
   *
   * The requirement is unusually specific about this one screen: "You should
   * not see 150 tasks. You should see: Operational Health, eight domains,
   * requires your attention." So this returns eight scores and the exceptions
   * behind them -- never a task list.
   *
   * The eight are §7's management scores, which sit between the 16 control
   * parameters and the single health number. Sixteen numbers is a report; one
   * number is a slogan; eight is what an owner can act on.
   */
  if (path === '/api/v1/owner-mis' && method === 'GET') {
    if (!MAY_SEE_CLINIC.some((r) => me.roles.includes(r))) return json({ error: 'Forbidden' }, 403);
    const domains = ownerDomains();
    // GREY never counts. A domain with nothing to measure is not a zero, and
    // averaging it in would let a quiet week look like a failing one.
    const scored = domains.filter((d) => d.status !== 'GREY' && d.score !== null);
    const health = scored.length
      ? Math.round(scored.reduce((a, d) => a + (d.score ?? 0), 0) / scored.length)
      : null;

    const critical = db.attention.filter((a) => a.open && a.severity === 'PATIENT_SAFETY');
    const attention = db.attention.filter(
      (a) => a.open && (a.severity === 'CRITICAL' || a.severity === 'IMPORTANT'),
    );

    return json({
      clinicName: 'SYNTHETIC KB Dental Andheri',
      health,
      domains,
      critical: critical.map((a) => ({ id: a.id, headline: a.headline, detail: a.detail })),
      attention: attention.map((a) => ({ id: a.id, headline: a.headline, detail: a.detail })),
      // "Recurring failures become root-cause/CAPA learning" — the owner's
      // real question is not what broke, it is what keeps breaking.
      repeatFailures: db.incidents
        .filter((i) => i.actions.some((a) => a.ineffectiveCount > 0))
        .map((i) => ({
          reference: i.reference, summary: i.summary,
          attempts: 1 + Math.max(...i.actions.map((a) => a.ineffectiveCount)),
        })),
      capa: {
        open: db.incidents.filter((i) => i.status !== 'CLOSED').length,
        awaitingEffectiveness: db.incidents.filter((i) => i.status === 'VERIFYING').length,
        closed: db.incidents.filter((i) => i.status === 'CLOSED').length,
      },
    });
  }

  /**
   * The Manager's command centre — six questions, in the order they are asked.
   *
   * Deliberately NOT the old overview. That screen answered "how is the clinic
   * scoring", which is a reporting question; these answer "can we work, and
   * what is stopping us", which is an operating one. No trends, no sparklines,
   * no percentages except the one progress figure that is genuinely a fraction
   * of work done.
   */
  // ---- UNIVERSAL SEARCH: the fastest way to use KuBi ----
  //
  // The problem this solves is not "finding things". It is that a clinic with
  // thirty operational concepts cannot be learned by exploring menus, and a
  // new assistant should not have to. One box, everything in it, no navigation.
  //
  // Searches what the app already holds. Nothing here is a new store.

  if (path === '/api/v1/search' && method === 'GET') {
    // `path` has already had its query stripped a few lines above, so the
    // term has to come off the raw url. Parsing `path` found no `q` and the
    // palette silently returned nothing for every search.
    const q = decodeURIComponent((/[?&]q=([^&]*)/.exec(url)?.[1] ?? '')).trim().toLowerCase();
    if (q.length < 2) return json([]);

    const hits: Array<{
      kind: string; label: string; detail: string | null;
      go: string | null; patient: string | null; score: number;
    }> = [];

    // A prefix match beats a match buried mid-string: somebody typing "ster"
    // means sterilisation, not "instruments to be sterilised" three words in.
    const rank = (text: string) => {
      const t = text.toLowerCase();
      if (!t.includes(q)) return 0;
      return t.startsWith(q) ? 3 : t.split(/\s+/).some((w) => w.startsWith(q)) ? 2 : 1;
    };
    const add = (
      kind: string, label: string, detail: string | null,
      go: string | null, patient: string | null = null, extra = '',
    ) => {
      const score = Math.max(rank(label), rank(extra));
      if (score > 0) hits.push({ kind, label, detail, go, patient, score });
    };

    for (const v of db.visits) {
      add('Patient', v.patientLabel, `${v.visitType} · ${v.chairLabel}`, null, v.patientLabel, v.patientUhid);
    }
    for (const l of db.labCases) {
      add('Lab case', l.reference, `${l.patientLabel} · ${l.workType}`, null, l.patientLabel, `${l.workType} ${l.vendor}`);
    }
    for (const a of db.assets) {
      add('Equipment', a.name, `${a.status.toLowerCase().replace(/_/g, ' ')}`, 'CLINIC', null, a.category);
    }
    for (const st of db.stock) {
      add('Stock', st.name, `${st.available} ${st.unit} available`, 'CLINIC', null, st.code);
    }
    for (const t of db.tasks) {
      add('Task', t.title, t.standard, 'TODAY', null, t.code);
    }
    for (const at of db.attention.filter((x) => x.open)) {
      add('Problem', at.headline, at.detail, 'ATTENTION');
    }
    for (const person of PEOPLE) {
      add('Person', person.displayLabel, person.roles.join(', ').toLowerCase().replace(/_/g, ' '), null);
    }
    // The 101 activities — an SOP nobody can find is an SOP nobody follows.
    for (const a of ACTIVITY_LIBRARY) {
      add('Standard', a.activity, `${a.id} · ${a.fn}`, 'STANDARDS', null, `${a.id} ${a.kpi ?? ''}`);
    }
    for (const [id, label] of [
      ['TODAY', 'My tasks'], ['CLINIC', 'Clinic'], ['PATIENTS', 'Patients'],
      ['ATTENTION', 'Attention'], ['QUALITY', 'Quality'], ['STANDARDS', 'Standards'],
    ] as const) {
      add('Go to', label, null, id);
    }

    hits.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
    // Enough to be useful, few enough to read without scrolling.
    return json(hits.slice(0, 20));
  }

  // ---- PATIENT 360, organised by the journey rather than by module ----
  //
  // Sixteen equal sections would be the module-first mistake in one screen.
  // A patient record has one question — what does this person need next — and
  // the answer is the journey stage they are stuck at.
  //
  // Everything KuBi does not hold is named as missing rather than omitted. A
  // record that silently lacks payments looks complete and is not.

  const patientMatch = /^\/api\/v1\/patients\/([^/]+)$/.exec(path);
  if (patientMatch && method === 'GET') {
    const id = decodeURIComponent(patientMatch[1]!);
    const visits = db.visits.filter((v) => v.patientLabel === id);
    const procedures = db.patientProcedures.filter((pp) => pp.patientLabel === id);
    const labCases = db.labCases.filter((l) => l.patientLabel === id);
    const followups = db.followups.filter((f) => f.patientLabel === id);
    if (visits.length === 0 && procedures.length === 0 && labCases.length === 0) {
      return json({ error: 'Not found' }, 404);
    }

    const alerts = [...new Set(procedures.flatMap((pp) => pp.alerts))];
    const planned = procedures.find((pp) => pp.status === 'PLANNED') ?? null;
    const blocking = planned
      ? planned.requirements.filter((r) => r.result !== 'PASS' && r.result !== 'NOT_APPLICABLE')
      : [];
    const today = visits.find((v) => v.status !== 'CANCELLED' && v.status !== 'COMPLETED') ?? null;

    // Journey 2, as the spine of the record: patient → readiness → consent →
    // treatment → lab → payment → review → recall.
    const consentReq = planned?.requirements.find((r) => /consent/i.test(r.label)) ?? null;
    // A stage carries its own action. The journey is executable from the
    // record rather than being a picture of work that happens elsewhere —
    // which was the difference between a patient screen and a patient
    // workflow, and the reason it took seven screens to move one person
    // through a morning.
    const stage = (
      key: string, label: string, state: 'DONE' | 'NOW' | 'BLOCKED' | 'WAITING' | 'ABSENT',
      detail: string | null, needs: string | null = null,
      act: { label: string; kind: string; id: string } | null = null,
    ) => ({ key, label, state, detail, needs, act });

    const NEXT_VISIT_STEP: Record<string, { to: string; label: string }> = {
      BOOKED: { to: 'ARRIVED', label: 'They’re here' },
      ARRIVED: { to: 'IN_CHAIR', label: 'Taken through' },
      IN_CHAIR: { to: 'COMPLETED', label: 'Finished' },
    };

    const journey = [
      stage('arrival', 'Arrival',
        today?.status === 'ARRIVED' || today?.status === 'IN_CHAIR' ? 'DONE'
          : today ? 'WAITING' : 'ABSENT',
        today ? `${today.visitType} · ${today.chairLabel}` : 'Nothing booked today',
        null,
        today && NEXT_VISIT_STEP[today.status]
          ? {
            label: NEXT_VISIT_STEP[today.status]!.label,
            kind: 'VISIT', id: `${today.id}:${NEXT_VISIT_STEP[today.status]!.to}`,
          }
          : null),
      stage('readiness', 'Readiness',
        !planned ? 'ABSENT' : blocking.length === 0 ? 'DONE' : 'BLOCKED',
        planned ? planned.procedureName : 'No procedure planned',
        blocking.length > 0 ? blocking.map((r) => r.label).join(' · ') : null),
      stage('consent', 'Consent',
        !consentReq ? 'ABSENT' : consentReq.result === 'PASS' ? 'DONE' : 'BLOCKED',
        consentReq ? consentReq.detail : 'No consent required yet'),
      stage('treatment', 'Treatment',
        procedures.some((pp) => pp.status === 'COMPLETED') ? 'DONE'
          : procedures.some((pp) => pp.status === 'IN_PROGRESS') ? 'NOW'
            : blocking.length > 0 ? 'BLOCKED' : 'WAITING',
        planned?.procedureName ?? null,
        // A blocked stage says what is refusing rather than offering a button
        // that would fail — the gate is the point, not an obstacle to route
        // around.
        blocking.length > 0 ? blocking.map((r) => r.label).join(' · ') : null,
        planned && blocking.length === 0
          ? { label: 'Start the procedure', kind: 'PROCEDURE', id: planned.id }
          : null),
      stage('lab', 'Laboratory',
        labCases.length === 0 ? 'ABSENT'
          : labCases.every((l) => l.deliveryReady) ? 'DONE'
            : labCases.some((l) => l.status === 'REMAKE') ? 'BLOCKED' : 'WAITING',
        labCases.length === 0 ? 'No lab work'
          : labCases.map((l) => `${l.workType} · ${l.nextStep ?? l.status.toLowerCase()}`).join(' · ')),
      // Named as absent rather than left out. A record that silently lacks
      // payments looks complete and is not.
      stage('payment', 'Payment', 'ABSENT', null, 'needs a billing module'),
      stage('review', 'Review', 'ABSENT', null, 'needs review tracking'),
      stage('recall', 'Recall', 'ABSENT', null, 'needs the relationship layer'),
    ];

    // The one answer this screen exists to give.
    const headline = alerts.length > 0 && blocking.length > 0
      ? { verdict: 'NOT READY', why: blocking.map((r) => r.label).join(' · ') }
      : blocking.length > 0
        ? { verdict: 'NOT READY', why: blocking.map((r) => r.label).join(' · ') }
        : planned
          ? { verdict: 'READY', why: `${planned.procedureName} may start` }
          : today
            // The headline must agree with the journey beneath it. It said
            // BOOKED while the journey showed Arrival complete — a record
            // contradicting itself in the two places a person looks first.
            ? {
              verdict: today.status === 'IN_CHAIR' ? 'IN THE CHAIR'
                : today.status === 'ARRIVED' ? 'WAITING'
                  : 'BOOKED',
              why: today.status === 'ARRIVED'
                ? `Arrived · ${today.visitType} · ${today.chairLabel}`
                : `${today.visitType} · ${today.chairLabel}`,
            }
            : { verdict: 'NOTHING DUE', why: 'No open procedure or appointment' };

    return json({
      patientLabel: id,
      uhid: procedures[0]?.patientUhid ?? visits[0]?.patientUhid ?? null,
      headline,
      alerts,
      journey,
      appointments: visits.map((v) => ({
        id: v.id, visitType: v.visitType, chairLabel: v.chairLabel,
        status: v.status, startsInMinutes: v.startsInMinutes,
      })),
      procedures: procedures.map((pp) => ({
        id: pp.id, name: pp.procedureName, status: pp.status,
        requirements: pp.requirements.map((r) => ({
          label: r.label, result: r.result, enforcement: r.enforcement, detail: r.detail,
        })),
      })),
      labCases: labCases.map((l) => ({
        id: l.id, reference: l.reference, workType: l.workType, status: l.status,
        ready: l.deliveryReady, reason: l.deliveryReason,
      })),
      followups: followups.map((f) => ({
        id: f.id, procedureName: f.procedureName, dueLabel: f.dueLabel,
        outcome: f.outcome, redFlagReason: f.redFlagReason,
      })),
      /**
       * One continuous log of what happened to this person, built from the
       * records the app already holds rather than a new store. A timeline
       * explains a day without opening a report.
       */
      timeline: [
        ...visits.map((v) => ({
          at: v.status === 'BOOKED' ? `in ${v.startsInMinutes} min` : 'today',
          what: v.status === 'BOOKED' ? `${v.visitType} booked`
            : v.status === 'ARRIVED' ? 'Arrived, waiting'
              : v.status === 'IN_CHAIR' ? `Seated in ${v.chairLabel}`
                : v.status === 'COMPLETED' ? `${v.visitType} finished`
                  : `${v.visitType} ${v.status.toLowerCase()}`,
          tone: v.status === 'CANCELLED' || v.status === 'NO_SHOW' ? 'RED' : 'GREEN',
        })),
        ...procedures.map((pp) => ({
          at: pp.whenLabel,
          what: `${pp.procedureName} — ${pp.status.toLowerCase().replace(/_/g, ' ')}`,
          tone: pp.status === 'COMPLETED' ? 'GREEN' : 'AMBER',
        })),
        ...labCases.map((l) => ({
          at: l.expectedLabel ?? 'no date',
          what: `${l.workType} · ${l.nextStep ?? l.status.toLowerCase()}`,
          tone: l.overdue || l.status === 'REMAKE' ? 'RED' : 'GREEN',
        })),
        ...followups.map((f) => ({
          at: f.dueLabel,
          what: `Follow-up — ${f.outcome.toLowerCase().replace(/_/g, ' ')}`,
          tone: f.outcome === 'RED_FLAG' ? 'RED' : 'GREEN',
        })),
        // The audit trail is the only source that records refusals, which are
        // exactly the events a timeline is read for.
        ...db.audit
          .filter((e) => e.subject.includes(id) || e.deviation?.includes(id))
          .map((e) => ({
            at: new Date(e.at).toLocaleTimeString(),
            what: `${e.action.toLowerCase().replace(/_/g, ' ')} — ${e.subject}`,
            tone: e.deviation ? 'RED' : 'GREEN',
          })),
      ],
      /** Said out loud, per principle 3 — not quietly missing. */
      notHeld: [
        { what: 'Payments and estimates', needs: 'Billing module' },
        { what: 'Treatment plan and acceptance', needs: 'Billing module' },
        { what: 'Scans, photographs and documents', needs: 'Evidence storage' },
        { what: 'Clinical notes', needs: 'Clinical records module' },
        { what: 'Reviews and communication', needs: 'Patient Relationship domain' },
      ],
    });
  }

  // ---- NOTIFICATIONS: derived from state, never stored ----
  //
  // A stored notification outlives the condition that caused it, and then
  // somebody is chasing a stock item that arrived yesterday. So this reads the
  // same db every screen reads and derives the set fresh.

  if (path === '/api/v1/notifications' && method === 'GET') {
    const now = Date.now();
    const overdue = db.tasks
      .filter((t) => (t.status === 'DUE' || t.status === 'IN_PROGRESS') && startOf(t) < now)
      .map((t) => ({
        id: t.id, title: t.title,
        minutesLate: Math.round((now - startOf(t)) / 60000),
        doer: 'Dental Assistant', activityId: t.code,
      }));

    const all = notificationsFor({
      overdueTasks: overdue,
      lowStock: db.stock.filter((x) => x.state !== 'OK')
        // `available` excludes expired stock — the number that decides whether a
        // reorder is genuinely needed, not what is sitting on the shelf.
        .map((x) => ({ name: x.name, quantity: x.available, minimum: x.minimumQty })),
      serviceDue: db.assets
        .filter((a) => a.nextServiceInDays !== null && a.nextServiceInDays <= 7)
        .map((a) => ({ id: a.id, name: a.name, dueLabel: `in ${a.nextServiceInDays} days` })),
      followupsDue: db.followups
        .map((f) => ({ id: f.id, patientLabel: f.patientLabel, overdue: f.overdue })),
      consentMissing: db.patientProcedures
        .filter((pp) => pp.status === 'PLANNED'
          && pp.requirements.some((r) => /consent/i.test(r.label) && r.result !== 'PASS'))
        .map((pp) => ({ id: pp.id, patientLabel: pp.patientLabel, procedure: pp.procedureName })),
      labDelayed: db.labCases.filter((l) => l.overdue).map((l) => ({
        id: l.id, reference: l.reference, patientLabel: l.patientLabel, daysLate: 3,
      })),
      waitingPatients: db.visits.filter((v) => v.status === 'ARRIVED' && v.arrivedAt)
        .map((v) => ({
          id: v.id, patientLabel: v.patientLabel,
          waitingMinutes: Math.round((now - v.arrivedAt!) / 60000),
        })),
      emergencies: db.attention.filter((a) => a.open && a.severity === 'PATIENT_SAFETY')
        .map((a) => ({ id: a.id, headline: a.headline })),
      // The clinic's own number, not a hardcoded 15 in a component.
      waitingThresholdMinutes: 15,
    });
    return json(all satisfies Notification[]);
  }

  // ---- AUDIT TRAIL: append-only, including the refusals ----

  if (path === '/api/v1/audit' && method === 'GET') {
    if (!MAY_SEE_CLINIC.some((r) => me.roles.includes(r))) return json({ error: 'Forbidden' }, 403);
    // Newest first to read, but the stored order is never disturbed.
    return json([...db.audit].reverse());
  }

  // ---- ENGINES: the six, the cascade, and one activity fully modelled ----
  //
  // From prototype B, which showed these and A did not. Three things on one
  // screen because they are one argument: work is created by engines, not by
  // anybody remembering; a clinical event raises its own consequences; and a
  // single SOP line is stored as a whole specification rather than a checkbox.

  if (path === '/api/v1/engines' && method === 'GET') {
    return json({
      engines: [
        {
          id: 'TIME', name: 'Time engine', count: 57,
          what: 'Creates activity from the clock — attendance deadline, opening '
            + 'readiness, morning confirmations, closing controls, weekly inventory, '
            + 'monthly emergency audit.',
        },
        {
          id: 'PATIENT_EVENT', name: 'Patient event engine', count: 47,
          what: 'The clinical journey generates its own work. Surgery booked raises '
            + 'pre-op requirements; surgery completed raises post-op, follow-up and '
            + 'documentation.',
        },
        {
          id: 'EQUIPMENT', name: 'Equipment engine', count: 12,
          what: 'Every asset carries its own record — daily check, service frequency, '
            + 'last and next service, breakdown history, AMC. Next service date '
            + 'reached creates the task.',
        },
        {
          id: 'INVENTORY', name: 'Inventory engine', count: 13,
          what: 'Current stock at or below reorder level generates a purchase '
            + 'requirement. Implants tracked to brand, line, platform, diameter and '
            + 'length, not a single count.',
        },
        {
          id: 'COMPLIANCE', name: 'Compliance engine', count: 18,
          what: 'Mandatory gates. Missing requirements do not quietly disappear — the '
            + 'procedure reads NOT READY until they are satisfied.',
        },
        {
          id: 'EXCEPTION', name: 'Exception engine', count: null,
          what: 'Continuously asks what should have happened and did not, then '
            + 'escalates on a clock. This is what management actually looks at.',
        },
      ],
      cascade: {
        fired: db.cascadeFired,
        event: 'Implant surgery completed — SYNTHETIC Priyanka N.',
        spawn: CASCADE_SPAWN,
      },
      // The owner's §5: one line of the SOP, stored as a specification.
      anatomy: {
        requirement: 'Same-day instruments should be ultrasonic cleaned and autoclaved.',
        notStoredAs: '☐ Instruments autoclaved',
        parameter: 'Infection control',
        process: 'Instrument sterilisation',
        trigger: 'Instrument used',
        owner: 'Dental assistant',
        due: 'Same working day',
        sop: STERILIZATION_SAME_DAY.sop,
        evidence: 'Autoclave cycle / batch record',
        verification: 'Closing sterilisation check',
        kpi: STERILIZATION_SAME_DAY.kpi.name,
        formula: STERILIZATION_SAME_DAY.kpi.formula,
        numerator: 47, denominator: 48, target: 100,
      },
    });
  }

  if (path === '/api/v1/engines/cascade' && method === 'POST') {
    db.cascadeFired = body.fired !== false;
    return json({ fired: db.cascadeFired, raised: CASCADE_SPAWN.length });
  }

  // ---- COMPLIANCE GATE: engine D, with a verdict rather than a checklist ----

  if (path === '/api/v1/gate' && method === 'GET') {
    const missing = db.gate.filter((c) => !c.met);
    return json({
      procedure: 'Implant surgery — SYNTHETIC Priyanka N., 16:30',
      checks: db.gate,
      ready: missing.length === 0,
      missingCount: missing.length,
    });
  }

  const gateMatch = /^\/api\/v1\/gate\/([^/]+)$/.exec(path);
  if (gateMatch && method === 'POST') {
    const c = db.gate.find((x) => x.id === gateMatch[1]);
    if (!c) return json({ error: 'Not found' }, 404);
    c.met = !c.met;
    return json({ ok: true });
  }

  // ---- CONFIRMATIONS: the owner's §6 worked example ----
  //
  //   Patient | Appointment | Confirmation | Reminder | Special instructions | Status
  //
  // Status is DERIVED, never typed by anybody: Confirmed / No response /
  // Reschedule / Cancelled / Action required. A status somebody sets by hand
  // is a status that goes stale, and then the morning list lies.
  //
  // "Management needs to see the exceptions, not 18 green ticks" — so the
  // summary leads with what is unresolved.

  if (path === '/api/v1/confirmations' && method === 'GET') {
    const rows = db.visits.map((v) => {
      const confirmed = v.status !== 'BOOKED' && v.status !== 'CANCELLED';
      const attempts = CONFIRM_ATTEMPTS[v.id] ?? 0;

      // Derived, in the owner's own vocabulary.
      const status = v.status === 'CANCELLED' ? 'CANCELLED'
        : v.status === 'NO_SHOW' ? 'ACTION_REQUIRED'
          : confirmed ? 'CONFIRMED'
            : attempts >= 2 ? 'ACTION_REQUIRED'
              : attempts >= 1 ? 'NO_RESPONSE'
                : 'NO_RESPONSE';

      return {
        id: v.id,
        patientLabel: v.patientLabel,
        appointment: `${v.visitType} · ${v.chairLabel}`,
        startsInMinutes: v.startsInMinutes,
        confirmation: confirmed ? 'Confirmed' : attempts > 0
          ? `${attempts} attempt${attempts > 1 ? 's' : ''}, no answer` : 'Not yet called',
        reminderSent: REMINDER_SENT.includes(v.id),
        specialInstructions: SPECIAL_INSTRUCTIONS[v.id] ?? null,
        status,
      };
    });

    const count = (s: string) => rows.filter((r) => r.status === s).length;
    return json({
      rows,
      summary: {
        appointments: rows.filter((r) => r.status !== 'CANCELLED').length,
        confirmed: count('CONFIRMED'),
        unconfirmed: count('NO_RESPONSE'),
        actionRequired: count('ACTION_REQUIRED'),
        cancelled: count('CANCELLED'),
      },
    });
  }

  // ---- EXCEPTION QUEUE: what should have happened and did not ----
  //
  // The owner's engine 6, with the ladder live rather than described:
  //   autoclave due 19:00 · not done 19:15 → assistant · 19:30 → senior ·
  //   20:00 → clinic head.
  //
  // Escalation is computed from minutes past due, so it keeps climbing whether
  // or not anybody is still in the building.

  if (path === '/api/v1/exceptions' && method === 'GET') {
    if (!MAY_SEE_CLINIC.some((r) => me.roles.includes(r))) return json({ error: 'Forbidden' }, 403);

    const rows = db.attention.filter((a) => a.open).map((a) => {
      const t = db.tasks.find((x) => x.id === a.instanceId);
      const w = t ? workSpecFor(t) : null;
      const dueAt = t ? startOf(t) : Date.now();
      const minutesLate = Math.max(0, Math.round((Date.now() - dueAt) / 60000));
      const rung = w ? rungAt(w.escalation, minutesLate) : null;

      return {
        id: a.id,
        headline: a.headline,
        severity: a.severity,
        detail: a.detail ?? null,
        minutesLate,
        // Null before the first rung — not yet escalated is a real state, and
        // showing L1 immediately would make every late thing look the same.
        level: rung?.level ?? null,
        escalatedTo: rung ? rung.to : null,
        nextRung: w
          ? w.escalation.find((r) => r.afterMinutes > minutesLate) ?? null
          : null,
        owner: w?.responsibility.owner ?? null,
        activityCode: t?.code ?? null,
      };
    });

    // Most escalated first, then most overdue. A queue ordered by creation
    // time buries the thing that has been failing longest.
    rows.sort((x, y) => (y.level ?? 0) - (x.level ?? 0) || y.minutesLate - x.minutesLate);
    return json(rows);
  }

  // ---- RETENTION: the patients who stopped coming (SG-T.4, 30 days) ----
  //
  // The owner asked how long counts as "not coming back" and said thirty days.
  // Here the list is a fixed set of synthetic patients rather than arithmetic
  // over a year of appointments, because this file has no year of appointments
  // — but the shape, the ordering and every state the screen must handle are
  // the real ones, and the sort is the real function from contracts.

  if (path === '/api/v1/retention' && method === 'GET') {
    // Reception is deliberately refused. The permission is CLINICAL, granted
    // to the treating doctor, because the first sentence of this call can turn
    // clinical. A demo that let everyone in would misrepresent the product.
    // Only the doctor here: this file has no Clinical Director persona, and
    // adding one to widen a check would be inventing a person to pass a test.
    if (!me.roles.includes('TREATING_DOCTOR')) {
      return json({ error: 'Following a patient up about unfinished treatment is a clinical '
        + 'call, and your role does not hold that permission.' }, 403);
    }

    const items = [...db.retention].sort(retentionOrder);
    return json({
      items,
      summary: {
        dormant: items.length,
        midTreatment: items.filter((i) => i.reason === 'STOPPED_MID_TREATMENT').length,
        contactedThisMonth: db.retentionContacted,
        returningThisMonth: db.retentionReturning,
      },
      dormantAfterDays: DORMANT_AFTER_DAYS,
    });
  }

  const claim = /^\/api\/v1\/retention\/([\w-]+)\/open$/.exec(path);
  if (claim && method === 'POST') {
    const row = db.retention.find((r) => r.patientId === claim[1]);
    if (!row) return json({ error: 'No such patient' }, 404);
    if (row.outreach) {
      return json({ error: 'Somebody is already following this patient up' }, 409);
    }
    row.outreach = {
      id: `ro-${row.patientId}`, raisedAt: new Date().toISOString(),
      contactedAt: null, outcome: null, note: null,
    };
    return json({ id: row.outreach.id });
  }

  const record = /^\/api\/v1\/retention\/([\w-]+)\/record$/.exec(path);
  if (record && method === 'POST') {
    const row = db.retention.find((r) => r.outreach?.id === record[1]);
    if (!row || !row.outreach) return json({ error: 'No such follow-up' }, 404);

    const outcome = String(body.outcome);
    db.retentionContacted += 1;
    if (outcome === 'RETURNING') db.retentionReturning += 1;

    // The same rule as the server: a real answer takes them off the list; an
    // unanswered phone does not, because nobody has spoken to them.
    if (CLOSING_OUTCOMES.includes(outcome as never) || outcome === 'WILL_DECIDE') {
      db.retention = db.retention.filter((r) => r !== row);
    } else {
      row.outreach.contactedAt = new Date().toISOString();
      row.outreach.outcome = outcome;
      row.outreach.note = body.note ? String(body.note) : null;
    }
    return json({ ok: true });
  }

  // ---- SCOREBOARD: sixteen parameters into eight management scores ----
  //
  // The owner's §7. Every line carries its own exceptions, because §8 says a
  // click on Lab 76% must reveal only the deviations — not a report, and not
  // the ninety things that went right.

  if (path === '/api/v1/scoreboard' && method === 'GET') {
    if (!MAY_SEE_CLINIC.some((r) => me.roles.includes(r))) return json({ error: 'Forbidden' }, 403);

    // Live where the demo has real state; fixed where a parameter has no
    // activity today. Null means nothing to measure — never a zero.
    const opening = tally('Opening Readiness');
    const chairs = db.assets.filter((a) => a.category === 'DENTAL_CHAIR');
    const chairsUp = chairs.filter((a) => a.status === 'OPERATIONAL').length;
    const labTotal = db.labCases.length;
    const labOk = db.labCases.filter((l) => !l.overdue && l.status !== 'REMAKE').length;
    const stockTotal = db.stock.length;
    const stockOk = db.stock.filter((s) => s.state === 'OK').length;
    const batchesOk = db.batches.filter((b) => b.stage === 'RELEASED').length;

    const pct = (n: number, d: number) => (d === 0 ? null : Math.round((n / d) * 100));

    const PARAM_PCT: Partial<Record<ParameterKey, number | null>> = {
      OPENING_READINESS: opening ? pct(opening.done, opening.total) : null,
      ROOM_CHAIR_READINESS: pct(chairsUp, chairs.length),
      CLEANLINESS: 95,
      MAINTENANCE_UTILITIES: pct(chairsUp, chairs.length),
      // A batch still moving through the loop is not a failure — it is work in
      // progress. Only batches that should have been released by now count.
      // Measuring not-yet-due work as failed is the same error as counting a
      // GREY as zero, and it makes every dashboard red at nine in the morning.
      INFECTION_CONTROL: pct(batchesOk, batchesOk + db.batches.filter(
        (b) => b.stage === 'QUARANTINED',
      ).length),
      SAFETY_EMERGENCY: 93,
      PATIENT_JOURNEY: 91,
      SURGICAL_HIGH_RISK: 96,
      FOLLOWUP_EXPERIENCE: pct(
        db.followups.filter((f) => f.outcome !== 'PENDING').length, db.followups.length,
      ),
      CLINICAL_DOCUMENTATION: 88,
      // "Confirmation, cancellation, no-show, utilisation" — confirmation, not
      // arrival. Counting arrivals scored 0% at 08:52 because nobody had come
      // in yet, which read as total failure when the day simply had not
      // started. A score must never punish the clock.
      APPOINTMENT_CONTROL: pct(
        db.visits.filter((v) => v.status !== 'CANCELLED'
          && (v.status !== 'BOOKED' || (CONFIRM_ATTEMPTS[v.id] ?? 0) === 0)).length,
        db.visits.filter((v) => v.status !== 'CANCELLED').length,
      ),
      LABORATORY: pct(labOk, labTotal),
      INVENTORY_IMPLANTS: pct(stockOk, stockTotal),
      ATTENDANCE_LEAVE: 97,
      // Nothing to measure: no conduct activity has run today. GREY, not zero.
      STAFF_CONDUCT: null,
      QUALITY_CAPA: 89,
    };

    // The deviations behind each line. Only these are shown on a drill-down.
    const DEVIATIONS: Partial<Record<ManagementScore, Array<{
      label: string; severity: string; detail: string | null;
    }>>> = {
      LAB_EFFICIENCY: [
        ...db.labCases.filter((l) => l.overdue).map((l) => ({
          label: `${l.patientLabel} · ${l.workType} overdue`,
          severity: 'RED',
          detail: `${l.reference} · ${l.vendor} · expected ${l.expectedLabel}`,
        })),
        ...db.labCases.filter((l) => l.qcResult === null && l.status === 'QC_PENDING').map((l) => ({
          label: `${l.patientLabel} · received but QC pending`,
          severity: 'AMBER',
          detail: l.reference,
        })),
        ...db.labCases.filter((l) => l.deliveryReady).map((l) => ({
          label: `${l.patientLabel} · awaiting a delivery appointment`,
          severity: 'AMBER',
          detail: `${l.reference} · passed QC`,
        })),
        ...db.labCases.filter((l) => l.status === 'REMAKE').map((l) => ({
          label: `${l.patientLabel} · remake`,
          severity: 'RED',
          detail: `${l.reference} · remake ${l.remakeCount}`,
        })),
      ],
      INFECTION_CONTROL: db.batches
        .filter((b) => b.stage !== 'RELEASED')
        .map((b) => ({
          label: b.stage === 'QUARANTINED'
            ? `${b.batchRef} quarantined` : `${b.batchRef} not released`,
          severity: b.stage === 'QUARANTINED' ? 'RED' : 'AMBER',
          detail: `${b.stage.toLowerCase()} · ${b.packCount} packs · ${b.operator}`,
        })),
      INVENTORY_READINESS: db.stock
        .filter((s) => s.state !== 'OK')
        .map((s) => ({
          label: `${s.name} ${s.state === 'SHORTAGE' ? 'out of stock' : 'below minimum'}`,
          severity: s.state === 'SHORTAGE' ? 'RED' : 'AMBER',
          detail: null,
        })),
      CLINIC_READINESS: [
        ...(opening && !opening.complete ? [{
          label: `Opening ${opening.done} of ${opening.total} done`,
          severity: 'AMBER', detail: null as string | null,
        }] : []),
        ...db.assets.filter((a) => a.status !== 'OPERATIONAL').map((a) => ({
          label: `${a.name} out of service`, severity: 'RED', detail: null as string | null,
        })),
      ],
      PATIENT_CARE_COMPLIANCE: db.followups
        .filter((f) => f.outcome === 'RED_FLAG' || (f.overdue && f.outcome === 'PENDING'))
        .map((f) => ({
          label: `${f.patientLabel} · ${f.outcome === 'RED_FLAG' ? 'red flag' : 'follow-up overdue'}`,
          severity: f.outcome === 'RED_FLAG' ? 'RED' : 'AMBER',
          detail: f.redFlagReason ?? f.procedureName,
        })),
      APPOINTMENT_EFFICIENCY: db.visits
        .filter((v) => v.status === 'BOOKED')
        .map((v) => ({
          label: `${v.patientLabel} not confirmed`, severity: 'AMBER',
          detail: v.visitType as string | null,
        })),
    };

    const safety = db.attention.some((a) => a.open && a.severity === 'PATIENT_SAFETY');

    const lines = SCORE_ORDER.map((id) => {
      const spec = SCORE_SPEC[id];
      const parts = spec.parameters.map((p) => PARAM_PCT[p as ParameterKey] ?? null);
      const value = rollUp(parts);
      const devs = DEVIATIONS[id] ?? [];
      // Patient safety forces RED on the line it belongs to, whatever the
      // percentage says. 97% with an unverified cycle is not green.
      const unsafe = id === 'INFECTION_CONTROL' && safety;
      return {
        id,
        label: spec.label,
        measure: spec.measure,
        value,
        outcome: outcomeOf(value, unsafe),
        deviations: devs,
        deviationCount: devs.length,
        /** Which control heads feed this, so the number is traceable. */
        parameters: spec.parameters,
      };
    });

    return json({
      clinicName: 'SYNTHETIC KB Dental Andheri',
      operational: operationalScore(lines.map((l) => l.value)),
      lines,
      critical: db.attention.filter((a) => a.open && a.severity === 'PATIENT_SAFETY')
        .map((a) => ({ id: a.id, headline: a.headline })),
      attention: db.attention.filter((a) => a.open && a.severity !== 'PATIENT_SAFETY')
        .map((a) => ({ id: a.id, headline: a.headline })),
    });
  }

  // ---- PARAMETER HEALTH: layer 5, with the trend that matters more ----
  //
  // A parameter is capped by what it stands on: a room-readiness score cannot
  // honestly exceed the sterilisation it depends on, because a clean chair with
  // no sterile kit is not a ready room. The graph is not decoration.

  if (path === '/api/v1/parameter-health' && method === 'GET') {
    const SCORES: Record<string, { score: number | null; trend: string; days: number | null }> = {
      ATTENDANCE_LEAVE: { score: 97, trend: 'STABLE', days: 14 },
      OPENING_READINESS: { score: 92, trend: 'IMPROVING', days: 4 },
      CLEANLINESS: { score: 95, trend: 'STABLE', days: 9 },
      MAINTENANCE_UTILITIES: { score: 78, trend: 'DECLINING', days: 6 },
      INFECTION_CONTROL: { score: 92, trend: 'DECLINING', days: 12 },
      ROOM_CHAIR_READINESS: { score: 88, trend: 'STABLE', days: 5 },
      APPOINTMENT_CONTROL: { score: 94, trend: 'IMPROVING', days: 3 },
      PATIENT_JOURNEY: { score: 91, trend: 'STABLE', days: 8 },
      CLINICAL_DOCUMENTATION: { score: 81, trend: 'NEEDS_INTERVENTION', days: 19 },
      SURGICAL_HIGH_RISK: { score: 96, trend: 'STABLE', days: 11 },
      FOLLOWUP_EXPERIENCE: { score: 86, trend: 'DECLINING', days: 7 },
      LABORATORY: { score: 76, trend: 'NEEDS_INTERVENTION', days: 15 },
      INVENTORY_IMPLANTS: { score: 84, trend: 'IMPROVING', days: 2 },
      // Nothing to measure: no conduct activity has run. Null, not zero, and
      // UNKNOWN rather than STABLE — two days of silence is not stability.
      STAFF_CONDUCT: { score: null, trend: 'UNKNOWN', days: null },
      SAFETY_EMERGENCY: { score: 93, trend: 'STABLE', days: 10 },
      QUALITY_CAPA: { score: 89, trend: 'IMPROVING', days: 6 },
    };
    // Mean confidence of the evidence actually behind each parameter's work.
    const CONFIDENCE: Record<string, number> = {
      INFECTION_CONTROL: 96, SAFETY_EMERGENCY: 88, MAINTENANCE_UTILITIES: 71,
      CLINICAL_DOCUMENTATION: 74, LABORATORY: 82, ROOM_CHAIR_READINESS: 68,
      CLEANLINESS: 62, ATTENDANCE_LEAVE: 100, OPENING_READINESS: 70,
      APPOINTMENT_CONTROL: 79, PATIENT_JOURNEY: 84, SURGICAL_HIGH_RISK: 93,
      FOLLOWUP_EXPERIENCE: 77, INVENTORY_IMPLANTS: 86, QUALITY_CAPA: 90,
    };
    const FAILING = 85;
    const rows = Object.keys(SCORES).map((p) => {
      const s = SCORES[p]!;
      const deps = PARAMETER_SPEC[p as keyof typeof PARAMETER_SPEC].dependsOn;
      return {
        parameter: p,
        score: s.score,
        trend: s.trend,
        days: s.days,
        confidence: CONFIDENCE[p] ?? null,
        blockedBy: deps.filter((d) => {
          const up = SCORES[d];
          return up && up.score !== null && up.score < FAILING;
        }),
      };
    });
    return json(rows);
  }

  // ---- BRIEFING: one endpoint, five roles ----
  //
  // Mirrors what the real service will do: each domain contributes sections
  // for the role asking. Nothing here invents a figure — every section reads
  // the same db the other screens read, so the briefing and the operations
  // screen can never disagree about how many batches are unfinished.

  if (path === '/api/v1/briefing' && method === 'GET') {
    // Every item says which engine raised it. The five object types are only
    // real if they show up in somebody's actual day — up to now they existed
    // in the model and on demonstration screens, and every real item was
    // RECURRING.
    const fact = (
      id: string, text: string, detail: string | null = null, tone: string | null = null,
      origin: TaskOrigin = TaskOrigin.CONDITION,
      // Whose work this is, when it is not the reader's. A job title, never a
      // name: "with the sterilisation technician" survives that person leaving.
      owner: string | null = null,
    ): BriefItem => ({
      id, kind: 'fact', text, detail, tone, origin,
      taskId: null, priority: null, blockedBy: null, activityCode: null, owner,
    });
    const task = (t: Task, origin: TaskOrigin = TaskOrigin.RECURRING): BriefItem => ({
      id: t.id, kind: 'task', text: t.title,
      detail: t.status === 'IN_PROGRESS' ? 'started' : null,
      taskId: t.id, priority: priorityOf(t), tone: null, origin,
      blockedBy: t.blockedBy, activityCode: t.code, owner: null,
    });
    // Work raised by the cascade, for whichever role it belongs to.
    const spawned = (roleName: string): BriefItem[] => (db.cascadeFired
      ? CASCADE_SPAWN.filter((c) => c.role === roleName).map((c, i) => ({
        id: `cas-${roleName}-${i}`, kind: 'fact' as const, text: c.title,
        detail: `${c.due} · raised by surgery completed`, tone: 'AMBER',
        origin: TaskOrigin.PATIENT_EVENT,
        taskId: null, priority: null, blockedBy: null, activityCode: null,
      }))
      : []);
    const mine = db.tasks.filter((t) => t.assignee === me.employeeId);
    const openTasks = mine.filter((t) => t.status === 'DUE' || t.status === 'IN_PROGRESS');

    /**
     * A section straight out of the owner's daily operating standard.
     *
     * Connection 1, on the screen five of the roles actually land on. Until
     * now these sections were hand-written facts — "Treatment rooms and chairs
     * cleaned" was my phrasing, not the clinic's, and it appeared whether or
     * not the standard said anything of the kind. A briefing that invents a
     * role's day is a demonstration of a clinic, not this clinic.
     *
     * Items come from the person's real open tasks, filtered to the part of
     * the day being asked about, in the owner's wording, with the activity
     * code that governs them — or none, visibly.
     */
    const standardSection = (
      key: string, label: string, hint: string | null, emptyText: string,
      rhythms: string[],
    ) => {
      const items = openTasks
        .filter((t) => {
          if (!t.standardId) return false;
          const std = standardById(t.standardId);
          return std ? rhythms.includes(std.rhythm) : false;
        })
        .map((t) => task(t));
      return section(key, label, items.length > 0 ? 'AMBER' : 'GREEN', hint, emptyText, items);
    };

    // ---- Doctor ----
    if (me.roles.includes('TREATING_DOCTOR')) {
      const seated = db.visits.filter((v) => v.status === 'IN_CHAIR');
      const booked = db.visits.filter((v) => v.status !== 'CANCELLED' && v.status !== 'COMPLETED');
      const alerts = db.patientProcedures.filter((p) => p.alerts.length > 0);
      const notReady = db.patientProcedures.filter(
        (p) => p.status === 'PLANNED' && p.requirements.some((r) => r.result !== 'PASS'),
      );
      const qcWaiting = db.labCases.filter((l) => l.qcResult === null && l.status === 'QC_PENDING');
      const redFlags = db.followups.filter((f) => f.outcome === 'RED_FLAG');

      return json(briefing('Doctor', 'Which patient needs me?', null, [
        section('chair', 'In the chair now', seated.length ? 'RED' : 'GREEN',
          null, 'Nobody is seated right now.',
          seated.map((v) => fact(v.id, v.patientLabel, `${v.visitType} · ${v.chairLabel}`, 'AMBER'))),
        section('alerts', 'Medical alerts', alerts.length ? 'RED' : 'GREEN',
          'Read before treating.', 'No alerts on today’s patients.',
          alerts.map((p) => fact(p.id, p.patientLabel, p.alerts.join(' · '), 'RED'))),
        section('consent', 'Not ready to start', notReady.length ? 'RED' : 'GREEN',
          'A procedure cannot begin until every requirement passes.',
          'Every planned procedure is ready.',
          notReady.map((p) => fact(
            p.id, `${p.patientLabel} · ${p.procedureName}`,
            p.requirements.filter((r) => r.result !== 'PASS').map((r) => r.label).join(' · '),
            'RED', TaskOrigin.GATE,
          ))),
        section('labqc', 'Lab work waiting on my check', qcWaiting.length ? 'AMBER' : 'GREEN',
          'A case cannot be booked for delivery until this passes.',
          'No cases waiting on a check.',
          qcWaiting.map((l) => fact(l.id, `${l.patientLabel} · ${l.workType}`,
            `${l.reference} · ${l.vendor}`, 'AMBER'))),
        section('followups', 'Follow-ups needing me', redFlags.length ? 'RED' : 'GREEN',
          null, 'No follow-up has raised a flag.',
          redFlags.map((f) => fact(f.id, f.patientLabel,
            f.redFlagReason ?? f.procedureName, 'RED', TaskOrigin.PATIENT_EVENT))),
        section('spawned', 'Raised by a clinical event',
          spawned('Doctor').length ? 'AMBER' : 'GREEN',
          'Nobody typed these in — recording the surgery raised them.',
          'No clinical event has raised work for you.', spawned('Doctor')),
        section('today', 'Booked today', 'GREEN', null, 'Nobody booked.',
          booked.map((v) => fact(v.id, v.patientLabel,
            `${v.visitType} · ${v.chairLabel}`, null))),
      ]));
    }

    // ---- Lab coordinator ----
    if (me.roles.includes('LAB_COORDINATOR')) {
      const overdue = db.labCases.filter((l) => l.overdue);
      const awaitingQc = db.labCases.filter((l) => l.qcResult === null && l.status === 'QC_PENDING');
      const ready = db.labCases.filter((l) => l.deliveryReady);
      const remakes = db.labCases.filter((l) => l.status === 'REMAKE');
      const atVendor = db.labCases.filter((l) => l.status === 'IN_PROGRESS_VENDOR' && !l.overdue);

      return json(briefing('Laboratory', 'What is due back, and what is stuck?', null, [
        section('overdue', 'Past due from the lab', overdue.length ? 'RED' : 'GREEN',
          'Every one of these has a patient waiting on it.',
          'Nothing is overdue.',
          overdue.map((l) => fact(l.id, `${l.patientLabel} · ${l.workType}`,
            `${l.reference} · ${l.vendor} · expected ${l.expectedLabel}`, 'RED'))),
        section('qc', 'Arrived, waiting for a check', awaitingQc.length ? 'AMBER' : 'GREEN',
          'These cannot be booked until a clinician passes them.',
          'Nothing waiting on a check.',
          awaitingQc.map((l) => fact(l.id, `${l.patientLabel} · ${l.workType}`,
            `${l.reference} · arrived ${l.expectedLabel}`, 'AMBER'))),
        section('remake', 'Being remade', remakes.length ? 'RED' : 'GREEN',
          'A remake has a patient who was promised a date that has passed.',
          'No remakes.',
          remakes.map((l) => fact(l.id, `${l.patientLabel} · ${l.workType}`,
            `${l.reference} · remake ${l.remakeCount} · ${l.nextStep ?? ''}`, 'RED'))),
        section('ready', 'Passed and ready to book', 'GREEN',
          'Reception can give these a delivery appointment.',
          'Nothing ready to book.',
          ready.map((l) => fact(l.id, `${l.patientLabel} · ${l.workType}`,
            l.reference, 'GREEN'))),
        section('vendor', 'With the laboratory', 'GREEN', null, 'Nothing out at a lab.',
          atVendor.map((l) => fact(l.id, `${l.patientLabel} · ${l.workType}`,
            `${l.vendor} · due ${l.expectedLabel}`, null))),
      ]));
    }

    // ---- Sterilisation technician ----
    if (me.roles.includes('STERILIZATION_TECHNICIAN')) {
      const quarantined = db.batches.filter((b) => b.stage === 'QUARANTINED');
      // An operator may not release their own batch. That is the whole reason
      // this role exists separately, so the screen says it rather than just
      // hiding the button.
      const awaitingRelease = db.batches.filter(
        (b) => b.stage === 'AUTOCLAVED' && b.cycleResult === 'PASS',
      );
      // Excludes the ones waiting on a signature. A batch that is stalled on a
      // person is not "in the loop" — listing it in both places reads as two
      // batches, and the whole job here is knowing how many trays are really
      // outstanding.
      const inFlight = db.batches.filter(
        (b) => b.stage !== 'RELEASED' && b.stage !== 'QUARANTINED'
          && !awaitingRelease.includes(b),
      );
      const released = db.batches.filter((b) => b.stage === 'RELEASED');
      const packs = released.reduce((n, b) => n + b.packCount, 0);

      return json(briefing(
        'Sterilisation', 'What is in the loop, and what is stuck?',
        { total: db.batches.length, done: released.length },
        [
          section('quarantine', 'Quarantined', quarantined.length ? 'RED' : 'GREEN',
            'A failed or inconclusive cycle. Nothing in here may be used.',
            'Nothing quarantined.',
            quarantined.map((b) => fact(b.id, b.batchRef,
              `${b.packCount} packs · cycle ${b.cycleResult ?? 'no result'} · ${b.operator}`, 'RED'))),
          section('release', 'Waiting on a release signature',
            awaitingRelease.length ? 'AMBER' : 'GREEN',
            'The operator cannot release their own batch — someone else must sign.',
            'Nothing waiting to be released.',
            awaitingRelease.map((b) => fact(b.id, b.batchRef,
              `${b.packCount} packs · run by ${b.operator}`, 'AMBER'))),
          section('inflight', 'In the loop', inFlight.length ? 'AMBER' : 'GREEN',
            'Dirty → ultrasonic → packing → autoclave → release. No used instrument may stay overnight.',
            'The loop is empty.',
            inFlight.map((b) => fact(b.id, b.batchRef,
              `${b.stage.toLowerCase()} · ${b.packCount} packs · ${b.operator}`, 'AMBER'))),
          section('available', 'Sterile packs available', packs > 0 ? 'GREEN' : 'RED',
            null, 'No released packs — the clinic cannot treat.',
            released.map((b) => fact(b.id, b.batchRef, `${b.packCount} packs`, 'GREEN'))),
          section('mywork', 'My tasks', openTasks.length ? 'AMBER' : 'GREEN',
            null, 'Nothing outstanding.', openTasks.map((t) => task(t))),
        ],
      ));
    }

    // ---- Housekeeping ----
    if (me.roles.includes('HOUSEKEEPING')) {
      const rooms = db.visits.filter((v) => v.status === 'COMPLETED');
      return json(briefing('Housekeeping', 'What needs cleaning, and when?', null, [
        standardSection('opening', 'Before the first patient',
          'The clinic does not open with any of these outstanding.',
          'Opening clean is done.',
          ['BEFORE_OPENING']),
        standardSection('midday', 'During the day',
          'Every two hours, whatever else is happening.', 'Nothing outstanding.',
          ['HOURLY', 'TWO_HOURLY', 'LUNCH']),
        section('turnaround', 'Rooms to turn around',
          rooms.length ? 'AMBER' : 'GREEN',
          'A chair cannot take the next patient until it is done.',
          'Every room is ready.',
          rooms.map((v) => fact(v.id, v.chairLabel,
            `after ${v.patientLabel}`, 'AMBER', TaskOrigin.CONDITION))),
        section('spawned', 'Raised by a clinical event',
          spawned('Housekeeping').length ? 'AMBER' : 'GREEN',
          'Nobody typed these in.', 'No clinical event has raised work for you.',
          spawned('Housekeeping')),
        standardSection('closing', 'Closing',
          'Nobody locks up with these open.', 'Closing is clear.',
          ['CLOSING', 'LAST_PATIENT']),
      ]));
    }

    // ---- Assistant (dental and senior) ----
    //
    // Grouped by the owner's own rhythm rather than by the two process names.
    // Before the standard arrived there were only two halves of a day, so the
    // hourly sterile-instrument check and the lunchtime restock had nowhere to
    // go and fell into "Everything else" — which is where work goes to be
    // ignored. The rhythm has seven slots and the briefing now uses them.
    const rhythmOf = (t: Task) =>
      (t.standardId ? standardById(t.standardId)?.rhythm ?? null : null);
    const before = openTasks.filter(
      (t) => t.process === 'Opening Readiness' || rhythmOf(t) === 'BEFORE_OPENING',
    );
    const during = openTasks.filter(
      (t) => ['HOURLY', 'TWO_HOURLY', 'LUNCH'].includes(rhythmOf(t) ?? ''),
    );
    const closing = openTasks.filter(
      (t) => t.process === 'Closing Readiness'
        || ['CLOSING', 'LAST_PATIENT'].includes(rhythmOf(t) ?? ''),
    );
    const other = openTasks.filter(
      (t) => !before.includes(t) && !during.includes(t) && !closing.includes(t),
    );
    const toPrepare = db.visits.filter((v) => v.status === 'BOOKED' || v.status === 'ARRIVED');
    const sterPending = db.batches.filter((b) => b.stage !== 'RELEASED');
    // In progress is not the same as wrong. Only a quarantined batch means
    // somebody has to do something about it.
    const sterQuarantined = sterPending.filter((b) => b.stage === 'QUARANTINED');
    const toDispatch = db.labCases.filter((l) => l.status === 'QC_PENDING');

    return json(briefing(
      me.roles.includes('SENIOR_ASSISTANT') ? 'Senior assistant' : 'Assistant',
      'What do I do now?',
      { total: mine.length, done: mine.filter((t) => t.status === 'VERIFIED' || t.status === 'COMPLETED').length },
      [
        section('opening', 'Before the first patient', before.length ? 'AMBER' : 'GREEN',
          'The clinic does not open with any of these outstanding.',
          'Opening is done.', before.map((t) => task(t))),
        section('during', 'Through the day', during.length ? 'AMBER' : 'GREEN',
          'On a cadence, whatever else is happening.', 'Nothing due this hour.',
          during.map((t) => task(t))),
        section('patients', 'Patients to prepare', toPrepare.length ? 'AMBER' : 'GREEN',
          'Chairside setup and scans.', 'Nobody left to prepare.',
          toPrepare.map((v) => fact(v.id, v.patientLabel,
            `${v.visitType} · ${v.chairLabel}`, v.status === 'ARRIVED' ? 'AMBER' : null))),
        // Toned by what is actually wrong, not by what is merely unfinished.
        // A batch in the ultrasonic at ten in the morning is the loop working;
        // marking it RED made sterilisation the assistant's alarm every single
        // day, and made every real alarm look the same as it. Only a
        // quarantined batch is a problem here.
        section('ster', 'Sterilisation in the loop', sterQuarantined.length ? 'RED' : 'GREEN',
          'No used instrument may remain overnight. The technician runs the loop; '
          + 'this is here so you know what is coming back.',
          'The loop is clear.',
          sterPending.map((b) => fact(b.id, b.batchRef,
            `${b.stage.toLowerCase()} · ${b.packCount} packs`,
            b.stage === 'QUARANTINED' ? 'RED' : null,
            TaskOrigin.CONDITION,
            'sterilisation technician'))),
        section('lab', 'Lab cases to dispatch', toDispatch.length ? 'AMBER' : 'GREEN',
          null, 'Nothing to send.',
          toDispatch.map((l) => fact(l.id, `${l.patientLabel} · ${l.workType}`,
            `${l.reference} · ${l.vendor}`, 'AMBER'))),
        section('other', 'Everything else', other.length ? 'AMBER' : 'GREEN',
          null, 'Nothing outstanding.', other.map((t) => task(t))),
        section('closing', 'Closing', closing.length ? 'AMBER' : 'GREEN',
          'The day cannot close with these open.', 'Closing is clear.',
          closing.map((t) => task(t))),
        section('spawned', 'Raised by a clinical event',
          spawned('Housekeeping').length ? 'AMBER' : 'GREEN',
          'Nobody typed these in.', 'No clinical event has raised work for you.',
          spawned('Housekeeping')),
      ],
    ));
  }

  if (path === '/api/v1/command-centre' && method === 'GET') {
    if (!MAY_SEE_CLINIC.some((r) => me.roles.includes(r))) return json({ error: 'Forbidden' }, 403);

    const opening = tally('Opening Readiness');
    const roomsReady = db.assets.filter((a) => a.category === 'DENTAL_CHAIR' && a.status === 'OPERATIONAL').length;
    const roomsTotal = db.assets.filter((a) => a.category === 'DENTAL_CHAIR').length;
    const sterileReady = db.batches.some((b) => b.stage === 'RELEASED');

    // Critical means "stops us treating someone", not "is red on a chart".
    const blockers: Array<{ id: string; label: string }> = [];
    if (opening && !opening.complete) {
      blockers.push({ id: 'opening', label: `Opening ${opening.done} of ${opening.total} done` });
    }
    for (const a of db.assets.filter((x) => x.status !== 'OPERATIONAL')) {
      blockers.push({ id: a.id, label: `${a.name} out of service` });
    }
    if (!sterileReady) blockers.push({ id: 'ster', label: 'No sterile packs released' });

    const ready = blockers.length === 0;

    // The five that matter most, most serious first. A sixth card is a list,
    // and a list is what this screen exists to replace.
    const cards = [
      ...db.attention.filter((a) => a.open && a.severity === 'PATIENT_SAFETY'),
      ...db.attention.filter((a) => a.open && a.severity === 'CRITICAL'),
      ...db.attention.filter((a) => a.open && a.severity === 'IMPORTANT'),
    ].slice(0, 5).map((a) => ({ id: a.id, headline: a.headline, severity: a.severity }));

    const all = db.tasks;
    const done = all.filter((t) => t.status === 'COMPLETED' || t.status === 'VERIFIED').length;
    const running = all.filter((t) => t.status === 'IN_PROGRESS').length;

    const visits = db.visits.filter((v) => v.status !== 'CANCELLED');
    const nextV = nextVisit();

    return json({
      ready,
      blockers,
      readiness: {
        opening: opening ? (opening.complete ? 'Complete' : `${opening.done} of ${opening.total}`) : null,
        rooms: roomsTotal > 0 ? `${roomsReady} / ${roomsTotal}` : null,
        sterilization: sterileReady ? 'Ready' : 'Not ready',
        // Attendance is not built, so this says so rather than showing a tick
        // nobody earned.
        doctors: null,
        reception: opening?.complete ? 'Ready' : 'Not ready',
        patientsToday: visits.length,
        firstPatientInMinutes: nextV ? nextV.startsInMinutes : null,
      },
      cards,
      work: {
        total: all.length,
        done,
        running,
        pending: all.length - done - running,
      },
      patients: {
        appointments: visits.length,
        waiting: visits.filter((v) => v.status === 'ARRIVED').length,
        inChair: visits.filter((v) => v.status === 'IN_CHAIR').length,
        surgery: db.patientProcedures.filter((p) => p.category === 'IMPLANT_SURGERY').length,
        followupsDue: db.followups.filter((f) => f.outcome === 'PENDING').length,
      },
      // One light per person. Not a percentage — a manager glancing at this
      // wants to know who is here, not how the team scored.
      team: PEOPLE.filter((p) => p.roles[0] !== 'OWNER_DIRECTOR').map((p) => ({
        name: p.displayLabel.replace('SYNTHETIC ', ''),
        role: p.roles[0]!.toLowerCase().replace(/_/g, ' '),
        // Attendance is not built. AMBER means "we do not know", never green.
        light: 'AMBER' as const,
        note: 'Attendance not recorded — no check-in module yet',
      })),
      health: [
        { name: 'Opening', light: opening?.complete ? 'GREEN' : 'RED' },
        { name: 'Inventory', light: db.stock.some((x) => x.state === 'SHORTAGE') ? 'RED'
          : db.stock.some((x) => x.state === 'REORDER') ? 'AMBER' : 'GREEN' },
        { name: 'Lab', light: db.labCases.some((l) => l.overdue) ? 'RED'
          : db.labCases.some((l) => !l.deliveryReady) ? 'AMBER' : 'GREEN' },
        { name: 'Compliance', light: db.patientProcedures.some((p) =>
          p.requirements.some((r) => r.result === 'FAIL' && r.enforcement === 'BLOCK_HARD')) ? 'RED' : 'GREEN' },
        { name: 'Maintenance', light: db.assets.some((a) => a.status !== 'OPERATIONAL') ? 'RED'
          : db.assets.some((a) => a.nextServiceInDays !== null && a.nextServiceInDays <= 7) ? 'AMBER' : 'GREEN' },
        { name: 'Safety', light: db.attention.some((a) => a.open && a.severity === 'PATIENT_SAFETY') ? 'RED' : 'GREEN' },
      ],
    });
  }

  /**
   * The OWNER's dashboard, which is a different app from the manager's.
   *
   * The owner asked for business: revenue, collections, pending payments,
   * chair utilisation, treatment acceptance, reviews, doctor productivity,
   * profit, lab revenue, clinic score, attendance, satisfaction.
   *
   * KuBi holds none of the money. There is no billing, no payments ledger, no
   * CRM and no review integration, so nine of those twelve cannot be answered
   * at all. They are returned with `available: false` and the module that
   * would supply them, rather than a plausible figure.
   *
   * This is the whole discipline of the product applied to its own dashboard:
   * a number nobody can source is worse than a blank, because a blank prompts
   * a question and an invented figure ends one.
   */
  if (path === '/api/v1/owner-business' && method === 'GET') {
    if (!MAY_SEE_CLINIC.some((r) => me.roles.includes(r))) return json({ error: 'Forbidden' }, 403);

    const visits = db.visits.filter((v) => v.status !== 'CANCELLED');
    const seen = db.visits.filter((v) => v.status === 'COMPLETED').length;
    const chairs = db.assets.filter((a) => a.category === 'DENTAL_CHAIR');
    const chairsUp = chairs.filter((a) => a.status === 'OPERATIONAL').length;

    const opening = tally('Opening Readiness');
    const openingOk = opening ? opening.complete : false;
    const lights = [
      openingOk,
      !db.stock.some((x) => x.state === 'SHORTAGE'),
      !db.labCases.some((l) => l.overdue),
      !db.assets.some((a) => a.status !== 'OPERATIONAL'),
      !db.attention.some((a) => a.open && a.severity === 'PATIENT_SAFETY'),
    ];
    const clinicScore = Math.round((lights.filter(Boolean).length / lights.length) * 100);

    const need = (name: string, module: string) =>
      ({ name, value: null as string | null, available: false, module });

    return json({
      clinicName: 'SYNTHETIC KB Dental Andheri',
      // What KuBi actually knows.
      known: [
        { name: 'Clinic score', value: `${clinicScore}%`, available: true, module: null },
        { name: 'Patients today', value: String(visits.length), available: true, module: null },
        { name: 'Seen so far', value: String(seen), available: true, module: null },
        {
          name: 'Chairs available',
          value: `${chairsUp} of ${chairs.length}`,
          available: true, module: null,
        },
      ],
      // What it cannot, and what would be needed.
      missing: [
        need('Today’s revenue', 'Billing'),
        need('Collections', 'Billing'),
        need('Pending payments', 'Billing'),
        need('Profit', 'Billing and costs'),
        need('Lab revenue', 'Billing'),
        need('Chair utilisation', 'Appointment durations vs chair hours'),
        need('Treatment acceptance', 'Treatment plans with accept/decline'),
        need('Google reviews', 'Review integration'),
        need('Doctor productivity', 'Billing, plus a doctor role'),
        need('Staff attendance', 'Check-in'),
        need('Patient satisfaction', 'Feedback capture'),
      ],
      critical: db.attention.filter((a) => a.open && a.severity === 'PATIENT_SAFETY')
        .map((a) => ({ id: a.id, headline: a.headline })),
      attention: db.attention.filter((a) => a.open && a.severity !== 'PATIENT_SAFETY')
        .map((a) => ({ id: a.id, headline: a.headline })),
    });
  }

  /**
   * Reception's board. Patients, not statistics.
   */
  if (path === '/api/v1/reception-board' && method === 'GET') {
    const visits = db.visits.filter((v) => v.status !== 'CANCELLED');
    const nextV = nextVisit();
    return json({
      next: nextV ? {
        patientLabel: nextV.patientLabel,
        visitType: nextV.visitType,
        inMinutes: nextV.startsInMinutes,
        chairLabel: nextV.chairLabel,
      } : null,
      waiting: visits.filter((v) => v.status === 'ARRIVED').map((v) => ({
        id: v.id, patientLabel: v.patientLabel, visitType: v.visitType,
        waitingMinutes: v.arrivedAt ? Math.round((Date.now() - v.arrivedAt) / 60000) : 0,
      })),
      // A patient whose slot has passed and who is not in a chair.
      delayed: visits.filter((v) =>
        v.status === 'ARRIVED' && visitStart(v) < Date.now()).map((v) => ({
        id: v.id, patientLabel: v.patientLabel,
        lateMinutes: Math.round((Date.now() - visitStart(v)) / 60000),
      })),
      confirmations: visits.filter((v) => v.status === 'BOOKED').length,
      followups: db.followups.filter((f) => f.outcome === 'PENDING').map((f) => ({
        id: f.id, patientLabel: f.patientLabel, procedureName: f.procedureName,
        dueLabel: f.dueLabel, overdue: f.overdue,
      })),
      labReady: db.labCases.filter((l) => l.deliveryReady).map((l) => ({
        id: l.id, reference: l.reference, patientLabel: l.patientLabel, workType: l.workType,
      })),
      // Payments need a billing module. Said rather than shown as zero.
      paymentsAvailable: false,
    });
  }

  // ---- OPERATIONS: equipment, stock, implants, sterilisation ----

  if (path === '/api/v1/operations' && method === 'GET') {
    if (!MAY_SEE_CLINIC.some((r) => me.roles.includes(r))) return json({ error: 'Forbidden' }, 403);
    return json({
      assets: db.assets,
      stock: db.stock,
      implants: db.implants,
      batches: db.batches,
      labCases: db.labCases,
      // Counted here rather than in the screen, so the badge and the list can
      // never disagree about how many things are wrong.
      counts: {
        assetsDown: db.assets.filter((a) => a.status !== 'OPERATIONAL').length,
        serviceDue: db.assets.filter((a) => a.nextServiceInDays !== null && a.nextServiceInDays <= 7).length,
        shortages: db.stock.filter((s) => s.state === 'SHORTAGE').length,
        reorders: db.stock.filter((s) => s.state === 'REORDER').length,
        implantGaps: db.implants.filter((i) => i.quantity === 0).length,
        batchesPending: db.batches.filter((b) => b.stage !== 'RELEASED').length,
        labOverdue: db.labCases.filter((l) => l.overdue).length,
        labBlocked: db.labCases.filter((l) => !l.deliveryReady).length,
      },
    });
  }

  const assetMatch = /^\/api\/v1\/assets\/([^/]+)\/check$/.exec(path);
  if (assetMatch) {
    const asset = db.assets.find((a) => a.id === assetMatch[1]);
    if (!asset) return json({ error: 'Not found' }, 404);
    const result = body.result === 'FAIL' ? 'FAIL' : 'PASS';
    asset.checkedToday = result;
    if (result === 'FAIL') {
      // Not a note. The asset leaves service and the exception is raised in
      // the same step, exactly as the server does it.
      asset.status = 'OUT_OF_SERVICE';
      raise({
        code: 'EQP.PHYSICAL_FAILURE.CHECK_FAILED',
        severity: 'PATIENT_SAFETY',
        headline: `${asset.name} is out of service`,
        detail: `${asset.code} failed its daily check and cannot be used until repaired and verified.`,
        owner: 'e-rahul', dueAt: Date.now(), instanceId: null, needsAuthorisation: false,
      });
    }
    // A pass does NOT return a failed asset to service; that needs a repair
    // and a second person's signature.
    return json(asset);
  }

  const batchMatch = /^\/api\/v1\/sterilization\/([^/]+)\/advance$/.exec(path);
  if (batchMatch) {
    const batch = db.batches.find((b) => b.id === batchMatch[1]);
    if (!batch) return json({ error: 'Not found' }, 404);
    const ORDER = ['COLLECTED', 'ULTRASONIC', 'INSPECTED', 'PACKED', 'AUTOCLAVED', 'VERIFIED', 'RELEASED'];
    if (batch.stage === 'QUARANTINED') {
      return json({ error: 'A quarantined batch cannot be advanced until its cycle is resolved.' }, 409);
    }
    if (batch.cycleResult === 'FAIL') {
      return json({ error: 'A failed cycle cannot release packs.' }, 409);
    }
    const i = ORDER.indexOf(batch.stage);
    if (i < 0 || i === ORDER.length - 1) return json(batch);
    batch.stage = ORDER[i + 1]!;
    return json(batch);
  }

  const labMatch = /^\/api\/v1\/lab-cases\/([^/]+)\/(\w+)$/.exec(path);
  if (labMatch) {
    const c = db.labCases.find((l) => l.id === labMatch[1]);
    if (!c) return json({ error: 'Not found' }, 404);

    if (labMatch[2] === 'book') {
      // The rule, enforced here exactly as the server enforces it. A demo that
      // let this through would be teaching the opposite of the product.
      if (!c.deliveryReady) {
        return json({ error: `Case not ready for delivery appointment. ${c.deliveryReason}` }, 409);
      }
      c.status = 'DELIVERED';
      c.nextStep = null;
      return json(c);
    }

    if (labMatch[2] === 'qc') {
      if (c.status !== 'QC_PENDING') {
        return json({ error: `${c.reference} must be received before it can be checked.` }, 409);
      }
      if (body.result === 'FAIL') {
        const note = String(body.note ?? '').trim();
        if (!note) return json({ error: 'A failed check must say what is wrong with the case.' }, 409);
        c.status = 'REMAKE';
        c.qcResult = 'FAIL';
        c.remakeCount += 1;
        c.nextStep = 'Re-dispatch for remake';
        c.deliveryReady = false;
        c.deliveryReason = `${c.reference} failed its check and is being remade.`;
        raise({
          code: 'LAB.QC.FAILED',
          severity: c.remakeCount > 1 ? 'CRITICAL' : 'IMPORTANT',
          headline: `${c.reference} failed check — remake needed`,
          detail: `${c.workType}, tooth ${c.toothRef}, ${c.vendor}. ${note}`,
          owner: 'e-rahul', dueAt: Date.now(), instanceId: null, needsAuthorisation: false,
        });
        return json(c);
      }
      c.status = 'PATIENT_READY';
      c.qcResult = 'PASS';
      c.nextStep = 'Book the delivery appointment';
      c.deliveryReady = true;
      c.deliveryReason = null;
      return json(c);
    }
  }

  // ---- PATIENTS: readiness before the chair, and follow-ups after it ----

  if (path === '/api/v1/patient-procedures' && method === 'GET') {
    return json(db.patientProcedures.map(readinessView));
  }

  const ppMatch = /^\/api\/v1\/patient-procedures\/([^/]+)\/(\w+)$/.exec(path);
  if (ppMatch) {
    const pp = db.patientProcedures.find((p) => p.id === ppMatch[1]);
    if (!pp) return json({ error: 'Not found' }, 404);
    const view = readinessView(pp);

    if (ppMatch[2] === 'start') {
      if (view.decision === 'BLOCK_HARD') {
        return json({
          error: `${pp.procedureName} cannot start: ${view.blocking[0]?.detail ?? 'a mandatory requirement is not met'}`,
        }, 409);
      }
      if (view.decision === 'BLOCK_OVERRIDABLE' && !pp.overriddenBy) {
        return json({
          error: `${pp.procedureName} is not ready: ${view.blocking[0]?.detail ?? 'a requirement is not met'}`,
        }, 409);
      }
      pp.status = 'IN_PROGRESS';
      return json(readinessView(pp));
    }

    if (ppMatch[2] === 'override') {
      const reason = String(body.reason ?? '').trim();
      // ADR-004: BLOCK_HARD has no override path. No permission exists to grant.
      if (view.decision === 'BLOCK_HARD') {
        return json({ error: 'This requirement cannot be overridden by anyone.' }, 409);
      }
      if (view.decision === 'PROCEED') {
        return json({ error: 'Nothing to override — the procedure is ready.' }, 409);
      }
      if (!reason) return json({ error: 'An override must record why it was safe.' }, 409);
      pp.overriddenBy = me.displayLabel;
      pp.overrideReason = reason;
      return json(readinessView(pp));
    }
  }

  if (path === '/api/v1/followups' && method === 'GET') {
    return json(db.followups);
  }

  const fuMatch = /^\/api\/v1\/followups\/([^/]+)\/respond$/.exec(path);
  if (fuMatch) {
    const fu = db.followups.find((f) => f.id === fuMatch[1]);
    if (!fu) return json({ error: 'Not found' }, 404);
    if (fu.outcome !== 'PENDING') {
      return json({ error: 'That follow-up has already been recorded.' }, 409);
    }
    fu.pain = String(body.pain ?? 'NONE');
    fu.swelling = String(body.swelling ?? 'EXPECTED');
    fu.bleeding = String(body.bleeding ?? 'NO');
    fu.medication = String(body.medication ?? 'TAKING');
    // The ENGINE decides, not the person who made the call. Recording symptoms
    // is within anyone's competence; judging them clinically is not.
    const reason = redFlagReason(fu);
    fu.redFlagReason = reason;
    fu.outcome = reason ? 'RED_FLAG' : 'CONTACTED_WELL';
    if (reason) {
      raise({
        code: 'FUP.CLINICAL_RISK.RED_FLAG',
        severity: 'PATIENT_SAFETY',
        headline: `Clinical review needed after surgery — ${reason.toLowerCase()}`,
        detail: `${fu.patientLabel} · ${fu.procedureName}`,
        owner: 'e-rahul',
        // FUP-003's due rule is not an interval, it is "now".
        dueAt: Date.now(),
        instanceId: null,
        needsAuthorisation: false,
      });
    }
    return json(fu);
  }

  return json({ error: 'Not found' }, 404);
}

/** Replace window.fetch so the real API client talks to the copy above. */
export function installDemoBackend() {
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    let body: Record<string, unknown> = {};
    try { body = init?.body ? JSON.parse(String(init.body)) : {}; } catch { /* no body */ }
    // A beat of latency, so buttons show their saving state like the real thing.
    await new Promise((r) => setTimeout(r, 90));
    return handle(url, method, body);
  };
}
