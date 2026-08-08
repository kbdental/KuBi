/**
 * The decision engine. Specification §12.
 *
 * *"KuBi should never be built around Flows. It should be built around
 * Decisions."*
 *
 * This is that sentence as a function. Everything else in the model — events,
 * flows, ownership, time, governance, objectives — exists to produce, evaluate
 * or order the list this returns. Every screen will render a slice of it and
 * compute nothing.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * The four questions, every minute
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   What decision must be made?     every open node, and every open exception
 *   Who should make it?             the node's owner role
 *   Is enough information there?    governance, and what it is missing
 *   Then: proceed · wait · escalate
 *
 * ─────────────────────────────────────────────────────────────────────────
 * What this deliberately does not do
 * ─────────────────────────────────────────────────────────────────────────
 *
 * It does not reorder itself to be encouraging. When the most serious thing a
 * person owns is blocked, the blocked thing is still first — the alternative
 * is a list that puts a tickable item above an unsafe one because the tickable
 * one feels like progress.
 *
 * Pure: `(world, now) => Decision[]`. No clock, no database, no I/O.
 */
import type { RoleCode } from './enums.js';
import { rank, OBJECTIVE_WORD, type Objective } from './objectives.js';
import { ClinicEvent, FlowKind, FLOWS } from './operating-model.js';
import { readiness, type ReadinessBlock } from './readiness.js';
import { closing, type ClosingBlock } from './closing.js';
import { admit, lateness, type World, type Flow } from './engine.js';

/* -------------------------------------------------------------------------
 * A decision
 * ---------------------------------------------------------------------- */

export const Verdict = {
  /** The person can act now. */
  PROCEED: 'PROCEED',
  /** Nothing is wrong; something they do not control is not ready yet. */
  WAIT: 'WAIT',
  /** Overdue. Still theirs (§7 rule 4); somebody else has now been told. */
  ESCALATE: 'ESCALATE',
  /** Would be unsafe or non-compliant. One reason, one fix. */
  BLOCKED: 'BLOCKED',
} as const;
export type Verdict = (typeof Verdict)[keyof typeof Verdict];

export interface Decision {
  /** Stable while the decision stays open, so a screen can keep its place. */
  id: string;
  /** The question, in the words the owner would use. */
  question: string;
  owner: RoleCode;
  objective: Objective;
  /** Its rank (§2.1). 1 is most important. */
  priority: number;

  verdict: Verdict;
  /** Only when not PROCEED. One sentence, no jargon. */
  because: string | null;
  /** Only when not PROCEED. One action. */
  fix: string | null;
  /** Where that action goes. */
  goes: string | null;

  /** Minutes since this landed on them, and minutes past when it should be done. */
  heldFor: number;
  lateBy: number;

  /* ---- decision quality, §13.4 ---------------------------------------- */
  /** Why this, now. */
  why: string;
  /** What the system is going by: the events that produced it. */
  evidence: readonly number[];
  /** What says so. */
  protocol: string;
  /** What happens if nobody acts. */
  ifIgnored: string;

  /* ---- provenance, for the UI to trace back ---------------------------- */
  flowId: string;
  flowKind: FlowKind;
  subjectId: string;
  subjectLabel: string;
  node: string;
  /** The event that would close it. The screen shows this as one plain action. */
  completedBy: ClinicEvent;
}

/* -------------------------------------------------------------------------
 * Building one
 * ---------------------------------------------------------------------- */

/** The question a person would actually ask about this piece of work. */
function questionFor(label: string, subject: string): string {
  return `${label} — ${subject}`;
}

function decisionFor(w: World, f: Flow, now: number): Decision | null {
  const def = FLOWS[f.kind];
  const nd = def.nodes[f.at];
  if (!nd || f.done) return null;

  const heldFor = Math.max(0, now - f.heldSince);
  const lateBy = lateness(f, now);

  // Governance first. A blocked decision is blocked however late it is —
  // lateness never argues a safety requirement away.
  const refusal = admit(w, nd.completedBy, f.subjectId);

  const verdict: Verdict = refusal
    ? Verdict.BLOCKED
    : lateBy > 0
      ? Verdict.ESCALATE
      : Verdict.PROCEED;

  // The evidence: the events that brought this flow to where it is. Sequence
  // numbers rather than prose, so a person can be shown the actual record
  // rather than a summary somebody wrote.
  const evidence = w.events
    .filter((e) => e.subjectId === f.subjectId)
    .map((e) => e.seq);

  return {
    id: `${f.id}#${nd.id}`,
    question: questionFor(nd.label, f.subjectLabel),
    owner: nd.owner,
    objective: nd.objective,
    priority: rank(nd.objective),

    verdict,
    because: refusal ? refusal.because : null,
    fix: refusal ? refusal.fix : null,
    goes: refusal ? refusal.goes : null,

    heldFor,
    lateBy,

    why: `This is about ${OBJECTIVE_WORD[nd.objective]}.`,
    evidence,
    protocol: `${def.label} · ${nd.id}`,
    ifIgnored: lateBy > 0
      ? `${lateBy} min over. The ${role(nd.escalateTo)} has been told.`
      : `Due in ${Math.max(0, nd.expectMinutes - heldFor)} min, then the ${role(nd.escalateTo)} is told.`,

    flowId: f.id,
    flowKind: f.kind,
    subjectId: f.subjectId,
    subjectLabel: f.subjectLabel,
    node: nd.id,
    completedBy: nd.completedBy,
  };
}

