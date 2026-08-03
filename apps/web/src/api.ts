/**
 * The only place the web app talks to the server.
 *
 * Everything here returns what the server said. There is deliberately no
 * client-side rule evaluation: the screen never decides whether a task may be
 * finished, whether a gate blocks, or who may verify. It asks, and renders the
 * answer. A UI check is a courtesy; the server is the control.
 */

/** A refusal the person can act on, as opposed to something that went wrong. */
export class ApiError extends Error {
  readonly status: number;
  /** Set when the server refused because a gate blocked, not because of a bug. */
  readonly canOverride: boolean;
  constructor(status: number, message: string, canOverride = false) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.canOverride = canOverride;
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });

  if (!res.ok) {
    // The server writes messages for people to read. Pass them through
    // unchanged rather than inventing a friendlier one that might be wrong.
    const body = (await res.json().catch(() => null)) as
      | { error?: string; canOverride?: boolean }
      | null;
    throw new ApiError(
      res.status,
      body?.error ?? 'Something went wrong. Please try again.',
      body?.canOverride ?? false,
    );
  }
  return (await res.json()) as T;
}

const post = <T>(path: string, body?: unknown): Promise<T> =>
  call<T>(path, { method: 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

// ---- shapes, mirroring what the server actually returns --------------------

export interface Me {
  displayLabel: string;
  roleCodes: string[];
  clinicIds: string[];
  crossClinic: boolean;
}

export type BucketName = 'OVERDUE' | 'NOW' | 'NEXT' | 'LATER';

export interface TaskRow {
  id: string;
  title: string;
  standard: string | null;
  dueAt: string;
  status: string;
  started: boolean;
  blockedBy: string | null;
}

/**
 * Today's opening set at this clinic, as counts. `null` when there is no
 * opening set today — which is NOT the same as complete and must never be
 * rendered as "the clinic is open".
 */
export interface OpeningStatus {
  total: number;
  done: number;
  complete: boolean;
}

/**
 * Where the clinic is, right now. `null` for someone who can see every clinic
 * — they have no single "here".
 */
export interface ClinicContext {
  name: string;
  /** The clinic's timezone. Every time on screen is formatted with this. */
  timezone: string;
  /** null when there is no opening set today. Absent is not ready. */
  phase: 'OPENING' | 'OPEN' | 'SEEING_PATIENTS' | 'CLOSING' | 'CLOSED' | null;
  opening: OpeningStatus | null;
  /** The end-of-day set. Null when this clinic has no closing time configured. */
  closing: OpeningStatus | null;
  /** The clinic's own configured opening time for today. */
  readyBy: string | null;
  /** The clinic's own configured closing time for today. Never guessed. */
  closingAt: string | null;
  /** When the next patient is due, or null when there is genuinely nobody. */
  firstPatientAt: string | null;
}

export interface MyDay {
  buckets: Record<BucketName, TaskRow[]>;
  attentionCount: number;
  clinic: ClinicContext | null;
  opening: OpeningStatus | null;
}

export interface SheetItem {
  id: string;
  label: string;
  requiresValue: boolean;
  unit: string | null;
  checked: boolean;
  value: number | null;
}

export interface TaskSheet {
  id: string;
  title: string;
  standard: string | null;
  status: string;
  dueAt: string;
  isMine: boolean;
  needsSomeoneElseToCheck: boolean;
  items: SheetItem[];
  cantConfirm: string | null;
  canOverrideBlock: boolean;
  blockedBy: string | null;
  problemKinds: Array<{ key: string; label: string }>;
  /** Why this task exists, who owns it, and what it moves. */
  spec: WorkSpecView | null;
}

/**
 * The chain, per task: parameter → process → trigger → four responsibilities →
 * escalation ladder → KPI.
 *
 * Carried on the task itself so a person can always answer "why am I doing
 * this and who is waiting on it" without leaving the screen.
 */
export interface WorkSpecView {
  origin: string;
  originLabel: string;
  engine: string;
  trigger: string;
  parameter: string;
  process: string;
  responsibility: {
    doer: string;
    /** Null means self-verification is allowed — never "nobody checks". */
    checker: string | null;
    owner: string;
    escalation: string;
  };
  escalation: Array<{ level: number; afterMinutes: number; to: string }>;
  kpi: string | null;
}

export interface CompleteResult {
  status: string;
  selfVerified: boolean;
  waitingForCheck: boolean;
  outOfRange: Array<{ label: string; value: number; unit: string | null }>;
}

export interface AttentionRow {
  id: string;
  headline: string;
  severity: string;
  detail: string | null;
  mine: boolean;
  dueAt: string | null;
  escalated: boolean;
  /** The task this came from, when there is one. */
  instanceId?: string | null;
  /** Some items are "go and do something", not "close this". */
  needsAuthorisation?: boolean;
}

export interface CheckRow {
  id: string;
  title: string;
  completedAt: string;
  standard: string | null;
}

/** What the checker sees: the work as it was actually recorded. No names (Q6). */
export interface CheckDetail {
  id: string;
  title: string;
  standard: string | null;
  completedAt: string;
  items: Array<{
    id: string;
    label: string;
    checked: boolean;
    value: number | null;
    unit: string | null;
  }>;
}

/** One visit on today's list. Patient-facing words only — no status tokens. */
export interface ScheduleRow {
  id: string;
  patientLabel: string;
  patientUhid: string;
  visitType: string;
  chairLabel: string | null;
  scheduledStart: string;
  scheduledEnd: string;
  status: 'BOOKED' | 'ARRIVED' | 'IN_CHAIR' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
  statusLabel: string;
  waitingMinutes: number | null;
  arrivedAt: string | null;
}

export interface Schedule {
  rows: ScheduleRow[];
  periodKey: string | null;
  timezone?: string;
}

export type RagStatus = 'GREEN' | 'AMBER' | 'RED' | 'GREY';

/** One of the 16 control parameters, scored. */
export interface ParameterScore {
  parameter: string;
  /** Null when there was nothing to measure. Never rendered as zero. */
  percent: number | null;
  status: RagStatus;
  done: number;
  total: number;
  openProblems: number;
  patientSafetyProblems: number;
  /** One clinic-readable line saying why it is not green. Null when it is. */
  because: string | null;
}

export interface OperationalHealth {
  percent: number | null;
  status: RagStatus;
  /** Worst first — the order the owner should look at them in. */
  parameters: ParameterScore[];
  needsAttention: { critical: number; attention: number };
}

export interface Overview {
  health: OperationalHealth;
  readiness: { done: number; total: number; percent: number | null };
  patients: { seen: number; expected: number; waiting: number; notSeen: number };
  problems: { open: number; patientSafety: number; overdue: number };
  /** Oldest first. `readiness` is null on a day with nothing scheduled. */
  week: Array<{ periodKey: string; readiness: number | null; onTime: boolean | null }>;
  independentChecks: { independent: number; total: number; percent: number | null };
}

/** One line of the handover. Plain clinic language, and never a person's name. */
export interface HandoverLine {
  headline: string;
  detail: string | null;
  severity: 'PATIENT_SAFETY' | 'CRITICAL' | 'IMPORTANT' | 'ROUTINE';
}

export interface Handover {
  periodKey: string | null;
  /** True when nothing is being carried into tomorrow. */
  clear: boolean;
  unfinished: HandoverLine[];
  waitingOnSomeone: HandoverLine[];
  stillOpen: HandoverLine[];
  patientsNotSeen: HandoverLine[];
}

export interface ChecklistAnswer {
  itemId: string;
  checked: boolean;
  numericValue?: number;
}

// ---- calls ------------------------------------------------------------------

/** One corrective or preventive action on an incident. */
export interface CapaAction {
  id: string;
  type: 'CORRECTIVE' | 'PREVENTIVE';
  status: 'OPEN' | 'ACTION_IN_PROGRESS' | 'IMPLEMENTED' | 'EFFECTIVENESS_PENDING'
    | 'EFFECTIVE' | 'CLOSED';
  /** How many times this fix was found ineffective and sent back. */
  ineffectiveCount: number;
  description: string;
  responsible: string;
  responsibleName: string;
  verifiedBy: string | null;
  verificationNote: string | null;
}

/**
 * An incident travelling the IMPROVE stage of the loop.
 *
 * `blockedBy` is the single next step in one clause. A status word tells you
 * where a thing is; it does not tell you what to do — and a deviation nobody
 * knows how to clear is just a different kind of list.
 */
export interface Incident {
  id: string;
  reference: string;
  parameter: string;
  priority: string;
  status: 'OPEN' | 'CONTAINED' | 'INVESTIGATED' | 'ACTIONS_PLANNED' | 'VERIFYING' | 'CLOSED';
  summary: string;
  description: string | null;
  immediateCorrection: string | null;
  rootCause: string | null;
  ageDays: number;
  stage: number;
  blockedBy: string | null;
  openActions: number;
  totalActions: number;
  canClose: boolean;
  actions: CapaAction[];
}

export interface Requirement {
  kind: string;
  label: string;
  enforcement: 'ADVISORY' | 'BLOCK_OVERRIDABLE' | 'BLOCK_HARD';
  result: 'PASS' | 'FAIL' | 'UNKNOWN' | 'NOT_CONFIGURED' | 'NOT_APPLICABLE';
  decision: 'PROCEED' | 'WARN' | 'BLOCK_OVERRIDABLE' | 'BLOCK_HARD';
  detail: string;
}

export interface PatientProcedure {
  id: string;
  patientLabel: string;
  patientUhid: string;
  procedureName: string;
  category: string;
  whenLabel: string;
  status: 'READY' | 'PARTIAL' | 'NOT_READY' | 'PENDING' | 'OVERRIDDEN';
  decision: 'PROCEED' | 'WARN' | 'BLOCK_OVERRIDABLE' | 'BLOCK_HARD';
  requirements: Requirement[];
  /** Not-PASS requirements, worst first. What the doctor actually reads. */
  blocking: Requirement[];
  overridable: boolean;
  overriddenBy: string | null;
  overrideReason: string | null;
  alerts: string[];
  metCount: number;
}

export interface Followup {
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

export interface MisDomain {
  name: string;
  score: number | null;
  target: number;
  trend: number[];
  note: string;
  status: 'GREEN' | 'AMBER' | 'RED' | 'GREY';
  /** False when the module behind this domain does not exist yet. */
  built: boolean;
}

export interface OwnerMis {
  clinicName: string;
  /** Null when nothing is measurable. Never rendered as zero. */
  health: number | null;
  domains: MisDomain[];
  critical: Array<{ id: string; headline: string; detail: string | null }>;
  attention: Array<{ id: string; headline: string; detail: string | null }>;
  repeatFailures: Array<{ reference: string; summary: string; attempts: number }>;
  capa: { open: number; awaitingEffectiveness: number; closed: number };
}

export interface DemoAsset {
  id: string; code: string; name: string; category: string;
  status: 'OPERATIONAL' | 'RESTRICTED' | 'OUT_OF_SERVICE' | 'UNDER_REPAIR' | 'RETIRED';
  location: string;
  checkedToday: 'PASS' | 'FAIL' | null;
  nextServiceInDays: number | null;
  serviceKind: string | null;
}

export interface DemoStock {
  id: string; code: string; name: string; unit: string;
  /** Excludes expired batches. Never shown without this. */
  available: number;
  onHand: number; minimumQty: number; reorderLevel: number;
  state: 'OK' | 'REORDER' | 'SHORTAGE';
  expiringSoon: number; expired: number;
}

export interface DemoLabCase {
  id: string; reference: string; patientLabel: string; vendor: string;
  workType: string; toothRef: string; status: string;
  expectedLabel: string | null; overdue: boolean;
  qcResult: 'PASS' | 'FAIL' | null; remakeCount: number;
  nextStep: string | null;
  /** Received AND QC-passed. The crown gate. */
  deliveryReady: boolean;
  deliveryReason: string | null;
}

export interface Operations {
  assets: DemoAsset[];
  stock: DemoStock[];
  implants: Array<{
    id: string; brand: string; line: string; platform: string;
    componentType: string; size: string; quantity: number; expiringSoon: boolean;
  }>;
  batches: Array<{
    id: string; batchRef: string; stage: string; packCount: number;
    operator: string; cycleResult: 'PASS' | 'FAIL' | 'INCONCLUSIVE' | null;
  }>;
  labCases: DemoLabCase[];
  counts: {
    assetsDown: number; serviceDue: number; shortages: number;
    reorders: number; implantGaps: number; batchesPending: number;
    labOverdue: number; labBlocked: number;
  };
}

export interface CommandCentre {
  ready: boolean;
  blockers: Array<{ id: string; label: string }>;
  readiness: {
    opening: string | null; rooms: string | null; sterilization: string | null;
    /** Null where KuBi genuinely does not know. Never rendered as a tick. */
    doctors: string | null; reception: string | null;
    patientsToday: number; firstPatientInMinutes: number | null;
  };
  cards: Array<{ id: string; headline: string; severity: string }>;
  work: { total: number; done: number; running: number; pending: number };
  patients: {
    appointments: number; waiting: number; inChair: number;
    surgery: number; followupsDue: number;
  };
  team: Array<{ name: string; role: string; light: string; note: string | null }>;
  health: Array<{ name: string; light: string }>;
}

/**
 * The briefing — the one idea worth keeping from prototype #1.
 *
 * A flat task list can say "eleven things due". A briefing can say that three
 * sterilisation batches are unfinished, that Mr Bose's crown passed its check
 * and nobody has rung him, and that Mrs Rao is on warfarin. Those are not
 * tasks; they are things this person needs to know before they start. A screen
 * that can only render tasks silently drops them.
 *
 * So a section holds two kinds of item. A `task` is actionable and opens. A
 * `fact` is read-only and does not pretend to be a button.
 */
export interface BriefingItem {
  id: string;
  kind: 'task' | 'fact';
  text: string;
  detail: string | null;
  /** Tasks only. Null on a fact. */
  taskId: string | null;
  /** PATIENT_SAFETY | CRITICAL | IMPORTANT | ROUTINE. Drives the rail colour. */
  priority: string | null;
  /** Facts only: GREEN | AMBER | RED, or null for a neutral note. */
  tone: string | null;
  /** What this is waiting on. Shown as a lock rather than a dead button. */
  blockedBy: string | null;
  /** The activity this traces back to. Constitution rule 5. */
  activityCode: string | null;
}

export interface BriefingSection {
  key: string;
  label: string;
  /** GREEN | AMBER | RED. */
  tone: string;
  /** One line explaining why this section exists at all. */
  hint: string | null;
  items: BriefingItem[];
  /** Shown when a section is legitimately empty — not an error state. */
  emptyText: string;
}

export interface Briefing {
  /** The one question this dashboard answers, shown as the subtitle. */
  question: string;
  roleLabel: string;
  /** Null when this role has no countable work — a doctor is not a task list. */
  work: { total: number; done: number } | null;
  sections: BriefingSection[];
}

/** Layer 5 — one parameter's health, with the direction that matters more. */
export interface ParameterHealthRow {
  parameter: string;
  /** Null means nothing to measure. Never rendered as 0. */
  score: number | null;
  trend: string;
  days: number | null;
  /** Mean evidence confidence behind the score. */
  confidence: number | null;
  /** Upstream parameters currently failing. A parameter cannot outrank these. */
  blockedBy: string[];
}

/** One line of the owner's scoreboard: a management score and its deviations. */
export interface ScoreLine {
  id: string;
  label: string;
  /** How it is measured, in the owner's own words. */
  measure: string;
  /** Null means nothing to measure today. Never rendered as 0. */
  value: number | null;
  /** GREEN | AMBER | RED | GREY. */
  outcome: string;
  deviations: Array<{ label: string; severity: string; detail: string | null }>;
  deviationCount: number;
  parameters: string[];
}

/** Sixteen control parameters rolled into the eight management scores. */
export interface Scoreboard {
  clinicName: string;
  operational: number | null;
  lines: ScoreLine[];
  critical: Array<{ id: string; headline: string }>;
  attention: Array<{ id: string; headline: string }>;
}

/** §6 — one row of the morning confirmation board. Status is derived. */
export interface ConfirmationRow {
  id: string;
  patientLabel: string;
  appointment: string;
  startsInMinutes: number;
  confirmation: string;
  reminderSent: boolean;
  specialInstructions: string | null;
  /** CONFIRMED | NO_RESPONSE | RESCHEDULE | CANCELLED | ACTION_REQUIRED */
  status: string;
}

export interface Confirmations {
  rows: ConfirmationRow[];
  summary: {
    appointments: number; confirmed: number; unconfirmed: number;
    actionRequired: number; cancelled: number;
  };
}

/** One thing that should have happened and did not, with the ladder running. */
export interface ExceptionRow {
  id: string;
  headline: string;
  severity: string;
  detail: string | null;
  minutesLate: number;
  /** Null before the first rung — not yet escalated is a real state. */
  level: number | null;
  escalatedTo: string | null;
  nextRung: { level: number; afterMinutes: number; to: string } | null;
  owner: string | null;
  activityCode: string | null;
}

export interface OwnerBusiness {
  clinicName: string;
  known: Array<{ name: string; value: string | null; available: boolean; module: string | null }>;
  /** Asked for, and not answerable without the named module. */
  missing: Array<{ name: string; value: string | null; available: boolean; module: string | null }>;
  critical: Array<{ id: string; headline: string }>;
  attention: Array<{ id: string; headline: string }>;
}

export interface ReceptionBoard {
  next: { patientLabel: string; visitType: string; inMinutes: number; chairLabel: string } | null;
  waiting: Array<{ id: string; patientLabel: string; visitType: string; waitingMinutes: number }>;
  delayed: Array<{ id: string; patientLabel: string; lateMinutes: number }>;
  confirmations: number;
  followups: Array<{
    id: string; patientLabel: string; procedureName: string;
    dueLabel: string; overdue: boolean;
  }>;
  labReady: Array<{ id: string; reference: string; patientLabel: string; workType: string }>;
  paymentsAvailable: boolean;
}

export const api = {
  login: (email: string, password: string) =>
    post<{ displayLabel: string; roleCodes: string[] }>('/api/v1/auth/login', { email, password }),
  logout: () => post<{ ok: boolean }>('/api/v1/auth/logout'),
  me: () => call<Me>('/api/v1/auth/me'),

  myDay: () => call<MyDay>('/api/v1/my-day'),
  task: (id: string) => call<TaskSheet>(`/api/v1/tasks/${id}`),
  startTask: (id: string) => post<{ status: string }>(`/api/v1/tasks/${id}/start`),
  completeTask: (
    id: string,
    body: { responses: ChecklistAnswer[]; taps?: number; durationMs?: number; overrideReason?: string },
  ) => post<CompleteResult>(`/api/v1/tasks/${id}/complete`, body),
  reportProblem: (id: string, body: { itemId?: string; kind: string; note?: string }) =>
    post<{ headline: string; id: string }>(`/api/v1/tasks/${id}/report-problem`, body),

  attention: () => call<AttentionRow[]>('/api/v1/attention'),
  resolveAttention: (id: string, note: string) =>
    post<{ ok: boolean }>(`/api/v1/attention/${id}/resolve`, { note }),

  overview: () => call<Overview>('/api/v1/overview'),
  handover: () => call<Handover>('/api/v1/handover'),
  schedule: () => call<Schedule>('/api/v1/schedule'),
  setAppointmentStatus: (
    id: string,
    to: 'ARRIVED' | 'IN_CHAIR' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW',
    reason?: string,
  ) => post<{ status: string }>(`/api/v1/appointments/${id}/status`, {
    to, ...(reason ? { reason } : {}),
  }),
  authoriseTask: (id: string, reason: string) =>
    post<{ ok: boolean }>(`/api/v1/tasks/${id}/authorise`, { reason }),

  checks: () => call<CheckRow[]>('/api/v1/checks'),
  check: (id: string) => call<CheckDetail>(`/api/v1/checks/${id}`),
  submitCheck: (id: string, result: 'PASS' | 'FAIL', comment?: string) =>
    post<{ status: string }>(`/api/v1/checks/${id}`, { result, ...(comment ? { comment } : {}) }),

  incidents: () => call<Incident[]>('/api/v1/incidents'),
  containIncident: (id: string, immediateCorrection: string) =>
    post<Incident>(`/api/v1/incidents/${id}/contain`, { immediateCorrection }),
  investigateIncident: (id: string, rootCause: string) =>
    post<Incident>(`/api/v1/incidents/${id}/investigate`, { rootCause }),
  addCapaAction: (id: string, type: 'CORRECTIVE' | 'PREVENTIVE', description: string) =>
    post<Incident>(`/api/v1/incidents/${id}/actions`, { type, description }),
  implementCapaAction: (id: string) =>
    post<Incident>(`/api/v1/capa-actions/${id}/implement`, {}),
  /** `effective: false` sends the action back round the loop — not an error. */
  checkCapaEffectiveness: (id: string, effective: boolean, note?: string) =>
    post<Incident>(`/api/v1/capa-actions/${id}/effectiveness`,
      { effective, ...(note ? { note } : {}) }),
  closeIncident: (id: string) => post<Incident>(`/api/v1/incidents/${id}/close`, {}),

  patientProcedures: () => call<PatientProcedure[]>('/api/v1/patient-procedures'),
  startPatientProcedure: (id: string) =>
    post<PatientProcedure>(`/api/v1/patient-procedures/${id}/start`, {}),
  overridePatientProcedure: (id: string, reason: string) =>
    post<PatientProcedure>(`/api/v1/patient-procedures/${id}/override`, { reason }),

  followups: () => call<Followup[]>('/api/v1/followups'),
  respondToFollowup: (
    id: string,
    r: { pain: string; swelling: string; bleeding: string; medication: string },
  ) => post<Followup>(`/api/v1/followups/${id}/respond`, r),

  ownerMis: () => call<OwnerMis>('/api/v1/owner-mis'),

  operations: () => call<Operations>('/api/v1/operations'),
  checkAsset: (id: string, result: 'PASS' | 'FAIL') =>
    post<DemoAsset>(`/api/v1/assets/${id}/check`, { result }),
  advanceBatch: (id: string) =>
    post<{ stage: string }>(`/api/v1/sterilization/${id}/advance`, {}),

  labQc: (id: string, result: 'PASS' | 'FAIL', note?: string) =>
    post<DemoLabCase>(`/api/v1/lab-cases/${id}/qc`, { result, ...(note ? { note } : {}) }),
  bookDelivery: (id: string) => post<DemoLabCase>(`/api/v1/lab-cases/${id}/book`, {}),

  /** One endpoint, every role. The sections differ; the shape never does. */
  briefing: () => call<Briefing>('/api/v1/briefing'),

  parameterHealth: () => call<ParameterHealthRow[]>('/api/v1/parameter-health'),

  scoreboard: () => call<Scoreboard>('/api/v1/scoreboard'),
  confirmations: () => call<Confirmations>('/api/v1/confirmations'),
  exceptions: () => call<ExceptionRow[]>('/api/v1/exceptions'),

  commandCentre: () => call<CommandCentre>('/api/v1/command-centre'),
  ownerBusiness: () => call<OwnerBusiness>('/api/v1/owner-business'),
  receptionBoard: () => call<ReceptionBoard>('/api/v1/reception-board'),
};
