/**
 * The engines. One event in, many consequences out.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * The shape the owner asked for
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   EVENT ENGINE → WORKFLOW ENGINE → ROLE ENGINE → GOVERNANCE → REPORTS
 *
 * Read the other way, because that is the order things actually happen in:
 *
 *   `admit()`  — governance decides whether the event may be recorded at all.
 *                It either says nothing or says ONE sentence and offers ONE
 *                button. The words gate, requirement, compliance, fact and
 *                validation never leave this file.
 *   `apply()`  — the workflow engine completes the node, hands ownership to
 *                the next role, opens whatever other flows this event opens,
 *                and returns every consequence as data.
 *   `sweep()`  — the passage of time. Work goes late and escalates with
 *                nobody pressing anything, which is the difference between
 *                software that waits and software that thinks.
 *   `deskOf()` — the role engine. Same world, eight different clinics.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Pure on purpose
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Every function here is `(world, …, now) => something`. No `Date.now()`, no
 * database, no rendering. That is what lets a test stand at 10:14 and again at
 * 10:16 and watch a patient escalate without a browser, a clock or a person —
 * and it is why this is the operating model rather than another demo.
 *
 * The world is never mutated. Each call returns a new one, so the event log
 * and the world can never disagree about what happened.
 */
import { RoleCode } from './enums.js';
import {
  ClinicEvent, FlowKind, FLOWS, COMPLETES, STARTS, OPENS,
  type FlowNode,
} from './operating-model.js';
import { readiness, whyNotReady, type Operatory } from './readiness.js';

/* -------------------------------------------------------------------------
 * The world
 * ---------------------------------------------------------------------- */

/** One running piece of work. Never edited by hand — only by `apply()`. */
export interface Flow {
  id: string;
  kind: FlowKind;
  /** Patient id, batch reference, case number. */
  subjectId: string;
  /** How a person refers to it: "Meera R.", "STER-0914". */
  subjectLabel: string;
  /** Which node is held now. */
  at: number;
  /** When the current node was handed over. Lateness is measured from here. */
  heldSince: number;
  done: boolean;
  history: ReadonlyArray<{ node: string; owner: RoleCode; completedAt: number }>;
}

export interface RecordedEvent {
  seq: number;
  type: ClinicEvent;
  subjectId: string;
  at: number;
  by: RoleCode;
}

export interface World {
  /** Clinic-local minutes since midnight. Injected, never read from a clock. */
  now: number;
  flows: readonly Flow[];
  /** Append-only. Nothing in this file removes or rewrites an entry. */
  events: readonly RecordedEvent[];
  /**
   * What governance is allowed to know. Deliberately opaque strings rather
   * than a typed record of requirements: nothing outside this module should
   * be able to reason about them, or they will end up on a screen.
   */
  facts: Readonly<Record<string, boolean>>;
  metrics: Readonly<{
    seen: number;
    collected: number;
    waits: readonly number[];
  }>;
  /**
   * The clinic's operatories, from its master.
   *
   * Master data rather than event data: an operatory exists because the
   * clinic has one, not because something happened to it. It lives in the
   * world so that governance can refuse `ROOMS_READY` for a room nobody has
   * prepared — a rule that cannot be written without knowing which rooms
   * there are.
   *
   * Empty is not "no rooms to worry about". It is an unconfigured clinic,
   * and `readiness()` says so rather than passing.
   */
  operatories: readonly Operatory[];
  /**
   * The minute the first patient is due, from the day's schedule — the target
   * readiness is measured against.
   *
   * **Null when nothing is booked, and null is not a default hour.** The
   * working agreement is explicit: *"Never imply a state you do not have —
   * absent appointment data is not a guessed first-patient time."* A
   * placeholder here would put a made-up deadline on somebody's morning and
   * report a variance against it, which is worse than reporting nothing.
   */
  firstPatientAt: number | null;
}

export const emptyWorld = (
  now: number,
  setup: { operatories?: readonly Operatory[]; firstPatientAt?: number | null } = {},
): World => ({
  now, flows: [], events: [], facts: {}, metrics: { seen: 0, collected: 0, waits: [] },
  operatories: setup.operatories ?? [],
  firstPatientAt: setup.firstPatientAt ?? null,
});

