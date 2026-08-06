/**
 * The retention loop: find the patients who stopped, ring them, record what
 * they said, and stop ringing the ones who answered.
 *
 * SG-T.4 from the staff guidelines, with the owner's thirty days. The rule
 * itself lives in `packages/contracts/src/retention.ts` as arithmetic on
 * dates; this file is only the part that needs a database — reading the facts
 * the rule needs, and writing down the call.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Why the list is computed and never stored
 * ─────────────────────────────────────────────────────────────────────────
 *
 * A `dormant` column would be wrong within the hour: the patient books, and
 * the flag says otherwise until something remembers to clear it. Nothing ever
 * remembers. So dormancy is recomputed on every read, and the only thing that
 * persists is the outreach — a fact about a phone call, which does not go
 * stale.
 *
 * The cost is a query per read rather than an index lookup. At the size of one
 * clinic that is a few thousand rows and it is not close to mattering; the
 * comment is here so that whoever finds it slow knows what the tradeoff was
 * before they add the column back.
 */
import {
  dormancyOf, retentionOrder, CLOSING_OUTCOMES, OutreachOutcome,
  RetentionReason, DORMANT_AFTER_DAYS, RECONSIDER_AFTER_DAYS,
  type Dormancy, type PatientActivity,
} from '@kubi/contracts';
import type { TenantPrisma } from '../../platform/tenancy/rls-context.js';
import type { Clock } from '../../shared/clock.js';

export class RetentionError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'RetentionError';
  }
}

/** A row on the doctor's list: who, why, how long, and what was tried. */
export interface RetentionItem extends Dormancy {
  patientLabel: string;
  uhid: string;
  /** An open outreach for this patient, if somebody has already picked it up. */
  outreach: {
    id: string;
    raisedAt: Date;
    contactedAt: Date | null;
    outcome: string | null;
    note: string | null;
  } | null;
}

/** Attendance is what the patient did, not what was booked for them. */
const ATTENDED = ['ARRIVED', 'IN_CHAIR', 'COMPLETED'];

export class RetentionService {
  constructor(private readonly clock: Clock) {}

  /**
   * Everything the rule needs, for every patient in the clinic, in four
   * grouped queries rather than N+1.
   *
   * Deliberately not a single clever join. The four aggregates answer four
   * different questions — when did they last come, what is booked, what is
   * planned, what is unfinished — and a join that produced all four at once
   * would have to be read very carefully to be believed. These can be checked
   * one at a time.
   */
  private async activity(tx: TenantPrisma, clinicId: string): Promise<PatientActivity[]> {
    const now = this.clock.now();

    const [patients, attended, booked, procedures] = await Promise.all([
      tx.patient.findMany({ where: { clinicId }, select: { id: true } }),
      tx.appointment.groupBy({
        by: ['patientId'],
        where: { clinicId, status: { in: ATTENDED } },
        _max: { scheduledStart: true },
      }),
      tx.appointment.groupBy({
        by: ['patientId'],
        where: { clinicId, status: 'BOOKED', scheduledStart: { gte: now } },
        _min: { scheduledStart: true },
      }),
      tx.patientProcedure.groupBy({
        by: ['patientId', 'status'],
        where: { clinicId },
        _count: { _all: true },
      }),
    ]);

    const lastVisit = new Map(attended.map((a) => [a.patientId, a._max.scheduledStart]));
    const nextVisit = new Map(booked.map((b) => [b.patientId, b._min.scheduledStart]));

    const counts = new Map<string, { planned: number; started: number; completed: number }>();
    for (const row of procedures) {
      const c = counts.get(row.patientId) ?? { planned: 0, started: 0, completed: 0 };
      // Anything not yet begun counts as planned; anything begun and not
      // finished counts as started. Statuses KuBi does not know about are
      // counted as neither, rather than guessed into one — a patient does not
      // belong on a doctor's call list because of a status nobody recognised.
      if (row.status === 'PLANNED') c.planned += row._count._all;
      else if (row.status === 'IN_PROGRESS') c.started += row._count._all;
      else if (row.status === 'COMPLETED') c.completed += row._count._all;
      counts.set(row.patientId, c);
    }

    return patients.map((p) => {
      const c = counts.get(p.id) ?? { planned: 0, started: 0, completed: 0 };
      const last = lastVisit.get(p.id) ?? null;
      const next = nextVisit.get(p.id) ?? null;
      return {
        patientId: p.id,
        lastAttendedAt: last ? last.getTime() : null,
        nextBookedAt: next ? next.getTime() : null,
        plannedNotStarted: c.planned,
        startedNotCompleted: c.started,
        completed: c.completed,
      };
    });
  }

