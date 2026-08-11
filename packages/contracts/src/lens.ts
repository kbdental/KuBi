/**
 * What is failing, who is involved, and who is allowed to see it.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * The two things the owner asked for
 * ─────────────────────────────────────────────────────────────────────────
 *
 * *"I want this as an operational app where on the dashboard I see the
 * attendance, the clinic readiness health with the failing parameters and who
 * is involved in the failing parameters."*
 *
 * *"All the task should not be seen by all, only related, so that confusion
 * does not happen — so all the staff will have a different look of the app."*
 *
 * Those are one problem. A dashboard that shows everything to everybody is
 * exactly the thing that makes a manager unable to find the failure and a
 * housekeeper unable to find her floors. So this file produces **one list of
 * failing parameters**, each carrying the role that owns it and the people who
 * hold that role today — and then **narrows it by who is looking**.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Why the filtering is here and not in the screen
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Constitution rule 3: a UI check is a courtesy. If the assistant's tablet
 * receives the whole clinic's failures and hides most of them, then the whole
 * clinic's failures are on the assistant's tablet — one inspector's console
 * away from being read. `lensFor()` decides what leaves the server, so the
 * screen renders what it is given rather than choosing what to conceal.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Roles rule, and people are still named
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The owner's earlier instruction stands — *"do not put a name to anything,
 * keep it role wise"* — and it governs every **rule**: ownership, permission
 * and gate are all written against a role, always. But *"who is involved in
 * the failing parameters"* is a different question, and it has a person's name
 * as its answer. A manager who is told "the sterilisation run has no owner"
 * cannot act; a manager told "Rahul is on approved leave and nobody is
 * covering" picks up the phone.
 *
 * So: the rule names the role, and the dashboard names whoever is holding it
 * today. Those are not in conflict — one is the standard, the other is the
 * roster.
 */
import { RoleCode } from './enums.js';
import type { AttendanceView } from './attendance.js';
import type { Readiness } from './readiness.js';
import type { Closing } from './closing.js';
import type { Compliance } from './compliance.js';
import type { EquipmentView, RoomLinkage } from './equipment.js';
import { ItemVerdict, type EmergencyReadiness } from './emergency.js';
import type { InventoryView } from './inventory.js';

/* -------------------------------------------------------------------------
 * A failing parameter
 * ---------------------------------------------------------------------- */

/** Which engine produced it, so the dashboard can group without guessing. */
export const FailureArea = {
  ATTENDANCE: 'ATTENDANCE',
  READINESS: 'READINESS',
  PATIENT: 'PATIENT',
  EQUIPMENT: 'EQUIPMENT',
  STOCK: 'STOCK',
  CLOSING: 'CLOSING',
} as const;
export type FailureArea = (typeof FailureArea)[keyof typeof FailureArea];

export const AREA_LABEL: Readonly<Record<FailureArea, string>> = {
  ATTENDANCE: 'Staffing',
  READINESS: 'Clinic readiness',
  PATIENT: 'Patients today',
  EQUIPMENT: 'Equipment',
  STOCK: 'Stock',
  CLOSING: 'Closing',
};

/**
 * How badly it matters, and therefore what it interrupts.
 *
 * Three levels rather than five: a manager scanning at 09:15 can hold three
 * distinctions in their head, and the fourth is where people stop reading.
 */
export const FailureSeverity = {
  /** The clinic cannot do the work. Nothing else on the list matters first. */
  STOPS: 'STOPS',
  /** Somebody will be held up, or a standard is already broken. */
  HOLDS: 'HOLDS',
  /** Real, and the day continues around it. */
  WATCH: 'WATCH',
} as const;
export type FailureSeverity = (typeof FailureSeverity)[keyof typeof FailureSeverity];

/** One person, and what the clinic knows about them today. */
export interface Involved {
  employeeCode: string;
  label: string;
  /** PRESENT, LATE, ON_LEAVE, UNKNOWN… straight from the attendance engine. */
  state: string;
  /** Said plainly: "in at 09:20", "on approved leave, nobody covering". */
  note: string;
}

export interface FailingParameter {
  id: string;
  area: FailureArea;
  severity: FailureSeverity;
  /** The parameter, in the clinic's words. */
  what: string;
  /** Why it is failing, said to somebody who has to act. */
  because: string;
  /** The role that owns it. The rule; never a person. */
  ownerRole: RoleCode | null;
  /**
   * Who is holding that role today, and how they are.
   *
   * Empty is itself a finding — a failing parameter whose owning role has
   * nobody in the building is a different problem from one whose owner is
   * standing right there, and the dashboard has to be able to tell them apart.
   */
  involved: readonly Involved[];
  /** The minute it falls due, where it has one. */
  dueAt: number | null;
  /** Where a person would go to deal with it. */
  goes: string;
}

