/**
 * The operating model: what happens, who holds it, and when it is late.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Why this file exists, in the owner's words
 * ─────────────────────────────────────────────────────────────────────────
 *
 * *"It is still a DEMO. Not an operating system… I would completely change
 * the architecture. Everything starts with an event. Not screens. Not pages.
 * Not cards. Build engines."*
 *
 * And, decisively:
 *
 * *"asking Claude to keep modifying a single HTML file will become
 * counterproductive. The next iteration should begin by designing the backend
 * operating model first."*
 *
 * So this is the model, not a screen. It is a vocabulary and nothing else —
 * no rendering, no database, no clock. `engine.ts` next door is the behaviour.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * The three things it replaces
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 1. **The linear clinic state machine is gone.** A clinic does not have one
 *    state. It has a dozen pieces of work in flight at once — reception,
 *    two doctors, an assistant, the autoclave, a lab case, a bill — each with
 *    its own owner and its own clock. Seven workflow kinds run concurrently
 *    and never queue behind one another.
 *
 * 2. **Actions are gone; events remain.** Every name below is past tense,
 *    because it records something a person did in the clinic. There is no
 *    `BRING_PATIENT`, no `START_TREATMENT`, no `RESUME_AFTER_LUNCH`. Those
 *    were the software asking to be operated.
 *
 * 3. **Nobody moves work.** A node names the event that ends it and the node
 *    that follows. When the event lands, ownership transfers — no handover
 *    step exists to be skipped, and no phase field exists for anyone to set
 *    by hand.
 */
import { RoleCode } from './enums.js';
import { Objective } from './objectives.js';

/* -------------------------------------------------------------------------
 * Events — what happened, never what to do
 * ---------------------------------------------------------------------- */

export const ClinicEvent = {
  // The premises
  CLINIC_UNLOCKED: 'CLINIC_UNLOCKED',
  ROOMS_READY: 'ROOMS_READY',
  HUDDLE_HELD: 'HUDDLE_HELD',
  CLINIC_LOCKED: 'CLINIC_LOCKED',

  // A patient's visit
  PATIENT_ARRIVED: 'PATIENT_ARRIVED',
  PATIENT_REGISTERED: 'PATIENT_REGISTERED',
  PATIENT_SEATED: 'PATIENT_SEATED',
  DIAGNOSIS_RECORDED: 'DIAGNOSIS_RECORDED',
  PLAN_ACCEPTED: 'PLAN_ACCEPTED',
  CONSENT_SIGNED: 'CONSENT_SIGNED',
  TREATMENT_FINISHED: 'TREATMENT_FINISHED',
  PAYMENT_RECEIVED: 'PAYMENT_RECEIVED',
  INSTRUCTIONS_GIVEN: 'INSTRUCTIONS_GIVEN',
  RECALL_BOOKED: 'RECALL_BOOKED',

  // The clinical record, which outlives the visit
  NOTES_COMPLETED: 'NOTES_COMPLETED',
  FOLLOWUP_CALLED: 'FOLLOWUP_CALLED',

  // The instrument loop
  BATCH_COLLECTED: 'BATCH_COLLECTED',
  BATCH_ULTRASONIC_DONE: 'BATCH_ULTRASONIC_DONE',
  BATCH_PACKED: 'BATCH_PACKED',
  BATCH_AUTOCLAVED: 'BATCH_AUTOCLAVED',
  BATCH_RELEASED: 'BATCH_RELEASED',

  // The laboratory
  LAB_DISPATCHED: 'LAB_DISPATCHED',
  LAB_ARRIVED: 'LAB_ARRIVED',
  LAB_QC_PASSED: 'LAB_QC_PASSED',
  LAB_APPOINTMENT_GIVEN: 'LAB_APPOINTMENT_GIVEN',

  // Stock
  STOCK_ORDERED: 'STOCK_ORDERED',
  STOCK_RECEIVED: 'STOCK_RECEIVED',

  // Money
  INVOICE_RAISED: 'INVOICE_RAISED',
  INVOICE_SETTLED: 'INVOICE_SETTLED',
} as const;
export type ClinicEvent = (typeof ClinicEvent)[keyof typeof ClinicEvent];