/* -------------------------------------------------------------------------
 * Consequences — the fan-out, as data
 * ---------------------------------------------------------------------- */

/**
 * What one event caused.
 *
 * Returned rather than performed, so that "one event, ten consequences" is
 * something a test can count instead of something a comment claims. A
 * notification engine, an audit writer and a metrics store each consume this
 * list; none of them is wired in here, because an engine that sends email is
 * an engine that cannot be tested at 10:14.
 */
export type Consequence =
  | { kind: 'FLOW_STARTED'; flowKind: FlowKind; subjectLabel: string; owner: RoleCode }
  | { kind: 'NODE_COMPLETED'; flowKind: FlowKind; node: string; by: RoleCode; label: string }
  | { kind: 'OWNERSHIP_MOVED'; from: RoleCode; to: RoleCode; node: string; subjectLabel: string }
  | { kind: 'FLOW_COMPLETED'; flowKind: FlowKind; subjectLabel: string }
  | { kind: 'NOTIFY'; role: RoleCode; message: string }
  | { kind: 'METRIC'; name: 'seen' | 'collected' | 'waited'; value: number }
  | { kind: 'AUDIT'; line: string };

/** Governance's only output: one reason, one way out. Never a list. */
export interface Refusal {
  /** What the person is told. No jargon, no rule id, no requirement name. */
  because: string;
  /** The single button. */
  fix: string;
  /** Where that button goes. */
  goes: string;
}

/**
 * Named EventOutcome rather than Outcome: management-scores.ts already owns
 * that word for a KPI verdict, and two different Outcomes in one contracts
 * package is how the wrong one gets imported at three in the morning.
 */
export type EventOutcome =
  | { ok: true; world: World; consequences: readonly Consequence[] }
  | { ok: false; refusal: Refusal };

/* -------------------------------------------------------------------------
 * GOVERNANCE — invisible, and the only thing that can refuse an event
 * ---------------------------------------------------------------------- */

interface Requirement {
  holds: (w: World, subjectId: string, by: RoleCode | null) => boolean;
  /**
   * The one sentence the person is told.
   *
   * A function where the sentence depends on the world — readiness has to say
   * *which* operatory is outstanding, and "3 items remain" tells somebody they
   * are blocked without telling them by what.
   */
  because: string | ((w: World) => string);
  fix: string;
  goes: string;
}

const req = (
  holds: Requirement['holds'], because: Requirement['because'], fix: string, goes: string,
): Requirement => ({ holds, because, fix, goes });

/**
 * Only the person whose job it is may report it done.
 *
 * Found live, and worth writing down: the dental assistant recorded
 * `COMMON_AREAS_READY` — housekeeping's floors — and the clinic accepted it,
 * because `record()` had never compared the recording role against the role
 * that owns the work. A readiness report is somebody's word that they did a
 * thing; taken from the wrong person it is worth nothing, and worse, it turns
 * the readiness calculation into a formality.
 *
 * `SENIOR_ASSISTANT` counts as an assistant here, and nowhere else — a senior
 * assistant preparing an operatory is the same act. It deliberately does not
 * extend to releasing a batch, which stays a separation-of-duties gate held by
 * the shape of the sterilisation flow.
 */
const onlyBy = (...roles: readonly RoleCode[]): Requirement['holds'] =>
  (_w, _id, by) => by === null || roles.includes(by);

const mine = (label: string, ...roles: readonly RoleCode[]): Requirement =>
  req(onlyBy(...roles), `${label} is not your part of the morning`,
    'Open clinic readiness', 'Readiness');