const role = (r: RoleCode) => String(r).replace(/_/g, ' ').toLowerCase();

/* -------------------------------------------------------------------------
 * The morning
 * ---------------------------------------------------------------------- */

/**
 * One outstanding piece of the opening, as a decision.
 *
 * Readiness blocks are not flow nodes and deliberately never became any: the
 * morning is four operatories in parallel, not a queue, and modelling it as a
 * chain would invent an order the clinic does not work in. They surface here
 * so that an assistant at 08:46 is told *"Prepare Operatory 1"* rather than
 * being shown one summary item she cannot act on.
 *
 * Lateness is measured against the first appointment, because that is the only
 * deadline the opening procedure actually states — everything in it is due
 * *"before first patient"*.
 */
function readinessDecision(
  w: World, b: ReadinessBlock, unlock: { seq: number; at: number }, now: number,
): Decision {
  // Late against the first appointment, which is the only deadline the
  // opening procedure states. With nothing booked there is no deadline, so
  // the work is not late — it is simply not yet done.
  const lateBy = w.firstPatientAt === null ? 0 : Math.max(0, now - w.firstPatientAt);
  const heldFor = Math.max(0, now - unlock.at);
  const subjectId = b.subjectId ?? 'today';

  // What the system is going by: the clinic was unlocked, and nothing has
  // been recorded about this block since. The unlock is always part of it —
  // it is what put the morning on anybody at all, and a decision that can
  // show no record of why it exists is one a person is entitled to distrust.
  const evidence = [
    unlock.seq,
    ...w.events.filter((e) => e.subjectId === subjectId && e.seq !== unlock.seq)
      .map((e) => e.seq),
  ];

  return {
    id: `READINESS#${b.id}`,
    question: b.label,
    owner: b.owner,
    objective: b.objective,
    priority: rank(b.objective),

    // A readiness block has nothing gating it — it is the work, and the work
    // can always be started. What it gates is `ROOMS_READY`.
    verdict: lateBy > 0 ? Verdict.ESCALATE : Verdict.PROCEED,
    because: null,
    fix: null,
    goes: null,

    heldFor,
    lateBy,

    why: `This is about ${OBJECTIVE_WORD[b.objective]}.`,
    evidence,
    protocol: `Opening readiness · ${b.id}`,
    ifIgnored: lateBy > 0
      ? `The first patient was due ${lateBy} min ago. ${b.ifOutstanding}.`
      : w.firstPatientAt === null
        ? `Nobody is booked yet. ${b.ifOutstanding}.`
        : `Due before the first patient, in ${w.firstPatientAt - now} min. ${b.ifOutstanding}.`,

    flowId: 'READINESS',
    flowKind: FlowKind.CLINIC,
    subjectId,
    subjectLabel: b.label,
    node: b.id,
    completedBy: b.completedBy,
  };
}

/**
 * One outstanding piece of the closing drill, as a decision.
 *
 * Appears only once the last patient has left. Before that the evening has not
 * started, and putting "close down Operatory 2" in front of an assistant at
 * two in the afternoon is a to-do list rather than a clinic.
 *
 * No lateness: the owner has not given a lock-up time, so there is no deadline
 * to be late against. A made-up one would be the readiness-target mistake all
 * over again.
 */
