/**
 * The KPI layer: 16 control parameters rolled into one operational score.
 *
 * This is the screen the owner opens. The requirement is explicit about what
 * it is for — "management needs to see the exceptions, not 18 green ticks" —
 * so a parameter's score exists to decide whether it is worth looking at, and
 * the drill-down shows only what is wrong.
 *
 * Three rules, each guarding a specific way a dashboard lies:
 *
 *  1. GREY is not zero. A parameter with nothing to measure today scores
 *     `null`, draws as absent, and is excluded from the roll-up. Averaging an
 *     absence in fabricates a number; drawing it as 0% accuses the clinic of
 *     failing at something it was never asked to do.
 *
 *  2. A patient-safety failure is never averaged away. Nineteen routine ticks
 *     do not turn one missing consent into 95%. Any open patient-safety
 *     exception makes its parameter RED regardless of the arithmetic, because
 *     the number exists to provoke a decision, not to summarise.
 *
 *  3. Only confirmed work counts as done. COMPLETED is somebody saying they
 *     did it; VERIFIED is somebody else agreeing. The whole point of the
 *     verification layer is that the first is not the second.
 */
import type { TenantPrisma } from '../tenancy/rls-context.js';
import type { Clock } from '../../shared/clock.js';
import { ActivityStatus, ExceptionStatus, Parameter, RagStatus } from '@kubi/contracts';

export interface ParameterScore {
  parameter: Parameter;
  /** Null when there was nothing to measure. Never rendered as zero. */
  percent: number | null;
  status: RagStatus;
  done: number;
  total: number;
  /** Open exceptions filed against this parameter, worst first. */
  openProblems: number;
  patientSafetyProblems: number;
  /** Why it is not green, in one clinic-readable line. Null when it is. */
  because: string | null;
}

export interface OperationalHealth {
  /** The single number, across parameters that had something to measure. */
  percent: number | null;
  status: RagStatus;
  /** Ordered worst-first: what the owner should look at, in order. */
  parameters: ParameterScore[];
  needsAttention: { critical: number; attention: number };
}

/** Above this a parameter is green; below the second, red. */
const GREEN_AT = 95;
const AMBER_AT = 80;

/**
 * Which parameter an exception belongs to.
 *
 * Attention items raised from an activity inherit that activity's parameter.
 * Ones raised by an engine with no activity behind them — a stock shortage, a
 * service overdue — carry it on the item itself. Anything we genuinely cannot
 * place goes to QUALITY_CAPA rather than being dropped: an exception nobody
 * can see is worse than one filed under the wrong head.
 */
const UNPLACED = Parameter.QUALITY_CAPA;

function rag(percent: number | null, hasPatientSafety: boolean): RagStatus {
  if (hasPatientSafety) return RagStatus.RED;
  if (percent === null) return RagStatus.GREY;
  if (percent >= GREEN_AT) return RagStatus.GREEN;
  if (percent >= AMBER_AT) return RagStatus.AMBER;
  return RagStatus.RED;
}

/** One line saying why, in the clinic's words. Null when there is no why. */
function because(s: {
  patientSafety: number; open: number; total: number; done: number;
}): string | null {
  if (s.patientSafety > 0) {
    return s.patientSafety === 1
      ? 'A patient safety problem is open.'
      : `${s.patientSafety} patient safety problems are open.`;
  }
  const outstanding = s.total - s.done;
  if (outstanding > 0 && s.open > 0) {
    return `${outstanding} not confirmed, ${s.open} ${s.open === 1 ? 'problem' : 'problems'} open.`;
  }
  if (outstanding > 0) {
    return `${outstanding} of ${s.total} not confirmed yet.`;
  }
  if (s.open > 0) {
    return `${s.open} ${s.open === 1 ? 'problem' : 'problems'} still open.`;
  }
  return null;
}

export async function buildOperationalHealth(
  tx: TenantPrisma,
  clock: Clock,
  clinicId: string,
  periodKey: string,
): Promise<OperationalHealth> {
  const instances = await tx.activityInstance.findMany({
    where: { clinicId, periodKey },
    select: { status: true, definition: { select: { parameter: true } } },
  });

  const problems = await tx.attentionItem.findMany({
    where: {
      clinicId,
      status: {
        in: [ExceptionStatus.OPEN, ExceptionStatus.ACKNOWLEDGED, ExceptionStatus.ACTION_IN_PROGRESS],
      },
    },
    select: {
      severity: true,
      sourceInstance: { select: { definition: { select: { parameter: true } } } },
    },
  });

  const scores: ParameterScore[] = Object.values(Parameter).map((parameter) => {
    const mine = instances.filter((i) => i.definition.parameter === parameter);
    // Confirmed by someone, not merely claimed by the doer.
    const done = mine.filter((i) => i.status === ActivityStatus.VERIFIED).length;

    const myProblems = problems.filter(
      (p) => (p.sourceInstance?.definition.parameter ?? UNPLACED) === parameter,
    );
    const patientSafety = myProblems.filter((p) => p.severity === 'PATIENT_SAFETY').length;

    // Nothing to measure is nothing to measure — not a zero, and not a pass.
    const percent = mine.length === 0 ? null : Math.round((done / mine.length) * 100);

    return {
      parameter,
      percent,
      status: rag(percent, patientSafety > 0),
      done,
      total: mine.length,
      openProblems: myProblems.length,
      patientSafetyProblems: patientSafety,
      because: because({
        patientSafety, open: myProblems.length, total: mine.length, done,
      }),
    };
  });

  // The roll-up covers only parameters that had something to measure. A clinic
  // running five of sixteen parameters today is not at 31% health.
  const measured = scores.filter((s) => s.percent !== null);
  const overall = measured.length === 0
    ? null
    : Math.round(measured.reduce((n, s) => n + s.percent!, 0) / measured.length);

  const anyPatientSafety = scores.some((s) => s.patientSafetyProblems > 0);

  // Worst first: red before amber before green, and within a band the one with
  // the most open problems. Grey sinks to the bottom — there is nothing there
  // to act on, and it must not push a real problem below the fold.
  const RANK: Record<RagStatus, number> = {
    [RagStatus.RED]: 0, [RagStatus.AMBER]: 1, [RagStatus.GREEN]: 2, [RagStatus.GREY]: 3,
  };
  scores.sort((a, b) =>
    RANK[a.status] - RANK[b.status]
    || b.patientSafetyProblems - a.patientSafetyProblems
    || b.openProblems - a.openProblems
    || (a.percent ?? 101) - (b.percent ?? 101));

  return {
    percent: overall,
    status: rag(overall, anyPatientSafety),
    parameters: scores,
    needsAttention: {
      // The owner's two buckets. Patient safety and critical are one thing to
      // an owner — both mean "today, by you" — and the split that matters is
      // between that and everything which can wait.
      critical: problems.filter(
        (p) => p.severity === 'PATIENT_SAFETY' || p.severity === 'CRITICAL',
      ).length,
      attention: problems.filter(
        (p) => p.severity !== 'PATIENT_SAFETY' && p.severity !== 'CRITICAL',
      ).length,
    },
  };
}