const RULES: Partial<Record<ClinicEvent, readonly Requirement[]>> = {
  [ClinicEvent.OPERATORY_READY]: [
    mine('Preparing an operatory', RoleCode.DENTAL_ASSISTANT, RoleCode.SENIOR_ASSISTANT),
  ],
  // "Equipment round is to be done by head dental nurse or Head dental
  // assistant" — narrower than the other assistant work on purpose, and the
  // one block a dental assistant may not report.
  [ClinicEvent.EQUIPMENT_VERIFIED]: [
    mine('The equipment round', RoleCode.SENIOR_ASSISTANT),
  ],
  [ClinicEvent.STOCK_VERIFIED]: [
    mine('Verifying the stock', RoleCode.DENTAL_ASSISTANT, RoleCode.SENIOR_ASSISTANT),
  ],
  [ClinicEvent.RECEPTION_READY]: [
    mine('Readying the waiting area', RoleCode.RECEPTION),
  ],
  [ClinicEvent.COMMON_AREAS_READY]: [
    mine('Cleaning the floors and shared areas', RoleCode.HOUSEKEEPING),
  ],
  /**
   * The clinic is ready when the morning has been done, not when somebody
   * says so.
   *
   * The activity matrix: *"The staff should not manually tick 'Clinic Ready.'
   * KuBi calculates it: Clinic Ready = all mandatory opening controls
   * passed."* Before the owner's opening procedure arrived, `ROOMS_READY` was
   * a single button an assistant pressed at the end of a checklist nobody
   * checked. It is now refused until every operatory in the master has been
   * prepared, the sterilisation run has been released, equipment and stock
   * have been verified, and reception and the shared areas have been done.
   *
   * The refusal carries the block's own sentence, so the assistant is told
   * *which* room is outstanding rather than that a count is non-zero.
   */
  [ClinicEvent.ROOMS_READY]: [
    req((w) => readiness(w.events, w.operatories, w.firstPatientAt, w.now).ready,
      (w) => whyNotReady(readiness(w.events, w.operatories, w.firstPatientAt, w.now))
        ?? 'The morning is not finished yet',
      'Open clinic readiness', 'Readiness'),
  ],
  [ClinicEvent.PATIENT_SEATED]: [
    req((w) => w.facts.rooms === true,
      'The rooms are not ready yet', 'Open room readiness', 'Operations'),
    req((w) => w.facts.sterile === true,
      'No sterile pack has been released today', 'Open sterilisation', 'Operations'),
  ],
  [ClinicEvent.TREATMENT_FINISHED]: [
    req((w, id) => w.facts[`history:${id}`] === true,
      'The medical history has not been updated', 'Update medical history', 'Clinical'),
    req((w, id) => w.facts[`consent:${id}`] === true,
      'There is no signed consent for this procedure', 'Open consent form', 'Clinical'),
    req((w, id) => w.facts[`xray:${id}`] === true,
      'The radiograph this treatment needs is not on file', 'Attach radiograph', 'Clinical'),
  ],
  [ClinicEvent.LAB_APPOINTMENT_GIVEN]: [
    req((w, id) => w.facts[`qc:${id}`] === true,
      'This case has not passed the doctor’s check', 'Open the case', 'Operations'),
  ],
  [ClinicEvent.CLINIC_LOCKED]: [
    /**
     * The clinical record, and the correction that put it here.
     *
     * The owner: *"A bill being financially important does not mean a clinical
     * note can safely be left incomplete… verify that objective ranking is not
     * accidentally being used to override mandatory clinical closure
     * dependencies."*
     *
     * It was. The clinic could lock up at 19:30 with a treatment recorded and
     * no note written, because RECORDS_COMPLETE ranks seventh and nothing
     * turned that ranking into a requirement. Two different things had been
     * conflated:
     *
     *   **operational priority** — what a person should do first. Objective
     *     rank, and only that. It orders a list.
     *   **closure dependency** — what must exist before the day may end.
     *     Governance, and only that. It refuses.
     *
     * A low rank must never imply "optional". The note is the last thing
     * anybody should be interrupted for and the day still cannot end without
     * it, and those two statements are not in tension — they are made by
     * different mechanisms, which is the point.
     *
     * Deliberately keyed on the note itself rather than on the CLINICAL flow
     * being finished: that flow's second node is tomorrow's follow-up call,
     * and refusing to close today until tomorrow's call has happened would be
     * absurd.
     */
    req((w) => !w.flows.some((f) => f.kind === FlowKind.CLINICAL && !f.done
      && !f.history.some((h) => h.node === 'NOTES')),
      'A clinical note has not been completed', 'Open the clinical record', 'Clinical'),
    req((w) => !w.flows.some((f) => f.kind === FlowKind.STERILIZATION && !f.done),
      'Instruments are still in the loop', 'Open sterilisation', 'Operations'),
    req((w) => !w.flows.some((f) => f.kind === FlowKind.PATIENT && !f.done),
      'A visit has not been finished', 'Open the board', 'Board'),
  ],
};