/* -------------------------------------------------------------------------
 * Who sees what
 * ---------------------------------------------------------------------- */

/**
 * Roles that see the whole clinic.
 *
 * Deliberately short. Everybody else sees their own work — not because their
 * work is less important, but because a housekeeper scrolling past an implant
 * component shortage learns to scroll past everything.
 */
export const CLINIC_WIDE_ROLES: readonly RoleCode[] = [
  RoleCode.OWNER_DIRECTOR,
  RoleCode.CLINIC_HEAD,
  RoleCode.CLINIC_MANAGER,
  RoleCode.QUALITY_COMPLIANCE,
];

export const seesWholeClinic = (role: RoleCode): boolean =>
  CLINIC_WIDE_ROLES.includes(role);

/**
 * Roles that stand in for another when work is assigned.
 *
 * A senior assistant sees the assistants' work because she may do it and is
 * accountable for it. It does not run the other way: an assistant does not see
 * the equipment round, which is the senior's alone.
 */
const STANDS_IN_FOR: Partial<Record<RoleCode, readonly RoleCode[]>> = {
  [RoleCode.SENIOR_ASSISTANT]: [RoleCode.DENTAL_ASSISTANT],
  [RoleCode.TREATING_DOCTOR]: [],
};

/** Whether `viewer` may act on work owned by `owner`. */
export function actsFor(viewer: RoleCode, owner: RoleCode | null): boolean {
  if (owner === null) return seesWholeClinic(viewer);
  if (viewer === owner) return true;
  return (STANDS_IN_FOR[viewer] ?? []).includes(owner);
}

/* -------------------------------------------------------------------------
 * The lens
 * ---------------------------------------------------------------------- */

export interface Lens {
  role: RoleCode;
  wholeClinic: boolean;
  /** What this person sees on the dashboard. */
  failing: readonly FailingParameter[];
  /** How many were withheld, so the count is honest rather than silently short. */
  hidden: number;
  /**
   * The one line at the top of their screen.
   *
   * Different question per role, on the design principle: a manager asks
   * "where is the clinic", an assistant asks "what do I owe".
   */
  question: string;
  headline: string;
}

const QUESTION: Partial<Record<RoleCode, string>> = {
  [RoleCode.OWNER_DIRECTOR]: 'Where is the clinic?',
  [RoleCode.CLINIC_HEAD]: 'Where is the clinic?',
  [RoleCode.CLINIC_MANAGER]: 'What is failing, and who is on it?',
  [RoleCode.QUALITY_COMPLIANCE]: 'What went wrong, and what changed because of it?',
  [RoleCode.TREATING_DOCTOR]: 'Who am I seeing, and can I start?',
  [RoleCode.RECEPTION]: 'Who is here, and who is next?',
  [RoleCode.SENIOR_ASSISTANT]: 'What is the clinic waiting on from us?',
  [RoleCode.DENTAL_ASSISTANT]: 'What do I owe before the next patient?',
  [RoleCode.STERILIZATION_TECHNICIAN]: 'What is in the loop, and what is due out?',
  [RoleCode.HOUSEKEEPING]: 'What is mine, and by when?',
  [RoleCode.LAB_COORDINATOR]: 'What is out at the laboratory, and what is due back?',
  [RoleCode.INVENTORY_COORDINATOR]: 'What is short, and what have I ordered?',
};

const RANK: Record<FailureSeverity, number> = { STOPS: 0, HOLDS: 1, WATCH: 2 };

/**
 * Narrow the clinic's failures to what this role should be looking at.
 *
 * The count of what was withheld is returned rather than dropped. An assistant
 * who sees "3 of 11" knows the clinic has other problems and that they are not
 * hers; an assistant who sees "3" thinks she is looking at everything.
 */
export function lensFor(
  role: RoleCode, all: readonly FailingParameter[],
): Lens {
  const wholeClinic = seesWholeClinic(role);
  const mine = wholeClinic ? all : all.filter((f) => actsFor(role, f.ownerRole));
  const sorted = [...mine].sort(worstFirst);

  return {
    role,
    wholeClinic,
    failing: sorted,
    hidden: all.length - mine.length,
    question: QUESTION[role] ?? 'What do I owe today?',
    headline: headlineFor(wholeClinic, sorted, all.length),
  };
}