/**
 * Every event name is past tense, and this is the test that keeps it so.
 *
 * Kept as data rather than a naming convention in somebody's head: the moment
 * an imperative slips in — `SEAT_PATIENT` — the model has gone back to being
 * a remote control for a state machine.
 */
export const IMPERATIVE_PREFIXES = [
  'START_', 'BRING_', 'OPEN_', 'DO_', 'GO_', 'MOVE_', 'SET_', 'MARK_',
  'RESUME_', 'FINISH_', 'ADVANCE_', 'NEXT_',
] as const;

/* -------------------------------------------------------------------------
 * Workflows — seven of them, running at once
 * ---------------------------------------------------------------------- */

export const FlowKind = {
  /** The premises: unlocked, ready, running, locked. One per day. */
  CLINIC: 'CLINIC',
  /** One per visit. The lanes of the live board are this flow's nodes. */
  PATIENT: 'PATIENT',
  /** One per treatment. Outlives the visit — the note and the day-after call. */
  CLINICAL: 'CLINICAL',
  /** One per instrument batch. */
  STERILIZATION: 'STERILIZATION',
  /** One per lab case. */
  LAB: 'LAB',
  /** One per item that fell below its minimum. */
  INVENTORY: 'INVENTORY',
  /** One per invoice. */
  BILLING: 'BILLING',
} as const;
export type FlowKind = (typeof FlowKind)[keyof typeof FlowKind];

/**
 * One step of work.
 *
 * `owner` is a role and never a person: a ladder that names somebody breaks
 * the week they leave. `expectMinutes` is what makes lateness a fact rather
 * than an opinion, and `escalateTo` is who finds out — which is the entire
 * difference between work being tracked and work being supervised.
 */
export interface FlowNode {
  id: string;
  /** What the holder is doing, in their own words. */
  label: string;
  owner: RoleCode;
  /** The event that ends it. Nothing else can. */
  completedBy: ClinicEvent;
  /** How long it should take from the moment it is handed over. */
  expectMinutes: number;
  /** Who hears when it has taken longer than that. */
  escalateTo: RoleCode;
  /**
   * What this step is for (§2.1). Its rank is what orders a person's day when
   * two pieces of work want them at once, so it is not decoration — assigning
   * the wrong one here changes which patient gets seen first.
   */
  objective: Objective;
}

export interface FlowDefinition {
  kind: FlowKind;
  label: string;
  /** What one instance is about, for a screen: "Meera R.", "STER-0914". */
  subjectNoun: string;
  nodes: readonly FlowNode[];
}

const node = (
  id: string, label: string, owner: RoleCode,
  completedBy: ClinicEvent, expectMinutes: number,
  objective: Objective,
  escalateTo: RoleCode = RoleCode.CLINIC_MANAGER,
): FlowNode => ({ id, label, owner, completedBy, expectMinutes, escalateTo, objective });