/**
 * May this event be recorded?
 *
 * Absence of an answer refuses exactly as hard as a wrong one — an unset fact
 * is not a satisfied one. That is ADR-013's rule with the jargon removed:
 * UNKNOWN is never PASS.
 */
/**
 * `by` is the role recording it, and it is optional on purpose.
 *
 * `decisions()` asks *"could this be recorded?"* about work that already has
 * an owner, so it passes nothing and the ownership rules stand aside — a
 * decision on the assistant's list must not read BLOCKED because the question
 * was asked without a name attached. `record()` always passes it, which is
 * where the enforcement actually happens.
 */
export function admit(
  w: World, type: ClinicEvent, subjectId: string, by: RoleCode | null = null,
): Refusal | null {
  for (const r of RULES[type] ?? []) {
    if (!r.holds(w, subjectId, by)) {
      const because = typeof r.because === 'function' ? r.because(w) : r.because;
      return { because, fix: r.fix, goes: r.goes };
    }
  }
  return null;
}

/* -------------------------------------------------------------------------
 * WORKFLOW — the only thing that moves work
 * ---------------------------------------------------------------------- */

const nodeAt = (kind: FlowKind, i: number): FlowNode | undefined => FLOWS[kind].nodes[i];

/** Who holds this flow right now, or null once it is finished. */
export function ownerOf(f: Flow): RoleCode | null {
  return f.done ? null : (nodeAt(f.kind, f.at)?.owner ?? null);
}

/** Minutes past the moment this node should have been finished. 0 if not late. */
export function lateness(f: Flow, now: number): number {
  if (f.done) return 0;
  const nd = nodeAt(f.kind, f.at);
  if (!nd) return 0;
  return Math.max(0, now - (f.heldSince + nd.expectMinutes));
}

/**
 * Record an event and let it fan out.
 *
 * This is the entire write path. There is no other way to change a flow, which
 * is what the owner meant by *"nobody manually changes the patient phase"* —
 * there is no phase to set. It is derived from which node the event completed.
 */