function headlineFor(
  wholeClinic: boolean, mine: readonly FailingParameter[], total: number,
): string {
  if (mine.length === 0) {
    return wholeClinic
      ? (total === 0 ? 'Nothing is failing.' : 'Nothing is failing that is yours.')
      : 'Nothing outstanding for you.';
  }
  const worst = mine[0]!;
  const stops = mine.filter((f) => f.severity === FailureSeverity.STOPS).length;
  if (stops > 0) {
    return `${stops} thing${stops === 1 ? '' : 's'} stopping work. ${worst.what}.`;
  }
  return `${mine.length} outstanding. ${worst.what}.`;
}

/* -------------------------------------------------------------------------
 * Who is involved
 * ---------------------------------------------------------------------- */

/**
 * Attach the people currently holding a role to a failure that role owns.
 *
 * `holders` comes from the attendance engine. A role with nobody in the
 * building returns an empty list, and the caller must say so rather than
 * rendering a blank — "nobody is here to do this" is the most actionable
 * sentence on the dashboard.
 */
export function involvedIn(
  ownerRole: RoleCode | null,
  holders: ReadonlyMap<RoleCode, readonly Involved[]>,
): readonly Involved[] {
  if (ownerRole === null) return [];
  return holders.get(ownerRole) ?? [];
}

/** "Nobody is here" said properly, or the people who are. */
export function involvedWords(involved: readonly Involved[]): string {
  if (involved.length === 0) return 'Nobody is holding this role today.';
  return involved.map((p) => `${p.label} — ${p.note}`).join(' · ');
}

/* -------------------------------------------------------------------------
 * Gathering the clinic's failures into one list
 * ---------------------------------------------------------------------- */

/**
 * Everything the dashboard reads, in the shapes the engines already return.
 *
 * Deliberately all-optional. A clinic that has not started its evening has no
 * closing view, and a screen loaded before the stock import has no inventory —
 * and in neither case should the manager be shown a fabricated all-clear.
 * A missing engine contributes nothing rather than contributing a pass.
 */
export interface FailureInputs {
  attendance?: AttendanceView;
  readiness?: Readiness;
  compliance?: readonly Compliance[];
  equipment?: EquipmentView;
  inventory?: InventoryView;
  closing?: Closing;
  /** Which rooms may take a patient. See `roomAvailability`. */
  rooms?: RoomLinkage;
  /** OPEN-012. See `emergencyReadiness`. */
  emergency?: EmergencyReadiness;
  /** The minute now, for due-time wording. */
  now: number;
}

/**
 * Every failing parameter in the clinic, from every engine, in one list.
 *
 * This is the function behind *"on the dashboard I see the attendance, the
 * clinic readiness health with the failing parameters and who is involved."*
 * Three properties matter more than the contents:
 *
 * 1. **It derives.** Nothing here is a list somebody maintains. Fix the
 *    underlying fact and the row disappears on the next read, because the row
 *    never existed independently of the fact.
 * 2. **Every row has an owning role**, and therefore a set of people. A
 *    failure nobody owns is the worst kind, and `ownerRole: null` makes that
 *    visible rather than hiding it behind an unassigned queue.
 * 3. **Severity is about consequence, not about source.** A missing consent
 *    and a missing implant component are both STOPS, though one comes from the
 *    compliance engine and one from the shelf, because to the patient in the
 *    waiting room they are the same event.
 */