export const FLOWS: Record<FlowKind, FlowDefinition> = {
  [FlowKind.CLINIC]: {
    kind: FlowKind.CLINIC,
    label: 'The premises',
    subjectNoun: 'the clinic',
    nodes: [
      node('UNLOCK', 'Unlock and open up', RoleCode.RECEPTION, ClinicEvent.CLINIC_UNLOCKED, 10, Objective.CLINIC_EFFICIENT),
      node('ROOMS', 'Make the rooms ready', RoleCode.DENTAL_ASSISTANT, ClinicEvent.ROOMS_READY, 25, Objective.PATIENT_SAFE),
      node('HUDDLE', 'Hold the morning huddle', RoleCode.CLINIC_MANAGER, ClinicEvent.HUDDLE_HELD, 15, Objective.CLINIC_EFFICIENT, RoleCode.CLINIC_HEAD),
      node('RUN', 'Run the day', RoleCode.CLINIC_MANAGER, ClinicEvent.CLINIC_LOCKED, 480, Objective.CLINIC_EFFICIENT, RoleCode.CLINIC_HEAD),
    ],
  },

  [FlowKind.PATIENT]: {
    kind: FlowKind.PATIENT,
    label: 'Patient visit',
    subjectNoun: 'patient',
    nodes: [
      node('ARRIVE', 'Waiting to arrive', RoleCode.RECEPTION, ClinicEvent.PATIENT_ARRIVED, 15, Objective.PATIENT_HAPPY),
      node('REGISTER', 'Register and check alerts', RoleCode.RECEPTION, ClinicEvent.PATIENT_REGISTERED, 5, Objective.PATIENT_SAFE),
      // The waiting-room clock. Fifteen minutes is the owner's own threshold:
      // "Patient waiting 14 minutes → notify Reception."
      node('SEAT', 'Waiting for a chair', RoleCode.DENTAL_ASSISTANT, ClinicEvent.PATIENT_SEATED, 15, Objective.PATIENT_HAPPY),
      node('ASSESS', 'Examine and diagnose', RoleCode.TREATING_DOCTOR, ClinicEvent.DIAGNOSIS_RECORDED, 20, Objective.TREATMENT_SUCCESSFUL, RoleCode.CLINIC_HEAD),
      node('PLAN', 'Agree the treatment plan', RoleCode.TREATING_DOCTOR, ClinicEvent.PLAN_ACCEPTED, 15, Objective.TREATMENT_SUCCESSFUL, RoleCode.CLINIC_HEAD),
      node('TREAT', 'Carry out the treatment', RoleCode.TREATING_DOCTOR, ClinicEvent.TREATMENT_FINISHED, 50, Objective.TREATMENT_SUCCESSFUL, RoleCode.CLINIC_HEAD),
      node('BILL', 'Settle the bill', RoleCode.RECEPTION, ClinicEvent.PAYMENT_RECEIVED, 15, Objective.MONEY_COLLECTED),
      node('AFTER', 'Give post-operative instructions', RoleCode.DENTAL_ASSISTANT, ClinicEvent.INSTRUCTIONS_GIVEN, 10, Objective.TREATMENT_SUCCESSFUL),
      node('RECALL', 'Book the recall', RoleCode.RECEPTION, ClinicEvent.RECALL_BOOKED, 10, Objective.PATIENT_RECALLED),
    ],
  },

  [FlowKind.CLINICAL]: {
    kind: FlowKind.CLINICAL,
    label: 'Clinical record',
    subjectNoun: 'treatment',
    nodes: [
      node('NOTES', 'Complete the clinical note', RoleCode.TREATING_DOCTOR, ClinicEvent.NOTES_COMPLETED, 30, Objective.RECORDS_COMPLETE, RoleCode.CLINIC_HEAD),
      node('CALL', 'Day-after follow-up call', RoleCode.TREATING_DOCTOR, ClinicEvent.FOLLOWUP_CALLED, 1440, Objective.TREATMENT_SUCCESSFUL, RoleCode.CLINIC_HEAD),
    ],
  },

  [FlowKind.STERILIZATION]: {
    kind: FlowKind.STERILIZATION,
    label: 'Sterilisation',
    subjectNoun: 'batch',
    nodes: [
      node('COLLECT', 'Collect used instruments', RoleCode.STERILIZATION_TECHNICIAN, ClinicEvent.BATCH_COLLECTED, 10, Objective.PATIENT_SAFE),
      node('ULTRA', 'Run the ultrasonic', RoleCode.STERILIZATION_TECHNICIAN, ClinicEvent.BATCH_ULTRASONIC_DONE, 20, Objective.PATIENT_SAFE),
      node('PACK', 'Inspect, dry and pack', RoleCode.STERILIZATION_TECHNICIAN, ClinicEvent.BATCH_PACKED, 15, Objective.PATIENT_SAFE),
      node('AUTO', 'Run the autoclave', RoleCode.STERILIZATION_TECHNICIAN, ClinicEvent.BATCH_AUTOCLAVED, 45, Objective.PATIENT_SAFE),
      /**
       * The clearest case of ownership moving on its own, and the reason the
       * engine has to do it rather than a person: an operator may not release
       * their own batch. The moment the autoclave finishes, this lands on the
       * senior assistant's screen. Nobody hands it over, so nobody can decide
       * not to.
       */
      node('RELEASE', 'Check and release the batch', RoleCode.SENIOR_ASSISTANT, ClinicEvent.BATCH_RELEASED, 15, Objective.PATIENT_SAFE, RoleCode.CLINIC_HEAD),
    ],
  },

  [FlowKind.LAB]: {
    kind: FlowKind.LAB,
    label: 'Laboratory case',
    subjectNoun: 'case',
    nodes: [
      node('SEND', 'Send the case out', RoleCode.LAB_COORDINATOR, ClinicEvent.LAB_DISPATCHED, 30, Objective.TREATMENT_SUCCESSFUL),
      node('AWAIT', 'Chase the case back', RoleCode.LAB_COORDINATOR, ClinicEvent.LAB_ARRIVED, 4320, Objective.TREATMENT_SUCCESSFUL),
      node('QC', 'Check the work before the patient sees it', RoleCode.TREATING_DOCTOR, ClinicEvent.LAB_QC_PASSED, 60, Objective.PATIENT_SAFE, RoleCode.CLINIC_HEAD),
      node('BOOK', 'Give the patient a date', RoleCode.RECEPTION, ClinicEvent.LAB_APPOINTMENT_GIVEN, 60, Objective.PATIENT_HAPPY),
    ],
  },

  [FlowKind.INVENTORY]: {
    kind: FlowKind.INVENTORY,
    label: 'Replenishment',
    subjectNoun: 'item',
    nodes: [
      node('ORDER', 'Raise the order', RoleCode.INVENTORY_COORDINATOR, ClinicEvent.STOCK_ORDERED, 120, Objective.CLINIC_EFFICIENT),
      node('RECEIVE', 'Book the stock in', RoleCode.INVENTORY_COORDINATOR, ClinicEvent.STOCK_RECEIVED, 2880, Objective.CLINIC_EFFICIENT),
    ],
  },

  [FlowKind.BILLING]: {
    kind: FlowKind.BILLING,
    label: 'Billing',
    subjectNoun: 'invoice',
    nodes: [
      node('RAISE', 'Raise the invoice', RoleCode.RECEPTION, ClinicEvent.INVOICE_RAISED, 20, Objective.MONEY_COLLECTED),
      node('SETTLE', 'Collect what is owed', RoleCode.RECEPTION, ClinicEvent.INVOICE_SETTLED, 2880, Objective.MONEY_COLLECTED),
    ],
  },
};