export function record(
  w: World,
  ev: { type: ClinicEvent; subjectId: string; subjectLabel?: string; by: RoleCode },
): EventOutcome {
  const refusal = admit(w, ev.type, ev.subjectId, ev.by);
  if (refusal) return { ok: false, refusal };

  const out: Consequence[] = [];
  const now = w.now;
  const flows = [...w.flows];
  let facts = { ...w.facts };
  let metrics = { ...w.metrics };

  const label = ev.subjectLabel
    ?? flows.find((f) => f.subjectId === ev.subjectId)?.subjectLabel
    ?? ev.subjectId;

  /** Open a flow, and say who now holds its first node. */
  const open = (kind: FlowKind, from = 0) => {
    const first = nodeAt(kind, from)!;
    flows.push({
      id: `${kind}:${ev.subjectId}:${flows.length}`,
      kind, subjectId: ev.subjectId, subjectLabel: label,
      at: from, heldSince: now, done: false, history: [],
    });
    out.push({ kind: 'FLOW_STARTED', flowKind: kind, subjectLabel: label, owner: first.owner });
    out.push({ kind: 'NOTIFY', role: first.owner, message: `${first.label} — ${label}` });
  };

  // ── the event engine: does this start something, or advance something? ──
  const starts = STARTS.get(ev.type);
  const target = COMPLETES.get(ev.type);

  if (starts && !flows.some((f) => f.kind === starts && f.subjectId === ev.subjectId && !f.done)) {
    open(starts);
  }

  if (target) {
    const i = flows.findIndex(
      (f) => f.kind === target.kind && f.subjectId === ev.subjectId
        && !f.done && f.at === target.index,
    );
    if (i >= 0) {
      const f = flows[i]!;
      const nd = nodeAt(f.kind, f.at)!;
      const held = now - f.heldSince;

      out.push({ kind: 'NODE_COMPLETED', flowKind: f.kind, node: nd.id, by: ev.by, label: nd.label });

      // The waiting-room clock the owner called out by name.
      if (nd.id === 'SEAT') {
        metrics = { ...metrics, waits: [...metrics.waits, held] };
        out.push({ kind: 'METRIC', name: 'waited', value: held });
      }

      const next = nodeAt(f.kind, f.at + 1);
      const history = [...f.history, { node: nd.id, owner: nd.owner, completedAt: now }];

      if (next) {
        flows[i] = { ...f, at: f.at + 1, heldSince: now, history };
        // Ownership transfer. Nobody performs this; it is a consequence of the
        // event, which is why it cannot be skipped, delayed or forgotten.
        if (next.owner !== nd.owner) {
          out.push({
            kind: 'OWNERSHIP_MOVED', from: nd.owner, to: next.owner,
            node: next.id, subjectLabel: label,
          });
        }
        out.push({ kind: 'NOTIFY', role: next.owner, message: `${next.label} — ${label}` });
      } else {
        flows[i] = { ...f, done: true, history };
        out.push({ kind: 'FLOW_COMPLETED', flowKind: f.kind, subjectLabel: label });
        if (f.kind === FlowKind.PATIENT) {
          metrics = { ...metrics, seen: metrics.seen + 1 };
          out.push({ kind: 'METRIC', name: 'seen', value: metrics.seen });
        }
      }
    }
  }

  // ── flows this event opens elsewhere ──────────────────────────────────
  for (const kind of OPENS.get(ev.type) ?? []) {
    if (!flows.some((f) => f.kind === kind && f.subjectId === ev.subjectId && !f.done)) open(kind);
  }

  // ── facts governance will read later. Set by events, never by a screen. ──
  const setFact: Partial<Record<ClinicEvent, string>> = {
    [ClinicEvent.ROOMS_READY]: 'rooms',
    [ClinicEvent.BATCH_RELEASED]: 'sterile',
    [ClinicEvent.CONSENT_SIGNED]: `consent:${ev.subjectId}`,
    [ClinicEvent.DIAGNOSIS_RECORDED]: `history:${ev.subjectId}`,
    [ClinicEvent.LAB_QC_PASSED]: `qc:${ev.subjectId}`,
  };
  const key = setFact[ev.type];
  if (key) facts = { ...facts, [key]: true };

  if (ev.type === ClinicEvent.PAYMENT_RECEIVED || ev.type === ClinicEvent.INVOICE_SETTLED) {
    metrics = { ...metrics, collected: metrics.collected + 1 };
    out.push({ kind: 'METRIC', name: 'collected', value: metrics.collected });
  }

  out.push({ kind: 'AUDIT', line: `${ev.type} · ${label} · by ${ev.by}` });

  return {
    ok: true,
    consequences: out,
    world: {
      // Spread first so master data — the operatories, the first appointment —
      // survives an event. Listing fields by hand is how a new one silently
      // stops existing the moment anybody records anything.
      ...w,
      now, flows, facts, metrics,
      events: [...w.events, {
        seq: w.events.length + 1, type: ev.type, subjectId: ev.subjectId, at: now, by: ev.by,
      }],
    },
  };
}

/* -------------------------------------------------------------------------
 * TIME — the engine thinking while nobody is pressing anything
 * ---------------------------------------------------------------------- */

export interface Alert {
  flowId: string;
  subjectLabel: string;
  node: string;
  /** Whose work it still is. */
  owner: RoleCode;
  /** Who has now been told about it. */
  escalatedTo: RoleCode;
  minutesLate: number;
  /** One sentence, in the words the recipient would use. */
  message: string;
}