  /**
   * The list, ordered for a doctor: unfinished treatment first, then longest
   * gone.
   *
   * Patients whose outreach was closed with a real answer do not reappear.
   * DECLINED means they said no; putting them back next month because the
   * arithmetic still says thirty days is how a follow-up list becomes a
   * nuisance and then gets ignored entirely.
   */
  async list(tx: TenantPrisma, clinicId: string): Promise<RetentionItem[]> {
    const now = this.clock.now().getTime();
    const activity = await this.activity(tx, clinicId);

    const dormant = activity
      .map((a) => dormancyOf(a, now))
      .filter((d): d is Dormancy => d !== null);
    if (dormant.length === 0) return [];

    const ids = dormant.map((d) => d.patientId);
    const [outreach, patients] = await Promise.all([
      tx.retentionOutreach.findMany({
        where: { clinicId, patientId: { in: ids } },
        orderBy: { raisedAt: 'desc' },
      }),
      tx.patient.findMany({
        where: { id: { in: ids } },
        select: { id: true, displayLabel: true, uhid: true },
      }),
    ]);

    const byPatient = new Map<string, typeof outreach>();
    for (const o of outreach) {
      byPatient.set(o.patientId, [...(byPatient.get(o.patientId) ?? []), o]);
    }
    const labels = new Map(patients.map((p) => [p.id, p]));

    const items: RetentionItem[] = [];
    for (const d of dormant) {
      const history = byPatient.get(d.patientId) ?? [];
      const open = history.find((o) => o.closedAt === null) ?? null;

      // Closed with a real answer, and recently enough that the answer still
      // stands. WILL_DECIDE is closed for the reconsider interval and then
      // becomes eligible again; DECLINED never does.
      const settled = history.find((o) => {
        if (o.closedAt === null) return false;
        if (o.outcome === OutreachOutcome.WILL_DECIDE) {
          const days = (now - o.closedAt.getTime()) / (24 * 60 * 60 * 1000);
          return days < RECONSIDER_AFTER_DAYS;
        }
        return CLOSING_OUTCOMES.includes(o.outcome as OutreachOutcome);
      });
      if (settled && !open) continue;

      const p = labels.get(d.patientId);
      items.push({
        ...d,
        patientLabel: p?.displayLabel ?? 'Unknown patient',
        uhid: p?.uhid ?? '',
        outreach: open
          ? {
            id: open.id,
            raisedAt: open.raisedAt,
            contactedAt: open.contactedAt,
            outcome: open.outcome,
            note: open.note,
          }
          : null,
      });
    }

    return items.sort(retentionOrder);
  }

  /**
   * Claim a patient from the list, so two doctors do not both ring them.
   *
   * The uniqueness is a partial index in the database, not a check here. Two
   * requests can both read "no open outreach" in the same millisecond; only
   * one can insert. The loser is told plainly rather than shown a duplicate.
   */
  async open(
    tx: TenantPrisma, clinicId: string, organizationId: string, patientId: string,
  ): Promise<{ id: string }> {
    const now = this.clock.now().getTime();
    const activity = await this.activity(tx, clinicId);
    const mine = activity.find((a) => a.patientId === patientId);
    if (!mine) throw new RetentionError('No such patient in this clinic', 'PATIENT_NOT_FOUND');

    // Re-checked server-side at the moment of claiming. The list the doctor is
    // looking at may be minutes old, and in those minutes the patient may have
    // booked — in which case there is nothing to ring them about.
    const dormancy = dormancyOf(mine, now);
    if (!dormancy) {
      throw new RetentionError(
        `This patient is no longer dormant — they have attended or booked within ${DORMANT_AFTER_DAYS} days`,
        'NOT_DORMANT',
      );
    }

    try {
      const row = await tx.retentionOutreach.create({
        data: {
          organizationId,
          clinicId,
          patientId,
          reason: dormancy.reason,
          daysDormant: dormancy.daysSinceLastVisit,
        },
        select: { id: true },
      });
      return row;
    } catch (e) {
      if (e instanceof Error && 'code' in e && (e as { code?: string }).code === 'P2002') {
        throw new RetentionError('Somebody is already following this patient up', 'ALREADY_OPEN');
      }
      throw e;
    }
  }

  /**
   * Record what the patient said.
   *
   * The outcome decides whether the loop closes; the caller does not get to
   * say. NO_ANSWER and UNREACHABLE leave it open because nobody has spoken to
   * the patient yet, and an unanswered phone is not a decision they made.
   */
  async record(
    tx: TenantPrisma, clinicId: string, outreachId: string,
    outcome: OutreachOutcome, employeeId: string, note?: string,
  ): Promise<void> {
    const existing = await tx.retentionOutreach.findFirst({
      where: { id: outreachId, clinicId },
      select: { id: true, closedAt: true },
    });
    if (!existing) throw new RetentionError('No such outreach', 'NOT_FOUND');
    if (existing.closedAt) {
      throw new RetentionError('This follow-up is already closed', 'ALREADY_CLOSED');
    }

    const now = this.clock.now();
    const closes = CLOSING_OUTCOMES.includes(outcome)
      || outcome === OutreachOutcome.WILL_DECIDE;

    await tx.retentionOutreach.update({
      where: { id: outreachId },
      data: {
        contactedAt: now,
        contactedByEmployeeId: employeeId,
        outcome,
        ...(note === undefined ? {} : { note }),
        ...(closes ? { closedAt: now } : {}),
      },
    });
  }

  /**
   * The two numbers worth putting on a management screen.
   *
   * Not a conversion rate. The list is small and the denominator moves every
   * day; a percentage computed over it would swing wildly and mean nothing.
   * Two counts and a period are honest at this size.
   */
  async summary(tx: TenantPrisma, clinicId: string): Promise<{
    dormant: number;
    midTreatment: number;
    contactedThisMonth: number;
    returningThisMonth: number;
  }> {
    const items = await this.list(tx, clinicId);
    const monthAgo = new Date(this.clock.now().getTime() - 30 * 24 * 60 * 60 * 1000);

    const [contacted, returning] = await Promise.all([
      tx.retentionOutreach.count({ where: { clinicId, contactedAt: { gte: monthAgo } } }),
      tx.retentionOutreach.count({
        where: { clinicId, contactedAt: { gte: monthAgo }, outcome: OutreachOutcome.RETURNING },
      }),
    ]);

    return {
      dormant: items.length,
      midTreatment: items.filter((i) => i.reason === RetentionReason.STOPPED_MID_TREATMENT).length,
      contactedThisMonth: contacted,
      returningThisMonth: returning,
    };
  }
}
