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

type Role =
  | 'OWNER_DIRECTOR'
  | 'DENTAL_ASSISTANT' | 'CLINIC_MANAGER' | 'SENIOR_ASSISTANT' | 'RECEPTION';

interface Person {
  key: string;
  email: string;
  employeeId: string;
  displayLabel: string;
  roles: Role[];
}

export const PEOPLE: Person[] = [
  { key: 'priya', email: 'priya@synthetic.test', employeeId: 'e-priya', displayLabel: 'SYNTHETIC Priya S.', roles: ['DENTAL_ASSISTANT'] },
  { key: 'rahul', email: 'rahul@synthetic.test', employeeId: 'e-rahul', displayLabel: 'SYNTHETIC Rahul M.', roles: ['CLINIC_MANAGER'] },
  { key: 'anita', email: 'anita@synthetic.test', employeeId: 'e-anita', displayLabel: 'SYNTHETIC Anita K.', roles: ['SENIOR_ASSISTANT'] },
  { key: 'kavita', email: 'kavita@synthetic.test', employeeId: 'e-kavita', displayLabel: 'SYNTHETIC Kavita R.', roles: ['RECEPTION'] },
  // The owner was missing entirely, which meant the one view the requirement
  // describes in most detail -- "you should not see 150 tasks" -- could not be
  // reached by anybody.
  { key: 'deepak', email: 'deepak@synthetic.test', employeeId: 'e-deepak', displayLabel: 'SYNTHETIC Deepak V.', roles: ['OWNER_DIRECTOR'] },
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
  /** Which half of the day this belongs to. Counted separately, always. */
  process: 'Opening Readiness' | 'Closing Readiness';
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
  const tasks: Task[] = [
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
          verifiedBy: 'Rahul', verificationNote: null, ineffectiveCount: 0,
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

  return {
    tasks, visits, attention, incidents, patientProcedures, followups,
    nextIncidentNumber: 8,
    signedIn: null as Person | null,
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

export function signInAs(key: string) {
  db.signedIn = PEOPLE.find((p) => p.key === key) ?? null;
}

export function currentPerson(): Person | null {
  return db.signedIn;
}

// ---------------------------------------------------------------------------

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

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
    d('Inventory', null, 95, [], 'Inventory module not built yet', false),
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

    if (action === 'start') { t.status = 'IN_PROGRESS'; return json({ status: t.status }); }

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
          return json({
            error: `${t.cantConfirm}. A manager has been asked to look at it — you don't need to chase them.`,
            canOverride: false,
          }, 409);
        }
        if (!String(body.overrideReason ?? '').trim()) {
          return json({
            error: `${t.cantConfirm}. Report a problem, or record why it is safe to go ahead.`,
            canOverride: true,
          }, 409);
        }
      }

      t.status = 'COMPLETED';
      t.completedBy = me.employeeId;

      const outOfRange: Array<{ label: string; value: number; unit: string | null }> = [];
      const ac = t.responses['i-401'];
      if (ac?.value != null && (ac.value < 20 || ac.value > 26)) {
        outOfRange.push({ label: 'Air conditioning set', value: ac.value, unit: '°C' });
        raise({
          code: 'OPN.THRESHOLD', headline: `Air conditioning set is outside the normal range (${ac.value}°C)`,
          severity: 'IMPORTANT', detail: null, owner: 'e-rahul',
          dueAt: Date.now() + 120 * 60_000, instanceId: t.id, needsAuthorisation: false,
        });
      }

      if (t.selfVerifyAllowed) {
        t.status = 'VERIFIED';
        return json({ status: 'VERIFIED', selfVerified: true, waitingForCheck: false, outOfRange });
      }
      return json({ status: 'COMPLETED', selfVerified: false, waitingForCheck: true, outOfRange });
    }
  }

  // ---- ATTENTION ----
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