export function gatherFailures(
  input: FailureInputs,
  holders: ReadonlyMap<RoleCode, readonly Involved[]>,
): FailingParameter[] {
  const out: FailingParameter[] = [];
  const people = (role: RoleCode | null) => involvedIn(role, holders);

  /* ── Staffing ─────────────────────────────────────────────────────── */
  const a = input.attendance;
  if (a) {
    // A position nobody is holding outranks everything else in this file. No
    // amount of readiness ticking compensates for an empty chair.
    for (const gap of a.gaps) {
      out.push({
        id: `ATT:GAP:${gap.role}`,
        area: FailureArea.ATTENDANCE,
        severity: gap.critical ? FailureSeverity.STOPS : FailureSeverity.HOLDS,
        what: `Nobody is holding ${gap.owns}`,
        because: gap.because,
        ownerRole: gap.role,
        involved: people(gap.role),
        dueAt: gap.neededBy,
        goes: 'Clinic readiness → Staffing',
      });
    }

    // ATT-003. Louder than an absence, because an absence has been thought
    // about and this has not.
    for (const p of a.unaccounted) {
      out.push({
        id: `ATT:UNKNOWN:${p.employeeCode}`,
        area: FailureArea.ATTENDANCE,
        severity: FailureSeverity.HOLDS,
        what: `${p.label} is unaccounted for`,
        because: 'No attendance recorded and no absence classified — '
          + 'nobody has said where they are.',
        ownerRole: p.roles[0] ?? null,
        involved: [{
          employeeCode: p.employeeCode, label: p.label,
          state: p.state, note: p.headline,
        }],
        dueAt: p.dueIn,
        goes: 'Clinic readiness → Staffing',
      });
    }

    // ATT-002. Late is a fact; late with no reason is a control failure.
    for (const p of a.lateUnexplained) {
      out.push({
        id: `ATT:LATE:${p.employeeCode}`,
        area: FailureArea.ATTENDANCE,
        severity: p.lateForTheirWork ? FailureSeverity.HOLDS : FailureSeverity.WATCH,
        what: `${p.label} is ${p.lateBy} minutes late with no reason recorded`,
        because: p.lateForTheirWork
          ? `Their work had to start at ${hhmm(p.neededBy ?? p.dueIn)}, and ATT-002 `
            + 'asks for a reason on every late arrival.'
          : 'ATT-002 asks for a reason on every late arrival.',
        ownerRole: p.roles[0] ?? null,
        involved: [{
          employeeCode: p.employeeCode, label: p.label,
          state: p.state, note: p.headline,
        }],
        dueAt: p.dueIn,
        goes: 'Clinic readiness → Staffing',
      });
    }

    // ATT-007. Approved months ago, and still nobody's job today.
    for (const l of a.uncovered) {
      // The person on leave comes first, then whoever must find the cover.
      // A row that said only "nobody is holding Clinic manager" would be
      // answering a question nobody asked — the fact that matters is which
      // job is uncovered and who normally does it.
      const away = a.people.find((p) => p.employeeCode === l.employeeCode);
      out.push({
        id: `ATT:COVER:${l.employeeCode}`,
        area: FailureArea.ATTENDANCE,
        severity: FailureSeverity.STOPS,
        what: `${l.label} is on approved leave with nobody covering`,
        because: l.because,
        ownerRole: RoleCode.CLINIC_MANAGER,
        involved: [
          ...(away
            ? [{ employeeCode: away.employeeCode, label: away.label,
              state: away.state, note: `${l.kind.toLowerCase()} leave — ${away.headline}` }]
            : []),
          ...people(RoleCode.CLINIC_MANAGER),
        ],
        dueAt: null,
        goes: 'Clinic readiness → Staffing',
      });
    }
  }

  /* ── The morning ──────────────────────────────────────────────────── */
  const r = input.readiness;
  if (r) {
    for (const b of r.outstanding) {
      out.push({
        id: `OPEN:${b.id}`,
        area: FailureArea.READINESS,
        severity: FailureSeverity.STOPS,
        what: b.label,
        because: b.ifOutstanding,
        ownerRole: b.owner,
        involved: people(b.owner),
        dueAt: r.targetAt,
        goes: 'Clinic readiness',
      });
    }
    // Listed, real, and does not hold the door. Kept separate so that "what is
    // stopping us opening" and "what else is owed" are never one number.
    for (const b of r.advisory.filter((x) => !x.done)) {
      out.push({
        id: `OPEN:ADV:${b.id}`,
        area: FailureArea.READINESS,
        severity: FailureSeverity.WATCH,
        what: b.label,
        because: b.ifOutstanding,
        ownerRole: b.owner,
        involved: people(b.owner),
        dueAt: null,
        goes: 'Clinic readiness',
      });
    }
  }

  /* ── OPEN-012 · emergency readiness ───────────────────────────────── */
  //
  // Priority PS in the matrix, and it earns it. Everything else on this list
  // costs the clinic time; this one costs somebody their life, so it is one
  // row per failing item rather than one row for the kit — "the emergency kit
  // is not ready" sends nobody anywhere, and "Adrenaline: expired 12 days
  // ago" sends somebody to a cupboard.
  const em = input.emergency;
  if (em) {
    for (const r of em.stopping) {
      out.push({
        id: `EMG:${r.item.id}`,
        area: FailureArea.READINESS,
        severity: FailureSeverity.STOPS,
        what: `Emergency kit — ${r.item.name}`,
        because: `${r.because} For: ${r.item.forWhat}.`,
        ownerRole: RoleCode.DENTAL_ASSISTANT,
        involved: people(RoleCode.DENTAL_ASSISTANT),
        dueAt: null,
        goes: 'Clinic readiness → Emergency kit',
      });
    }
    // The signature, and only once the kit itself is whole. A clinic that is
    // safe and unsigned is a control failure; saying it in the same breath as
    // a missing drug would flatten a distinction that matters.
    if (em.state === 'AWAITING_VERIFICATION') {
      out.push({
        id: 'EMG:VERIFY',
        area: FailureArea.READINESS,
        severity: FailureSeverity.HOLDS,
        what: 'Emergency kit is not countersigned',
        because: em.verificationRefusedBecause
          ?? 'Checked and complete. OPEN-012 names the doctor as Checker, and '
            + 'the person who checked it may not sign it off.',
        ownerRole: RoleCode.TREATING_DOCTOR,
        involved: people(RoleCode.TREATING_DOCTOR),
        dueAt: null,
        goes: 'Clinic readiness → Emergency kit',
      });
    }
    // Two different things sit in `watch` and the row must not blur them. An
    // item running out of date is a reorder and belongs to whoever orders; a
    // non-critical item that is simply absent is a walk to the cupboard and
    // belongs to the assistant. "Spacer needs reordering" when the spacer is
    // missing sends the wrong person to the wrong place.
    for (const r of em.watch) {
      const expiring = r.verdict === ItemVerdict.EXPIRING;
      out.push({
        id: `EMG:SOON:${r.item.id}`,
        area: FailureArea.READINESS,
        severity: FailureSeverity.WATCH,
        what: expiring
          ? `Emergency kit — ${r.item.name} needs reordering`
          : `Emergency kit — ${r.item.name}`,
        because: r.because,
        ownerRole: expiring
          ? RoleCode.INVENTORY_COORDINATOR : RoleCode.DENTAL_ASSISTANT,
        involved: people(expiring
          ? RoleCode.INVENTORY_COORDINATOR : RoleCode.DENTAL_ASSISTANT),
        dueAt: null,
        goes: 'Clinic readiness → Emergency kit',
      });
    }
  }

  /* ── Patients booked today ────────────────────────────────────────── */
  for (const c of input.compliance ?? []) {
    // A breach is not a failing parameter to be chased — it is a thing that
    // already happened and cannot be undone. It is on the list because the
    // manager must know, and it is STOPS because it outranks anything still
    // preventable.
    if (c.breaches.length > 0) {
      out.push({
        id: `PAT:BREACH:${c.bookingId}`,
        area: FailureArea.PATIENT,
        severity: FailureSeverity.STOPS,
        what: `${c.patientLabel} — ${c.treatmentName} was delivered with `
          + `${c.breaches.length} requirement${c.breaches.length === 1 ? '' : 's'} unmet`,
        because: 'Recorded at the minute of delivery. A signature obtained '
          + 'afterwards does not clear it.',
        ownerRole: RoleCode.QUALITY_COMPLIANCE,
        involved: people(RoleCode.QUALITY_COMPLIANCE),
        dueAt: c.deliveredAt,
        goes: 'Patient events',
      });
      continue;
    }
    if (c.ready) continue;

    // One row per booking, named by its worst gate. A manager does not want
    // eleven rows for one implant; they want to know the implant is stuck and
    // on what.
    const worst = c.missing[0];
    out.push({
      id: `PAT:${c.bookingId}`,
      area: FailureArea.PATIENT,
      severity: FailureSeverity.STOPS,
      what: `${c.patientLabel} — ${c.treatmentName} is not ready`,
      because: c.headline,
      ownerRole: worst?.owner ?? null,
      involved: people(worst?.owner ?? null),
      dueAt: worst?.dueAt ?? null,
      goes: 'Patient events',
    });
  }

  /* ── Equipment ────────────────────────────────────────────────────── */
  const eq = input.equipment;
  if (eq) {
    // The register already grades every asset by what its failure stops, so
    // that is what decides the severity. A blanket STOPS would have put the
    // practice computer at the top of the manager's screen above an empty
    // autoclave — technically both "down", and one of them is why the clinic
    // cannot open.
    const bite = (c: string): FailureSeverity =>
      c === 'STOPS_CLINIC' ? FailureSeverity.STOPS
        : c === 'STOPS_WORK' ? FailureSeverity.HOLDS
          : FailureSeverity.WATCH;

    for (const rec of eq.down) {
      out.push({
        id: `EQ:DOWN:${rec.asset.tag}`,
        area: FailureArea.EQUIPMENT,
        severity: bite(rec.asset.criticality),
        what: `${rec.asset.name} is down`,
        because: `${rec.asset.tag} — reported out of service and not yet back.`,
        // The register names who is responsible for each asset. Sending every
        // fault to the manager would be a queue, not an owner.
        ownerRole: rec.asset.responsible,
        involved: people(rec.asset.responsible),
        dueAt: null,
        goes: 'Equipment',
      });
    }
    for (const rec of eq.unusable) {
      const blocking = rec.due.find((t) => t.blocks && t.overdue);
      out.push({
        id: `EQ:UNUSABLE:${rec.asset.tag}`,
        area: FailureArea.EQUIPMENT,
        severity: bite(rec.asset.criticality),
        what: `${rec.asset.name} may not be used`,
        because: blocking?.because ?? 'A cycle that blocks its use is overdue.',
        ownerRole: blocking?.owner ?? rec.asset.responsible,
        involved: people(blocking?.owner ?? rec.asset.responsible),
        dueAt: blocking?.dueAt ?? null,
        goes: 'Equipment',
      });
    }
    // Overdue and not blocking. Real, and the day continues around it.
    for (const t of eq.tasks.filter((x) => x.overdue && !x.blocks)) {
      out.push({
        id: `EQ:TASK:${t.assetTag}:${t.cycleId}`,
        area: FailureArea.EQUIPMENT,
        severity: FailureSeverity.WATCH,
        what: `${t.assetName} — ${t.label}`,
        because: t.because,
        ownerRole: t.owner,
        involved: people(t.owner),
        dueAt: t.dueAt,
        goes: 'Equipment',
      });
    }
  }

  /* ── Rooms withdrawn from allocation ──────────────────────────────── */
  //
  // *"If OPEN-004 Dental Chair = FAIL, that chair becomes NOT AVAILABLE FOR
  // PATIENT ALLOCATION."* This is that rule reaching the person holding the
  // appointment book, which is the only place it does any good — a withdrawn
  // room that only the equipment screen knows about is a room somebody will
  // still book at eleven o'clock.
  for (const room of input.rooms?.unavailable ?? []) {
    out.push({
      id: `ROOM:${room.operatoryId}`,
      area: FailureArea.EQUIPMENT,
      severity: FailureSeverity.STOPS,
      what: `${room.label} may not take a patient`,
      because: room.because,
      ownerRole: RoleCode.CLINIC_MANAGER,
      involved: people(RoleCode.CLINIC_MANAGER),
      dueAt: null,
      goes: 'Equipment',
    });
  }
  // A chair that protects no room is a broken link, and the only way anybody
  // finds out is if it is said out loud.
  for (const orphan of input.rooms?.orphaned ?? []) {
    out.push({
      id: `ROOM:ORPHAN:${orphan.asset.tag}`,
      area: FailureArea.EQUIPMENT,
      severity: FailureSeverity.HOLDS,
      what: `${orphan.asset.name} is filed under a room that does not exist`,
      because: `The register puts ${orphan.asset.tag} in "${orphan.asset.location}", `
        + 'which is not one of this clinic\'s operatories. Until that is fixed, '
        + 'a failure of this asset withdraws no room.',
      ownerRole: RoleCode.CLINIC_MANAGER,
      involved: people(RoleCode.CLINIC_MANAGER),
      dueAt: null,
      goes: 'Equipment',
    });
  }

  /* ── Stock ────────────────────────────────────────────────────────── */
  const inv = input.inventory;
  if (inv) {
    const stopping = new Set(inv.stopping.map((p) => p.item.sku));
    for (const p of inv.out) {
      out.push({
        id: `STK:OUT:${p.item.sku}`,
        area: FailureArea.STOCK,
        severity: stopping.has(p.item.sku) ? FailureSeverity.STOPS : FailureSeverity.HOLDS,
        what: `${p.item.name} is out of stock`,
        because: p.headline,
        ownerRole: RoleCode.INVENTORY_COORDINATOR,
        involved: people(RoleCode.INVENTORY_COORDINATOR),
        dueAt: null,
        goes: 'Equipment → Stock',
      });
    }
    // Never counted is not "we have none" and not "we have plenty". It is the
    // state the count exists to remove, and it has to read as its own thing.
    for (const p of inv.uncounted) {
      out.push({
        id: `STK:UNCOUNTED:${p.item.sku}`,
        area: FailureArea.STOCK,
        severity: FailureSeverity.HOLDS,
        what: `${p.item.name} has never been counted`,
        because: 'KuBi does not know how many there are, so it cannot say '
          + 'whether a case can have one.',
        ownerRole: RoleCode.INVENTORY_COORDINATOR,
        involved: people(RoleCode.INVENTORY_COORDINATOR),
        dueAt: null,
        goes: 'Equipment → Stock',
      });
    }
    for (const p of inv.reorder.filter((x) => !x.onOrder)) {
      out.push({
        id: `STK:REORDER:${p.item.sku}`,
        area: FailureArea.STOCK,
        severity: FailureSeverity.WATCH,
        what: `${p.item.name} is at its reorder point`,
        because: p.headline,
        ownerRole: RoleCode.INVENTORY_COORDINATOR,
        involved: people(RoleCode.INVENTORY_COORDINATOR),
        dueAt: null,
        goes: 'Equipment → Stock',
      });
    }
  }

  /* ── The evening ──────────────────────────────────────────────────── */
  const cl = input.closing;
  if (cl?.closingNow) {
    for (const b of cl.outstanding) {
      out.push({
        id: `CLOSE:${b.id}`,
        area: FailureArea.CLOSING,
        severity: b.critical ? FailureSeverity.STOPS : FailureSeverity.HOLDS,
        what: b.label,
        because: b.ifOutstanding,
        ownerRole: b.owner,
        involved: people(b.owner),
        dueAt: cl.shutAt,
        goes: 'Clinic closing',
      });
    }
  }

  return out.sort(worstFirst);
}