/**
 * Advance the clock and see what has gone late.
 *
 * Pure: same world and same instant in, same alerts out. Nothing is sent from
 * here — the caller decides what a notification means on its platform. What
 * matters is that a patient waiting sixteen minutes appears on the manager's
 * screen without anybody having opened the app.
 */
export function sweep(w: World, now: number): { world: World; alerts: readonly Alert[] } {
  const alerts: Alert[] = [];
  for (const f of w.flows) {
    if (f.done) continue;
    const nd = nodeAt(f.kind, f.at);
    if (!nd) continue;
    const late = Math.max(0, now - (f.heldSince + nd.expectMinutes));
    if (late <= 0) continue;
    alerts.push({
      flowId: f.id,
      subjectLabel: f.subjectLabel,
      node: nd.id,
      owner: nd.owner,
      escalatedTo: nd.escalateTo,
      minutesLate: late,
      message: `${nd.label} — ${f.subjectLabel} — ${late} min over`,
    });
  }
  alerts.sort((a, b) => b.minutesLate - a.minutesLate);
  return { world: { ...w, now }, alerts };
}

/* -------------------------------------------------------------------------
 * ROLE — the same world, eight different clinics
 * ---------------------------------------------------------------------- */

export interface DeskItem {
  flowId: string;
  flowKind: FlowKind;
  subjectLabel: string;
  /** What this person is doing, in their words. */
  label: string;
  /** The event recording it done. The screen shows this as one plain action. */
  completedBy: ClinicEvent;
  minutesHeld: number;
  minutesLate: number;
}

export interface Desk {
  role: RoleCode;
  /** Work this role holds now, worst first. */
  mine: readonly DeskItem[];
  /** Late work somebody else holds that this role has been told about. */
  escalated: readonly Alert[];
}

/**
 * What one role sees.
 *
 * The owner: *"Same database. Different operating systems."* Nothing is
 * filtered out for tidiness — a role simply has no view of work it does not
 * hold and has not been escalated. Reception cannot see the doctor's queue
 * because reception does not own any of it.
 */
export function deskOf(w: World, role: RoleCode, now: number): Desk {
  const mine: DeskItem[] = [];
  for (const f of w.flows) {
    if (f.done) continue;
    const nd = nodeAt(f.kind, f.at);
    if (!nd || nd.owner !== role) continue;
    mine.push({
      flowId: f.id,
      flowKind: f.kind,
      subjectLabel: f.subjectLabel,
      label: nd.label,
      completedBy: nd.completedBy,
      minutesHeld: Math.max(0, now - f.heldSince),
      minutesLate: lateness(f, now),
    });
  }
  mine.sort((a, b) => b.minutesLate - a.minutesLate || b.minutesHeld - a.minutesHeld);

  const escalated = sweep(w, now).alerts.filter((a) => a.escalatedTo === role && a.owner !== role);
  return { role, mine, escalated };
}

/* -------------------------------------------------------------------------
 * THE BOARD — every patient, moving on their own
 * ---------------------------------------------------------------------- */

export interface BoardLane {
  node: string;
  label: string;
  owner: RoleCode;
  patients: ReadonlyArray<{ subjectLabel: string; minutesHeld: number; minutesLate: number }>;
}

/**
 * The lanes are the patient flow's own nodes.
 *
 * Deliberately derived rather than declared. A board with its own list of
 * columns is a board that drifts out of step with the workflow the day after
 * somebody adds a step — and then it is showing a clinic that does not exist.
 */
export function board(w: World, now: number): readonly BoardLane[] {
  return FLOWS[FlowKind.PATIENT].nodes.map((nd, i) => ({
    node: nd.id,
    label: nd.label,
    owner: nd.owner,
    patients: w.flows
      .filter((f) => f.kind === FlowKind.PATIENT && !f.done && f.at === i)
      .map((f) => ({
        subjectLabel: f.subjectLabel,
        minutesHeld: Math.max(0, now - f.heldSince),
        minutesLate: lateness(f, now),
      })),
  }));
}
