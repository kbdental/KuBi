/**
 * VS-03 — what tomorrow inherits.
 *
 * Closing a clinic is not "tick the last box". It is answering, honestly, what
 * is being left behind: what did not get done, what is still waiting on
 * someone, and what a patient was told. A day that ends with an unfinished
 * sterilisation run and nobody knowing is how a Monday goes wrong.
 *
 * This is deliberately a READ. It computes nothing new and decides nothing —
 * it collects what the day already recorded and states it plainly, so the
 * person locking up sees the same picture as the person unlocking tomorrow.
 *
 * Counts and plain text only. No names on any of it (usability review Q6):
 * a handover is about what is outstanding, not about who to blame for it.
 */
import type { TenantPrisma } from '../tenancy/rls-context.js';
import type { Clock } from '../../shared/clock.js';
import { ActivityStatus, ExceptionStatus } from '@kubi/contracts';

export interface HandoverLine {
  /** Plain clinic language, ready to render. */
  headline: string;
  detail: string | null;
  /** How much this matters, reusing the severities staff already know. */
  severity: 'PATIENT_SAFETY' | 'CRITICAL' | 'IMPORTANT' | 'ROUTINE';
}

export interface Handover {
  periodKey: string;
  /** True when nothing is being carried into tomorrow. */
  clear: boolean;
  unfinished: HandoverLine[];
  waitingOnSomeone: HandoverLine[];
  stillOpen: HandoverLine[];
  /** Visits that did not happen, which reception will be asked about. */
  patientsNotSeen: HandoverLine[];
}

/** Highest severity first — the order a person reads a handover in. */
const RANK = { PATIENT_SAFETY: 0, CRITICAL: 1, IMPORTANT: 2, ROUTINE: 3 } as const;
const bySeverity = (a: HandoverLine, b: HandoverLine) =>
  (RANK[a.severity] ?? 9) - (RANK[b.severity] ?? 9);

function asSeverity(value: string): HandoverLine['severity'] {
  return value === 'PATIENT_SAFETY' || value === 'CRITICAL' || value === 'IMPORTANT'
    ? value
    : 'ROUTINE';
}

export async function buildHandover(
  tx: TenantPrisma,
  _clock: Clock,
  clinicId: string,
  periodKey: string,
): Promise<Handover> {
  const instances = await tx.activityInstance.findMany({
    where: { clinicId, periodKey },
    include: { definition: true },
    orderBy: { dueAt: 'asc' },
  });

  // Never finished at all. The thing a closing checklist exists to surface.
  const unfinished: HandoverLine[] = instances
    .filter((i) => i.status === ActivityStatus.DUE
      || i.status === ActivityStatus.IN_PROGRESS
      || i.status === ActivityStatus.OVERDUE)
    .map((i) => ({
      headline: i.definition.title,
      detail: i.blockedByItemId
        ? 'On hold — a problem was reported and is not sorted yet.'
        : i.definition.failureDefinition,
      severity: asSeverity(i.definition.priority),
    }))
    .sort(bySeverity);

  // Done, but nobody has confirmed it. Distinct from unfinished, because the
  // work happened — what is missing is the second pair of eyes.
  const waitingOnSomeone: HandoverLine[] = instances
    .filter((i) => i.status === ActivityStatus.COMPLETED)
    .map((i) => ({
      headline: i.definition.title,
      detail: 'Finished, but still waiting for someone to confirm it.',
      severity: asSeverity(i.definition.priority),
    }))
    .sort(bySeverity);

  const open = await tx.attentionItem.findMany({
    where: {
      clinicId,
      status: {
        in: [ExceptionStatus.OPEN, ExceptionStatus.ACKNOWLEDGED, ExceptionStatus.ACTION_IN_PROGRESS],
      },
    },
    orderBy: { severity: 'asc' },
  });
  const stillOpen: HandoverLine[] = open
    .map((a) => ({
      headline: a.headline,
      detail: a.detail,
      severity: asSeverity(a.severity),
    }))
    .sort(bySeverity);

  // A patient who did not get seen is a fact the next morning needs, and the
  // one thing on this list that a person outside the clinic is waiting on.
  const missed = await tx.appointment.findMany({
    where: { clinicId, periodKey, status: { in: ['BOOKED', 'ARRIVED', 'NO_SHOW'] } },
    orderBy: { scheduledStart: 'asc' },
  });
  const patientsNotSeen: HandoverLine[] = missed.map((m) => ({
    headline: `${m.visitType} was not seen`,
    detail: m.status === 'NO_SHOW'
      ? 'Marked as not arrived.'
      : m.status === 'ARRIVED'
        ? 'Arrived but never went through — needs a call.'
        : 'Still expected, and the day has ended.',
    severity: m.status === 'ARRIVED' ? 'CRITICAL' : 'IMPORTANT',
  }));

  return {
    periodKey,
    clear: unfinished.length === 0
      && waitingOnSomeone.length === 0
      && stillOpen.length === 0
      && patientsNotSeen.length === 0,
    unfinished,
    waitingOnSomeone,
    stillOpen,
    patientsNotSeen,
  };
}