/**
 * The order the day is read in.
 *
 * Not an arbitrary list. It is the sequence a manager's questions actually
 * arrive in at 09:15 — *is my team here, is the clinic ready, are the patients
 * ready, what else is broken, and is the evening clear.* Anything else in
 * front of staffing is answering a question that has not been asked yet.
 */
const AREA_ORDER: Record<FailureArea, number> = {
  ATTENDANCE: 0, READINESS: 1, PATIENT: 2, EQUIPMENT: 3, STOCK: 4, CLOSING: 5,
};

/**
 * Worst first, and "worst" is three questions in order.
 *
 * Severity decides first, obviously. Then **the area**, and that one was
 * learned the hard way: sorting straight to the due time put a service overdue
 * by twenty-nine days above the sterilisation technician who was not in the
 * building. Both were genuinely stopping work, and only one of them was worth
 * saying first — an old overdue date is not urgency, it is history.
 *
 * Within an area, a failure with nobody holding its role comes before one
 * somebody is standing next to. That is the row still here at six o'clock.
 */
function worstFirst(x: FailingParameter, y: FailingParameter): number {
  if (RANK[x.severity] !== RANK[y.severity]) {
    return RANK[x.severity] - RANK[y.severity];
  }
  if (AREA_ORDER[x.area] !== AREA_ORDER[y.area]) {
    return AREA_ORDER[x.area] - AREA_ORDER[y.area];
  }
  if ((x.involved.length === 0) !== (y.involved.length === 0)) {
    return x.involved.length === 0 ? -1 : 1;
  }
  return (x.dueAt ?? Infinity) - (y.dueAt ?? Infinity);
}