/** Which node of which flow an event completes. Built once, read constantly. */
export const COMPLETES: ReadonlyMap<ClinicEvent, { kind: FlowKind; index: number }> =
  new Map(
    Object.values(FLOWS).flatMap((f) =>
      f.nodes.map((nd, i) => [nd.completedBy, { kind: f.kind, index: i }] as const),
    ),
  );

/**
 * Events that begin a flow rather than advancing one.
 *
 * A patient arriving does not advance anything — it is the moment a visit
 * starts existing. Same for a batch being collected and a case going out.
 */
export const STARTS: ReadonlyMap<ClinicEvent, FlowKind> = new Map([
  [ClinicEvent.CLINIC_UNLOCKED, FlowKind.CLINIC],
  [ClinicEvent.PATIENT_ARRIVED, FlowKind.PATIENT],
  [ClinicEvent.BATCH_COLLECTED, FlowKind.STERILIZATION],
  [ClinicEvent.LAB_DISPATCHED, FlowKind.LAB],
  [ClinicEvent.STOCK_ORDERED, FlowKind.INVENTORY],
  [ClinicEvent.INVOICE_RAISED, FlowKind.BILLING],
]);

/**
 * Flows that a completing event opens elsewhere.
 *
 * The owner's *"one event, ten consequences"*. Finishing a treatment does not
 * only advance that visit: it opens a clinical record with its own note and
 * its own day-after call, owned by the doctor and clocked separately, and it
 * opens a bill. Neither is a step of the visit, and neither may be forgotten
 * because the visit ended.
 */
export const OPENS: ReadonlyMap<ClinicEvent, readonly FlowKind[]> = new Map([
  [ClinicEvent.TREATMENT_FINISHED, [FlowKind.CLINICAL, FlowKind.BILLING]],
]);