function closingDecision(w: World, b: ClosingBlock, expectedCloseAt: number | null, now: number): Decision {
  const subjectId = b.subjectId ?? 'today';
  // The drill takes thirty minutes from the moment the clinic shuts, so there
  // is a time the team should be out by and work can genuinely be late
  // against it. With no shut time there is no such moment, and the work is
  // simply not yet done.
  const lateBy = expectedCloseAt === null ? 0 : Math.max(0, now - expectedCloseAt);
  return {
    id: `CLOSING#${b.id}`,
    question: b.label,
    owner: b.owner,
    objective: b.objective,
    priority: rank(b.objective),

    verdict: lateBy > 0 ? Verdict.ESCALATE : Verdict.PROCEED,
    because: null,
    fix: null,
    goes: null,

    heldFor: w.shutAt === null ? 0 : Math.max(0, now - w.shutAt),
    lateBy,

    why: `This is about ${OBJECTIVE_WORD[b.objective]}.`,
    evidence: w.events.filter((e) => e.subjectId === subjectId).map((e) => e.seq),
    protocol: `Closing drill · ${b.id}`,
    ifIgnored: lateBy > 0
      ? `${lateBy} min past when the team should have left. ${b.ifOutstanding}.`
      : b.critical
        ? `${b.ifOutstanding}. The day cannot be closed until it is.`
        : `${b.ifOutstanding}.`,

    flowId: 'CLOSING',
    flowKind: FlowKind.CLINIC,
    subjectId,
    subjectLabel: b.label,
    node: b.id,
    completedBy: b.completedBy,
  };
}

/* -------------------------------------------------------------------------
 * The list
 * ---------------------------------------------------------------------- */

/**
 * Ordered by: what it is for, then how late it is, then how long it has been
 * held.
 *
 * The objective comes first and nothing outranks it. A safety decision sits
 * above a billing decision that has been waiting four hours, because that is
 * what §2.1 says the clinic believes — and if it is ever wrong, it is wrong in
 * one line rather than scattered through a scheduler.
 */
export function decisions(w: World, now: number): Decision[] {
  const out: Decision[] = [];
  const r = readiness(w.events, w.operatories, w.firstPatientAt, now);

  for (const f of w.flows) {
    const d = decisionFor(w, f, now);
    if (!d) continue;
    // While the morning is outstanding, the `ROOMS` node is a summary of work
    // that is itself listed below — showing both would put a blocked item a
    // person cannot act on above the six things they can.
    if (!r.ready && d.flowKind === FlowKind.CLINIC && d.node === 'ROOMS') continue;
    out.push(d);
  }

  // Only once the clinic has been unlocked. Before that the morning has not
  // started, and a list of readiness work at 06:00 is a to-do list, not a
  // clinic.
  const unlocked = w.events.find((e) => e.type === ClinicEvent.CLINIC_UNLOCKED);
  if (unlocked && !r.ready) {
    for (const b of r.outstanding) out.push(readinessDecision(w, b, unlocked, now));
  }

  // The evening. Only once every visit is finished — the closing drill is what
  // happens after the last patient leaves, not something running alongside
  // them.
  // Either every visit is finished, or the clinic has shut. Both are real
  // starts: some evenings the last patient leaves early, and on others the
  // door closes at 18:30 with the drill still to do.
  const patientsDone = r.ready
    && w.flows.some((f) => f.kind === FlowKind.PATIENT)
    && !w.flows.some((f) => f.kind === FlowKind.PATIENT && !f.done);
  const shut = w.shutAt !== null && now >= w.shutAt;
  if (patientsDone || shut) {
    const c = closing(w.events, w.operatories, w.shutAt, now);
    for (const b of c.outstanding) out.push(closingDecision(w, b, c.expectedCloseAt, now));
  }

  return out.sort(
    (a, b) => a.priority - b.priority || b.lateBy - a.lateBy || b.heldFor - a.heldFor,
  );
}

/**
 * What one role sees — the whole of their clinic, and none of anybody else's.
 *
 * *"Same database. Different operating systems."* Reception is not shown a
 * filtered version of the doctor's queue; they own none of it, so none of it
 * is here.
 */
export function decisionsFor(w: World, who: RoleCode, now: number): Decision[] {
  return decisions(w, now).filter((d) => d.owner === who);
}

/**
 * Late work whose escalation role is this person — visible to them, and still
 * owned by somebody else.
 *
 * Escalation never reassigns (§7 rule 4). Moving the work would let the holder
 * off, and the manager's screen would slowly become everybody's to-do list.
 */
export function escalatedTo(w: World, who: RoleCode, now: number): Decision[] {
  return decisions(w, now).filter((d) => {
    const nd = FLOWS[d.flowKind].nodes.find((n) => n.id === d.node);
    return d.lateBy > 0 && nd?.escalateTo === who && d.owner !== who;
  });
}

/**
 * The single most important thing in the clinic right now, or null.
 *
 * The command centre's top line, and the answer to *"what does the clinic need
 * to do RIGHT NOW?"*. Null when there is genuinely nothing open, which is a
 * real state and must not be dressed up as an achievement.
 */
export function mostImportant(w: World, now: number): Decision | null {
  return decisions(w, now)[0] ?? null;
}