/**
 * Who holds each role today, built from the attendance sheet.
 *
 * This is where the roster meets the rules. Everybody active is included,
 * including the people who are absent — because *"who is involved"* has to be
 * answerable with "nobody, she is on leave", and a map built only from the
 * people in the building can never say that.
 */
export function holdersFrom(a: AttendanceView): Map<RoleCode, Involved[]> {
  const map = new Map<RoleCode, Involved[]>();
  for (const p of a.people) {
    for (const role of p.roles) {
      const list = map.get(role) ?? [];
      list.push({
        employeeCode: p.employeeCode,
        label: p.label,
        state: p.state,
        note: p.headline,
      });
      map.set(role, list);
    }
  }
  return map;
}

const hhmm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/* -------------------------------------------------------------------------
 * Which places a role may reach
 * ---------------------------------------------------------------------- */

/**
 * The named places in the app.
 *
 * Held here rather than in the shell because *which screens a person may
 * reach* is an authorization statement, and constitution rule 3 puts those on
 * the server. The shell draws the rail it is handed; it does not decide it.
 */
export const Place = {
  DASHBOARD: 'DASHBOARD',
  READINESS: 'READINESS',
  PATIENT_EVENTS: 'PATIENT_EVENTS',
  EQUIPMENT: 'EQUIPMENT',
  CLOSING: 'CLOSING',
  MORE: 'MORE',
} as const;
export type Place = (typeof Place)[keyof typeof Place];

/**
 * What each role's app looks like.
 *
 * *"All the task should not be seen by all, only related, so that confusion
 * does not happen — so all the staff will have a different look of the app."*
 *
 * Read that as written: a **different look**, not a smaller one. The
 * housekeeper's app is not the manager's with rows greyed out; it is three
 * places instead of six, so the rail itself tells her what her job is. Every
 * role keeps the dashboard, because everybody is entitled to know where the
 * clinic is — what changes is what is on it.
 *
 * MORE is deliberately not universal. It is the drawer holding thirty
 * screens built for other people's work, and putting it on an assistant's rail
 * is exactly the confusion the owner asked to remove.
 */
const PLACES: Partial<Record<RoleCode, readonly Place[]>> = {
  [RoleCode.OWNER_DIRECTOR]: [
    Place.DASHBOARD, Place.READINESS, Place.PATIENT_EVENTS,
    Place.EQUIPMENT, Place.CLOSING, Place.MORE,
  ],
  [RoleCode.CLINIC_HEAD]: [
    Place.DASHBOARD, Place.READINESS, Place.PATIENT_EVENTS,
    Place.EQUIPMENT, Place.CLOSING, Place.MORE,
  ],
  [RoleCode.CLINIC_MANAGER]: [
    Place.DASHBOARD, Place.READINESS, Place.PATIENT_EVENTS,
    Place.EQUIPMENT, Place.CLOSING, Place.MORE,
  ],
  [RoleCode.QUALITY_COMPLIANCE]: [
    Place.DASHBOARD, Place.READINESS, Place.PATIENT_EVENTS, Place.MORE,
  ],
  // The doctor's day is patients. The morning is somebody else's job and the
  // equipment register is a place they would only ever visit to complain.
  [RoleCode.TREATING_DOCTOR]: [Place.DASHBOARD, Place.PATIENT_EVENTS],
  // Reception owns the front of the clinic and the book. They are on the
  // readiness list, so the morning is theirs too.
  [RoleCode.RECEPTION]: [Place.DASHBOARD, Place.READINESS, Place.PATIENT_EVENTS],
  // The equipment round is the senior assistant's and nobody else may report
  // it, so she is the only assistant with Equipment on her rail.
  [RoleCode.SENIOR_ASSISTANT]: [
    Place.DASHBOARD, Place.READINESS, Place.PATIENT_EVENTS,
    Place.EQUIPMENT, Place.CLOSING,
  ],
  [RoleCode.DENTAL_ASSISTANT]: [
    Place.DASHBOARD, Place.READINESS, Place.PATIENT_EVENTS, Place.CLOSING,
  ],
  [RoleCode.STERILIZATION_TECHNICIAN]: [
    Place.DASHBOARD, Place.READINESS, Place.EQUIPMENT, Place.CLOSING,
  ],
  // Three places. Her work is the morning and the evening, and a rail that
  // offered her the implant register would be telling her she had missed
  // something.
  [RoleCode.HOUSEKEEPING]: [Place.DASHBOARD, Place.READINESS, Place.CLOSING],
  [RoleCode.LAB_COORDINATOR]: [Place.DASHBOARD, Place.PATIENT_EVENTS],
  [RoleCode.INVENTORY_COORDINATOR]: [Place.DASHBOARD, Place.EQUIPMENT],
};

/**
 * The places this person may reach, given every role they hold.
 *
 * The union, because somebody who is both a senior assistant and the
 * inventory coordinator does both jobs and needs both rails. A role with no
 * entry gets the dashboard alone rather than everything: an unknown role is
 * the one case where guessing wide is a leak.
 */
export function placesFor(roles: readonly RoleCode[]): Place[] {
  const seen = new Set<Place>([Place.DASHBOARD]);
  for (const r of roles) for (const p of PLACES[r] ?? []) seen.add(p);
  const order: Place[] = [
    Place.DASHBOARD, Place.READINESS, Place.PATIENT_EVENTS,
    Place.EQUIPMENT, Place.CLOSING, Place.MORE,
  ];
  return order.filter((p) => seen.has(p));
}

/** Whether this person may open that place at all. Checked before rendering. */
export const mayOpen = (roles: readonly RoleCode[], place: Place): boolean =>
  placesFor(roles).includes(place);
