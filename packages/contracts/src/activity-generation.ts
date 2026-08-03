/**
 * The master activity engine — the library generating today's work.
 *
 * Module 2. Until now the 101 activities were browsable and inert: a
 * reference, not a schedule. This turns the frozen matrix into a day.
 *
 * Every decision here is about *not* generating something:
 *
 *   - An activity with no due rule generates nothing. A guessed time looks
 *     like a decision somebody made.
 *   - A weekly activity generates on its own day, not every day.
 *   - Only the TIME engine generates on a schedule. Patient events, conditions
 *     and gates are raised by things happening, so a scheduler that produced
 *     them would be inventing patients.
 *
 * That last one is the important one. A generator that emitted all 101 rows
 * every morning would look impressively busy and would be lying about most
 * of them.
 */
import type { LibraryActivity } from './activity-library.js';

/** 1 = Monday … 7 = Sunday, matching the clinic-local weekday helper. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface GenerationContext {
  /** Clinic-local date, midnight. Never `new Date()` — inject it. */
  today: Date;
  weekday: Weekday;
  /** Day of month, 1–31. */
  dayOfMonth: number;
  /** Whether the clinic is open at all today. A shut day generates nothing. */
  clinicOpen: boolean;
}

export interface GeneratedTask {
  activityId: string;
  title: string;
  standard: string | null;
  fn: string;
  origin: string;
  engine: string;
  /** In the clinic's own words, straight from the matrix. */
  due: string;
  doer: string | null;
  checker: string | null;
  owner: string | null;
  escalation: string[];
  priority: string;
  evidenceType: string | null;
  kpi: string | null;
  /** Why this appeared today, for the person looking at it. */
  because: string;
}

/**
 * Does this activity fall due today?
 *
 * Returns a reason string when it does, and null when it does not — so the
 * caller can always say why something is on the list, and a bug shows up as a
 * wrong sentence rather than a silently missing task.
 */
export function fallsDueToday(a: LibraryActivity, ctx: GenerationContext): string | null {
  if (!ctx.clinicOpen) return null;
  // Non-negotiable 4: an undecided due rule is not a schedule.
  if (!a.enabled || a.dueRule === null) return null;
  // Only the clock generates. Everything else waits to be caused.
  if (a.origin !== 'RECURRING') return null;

  const freq = (a.frequency ?? '').toUpperCase();

  if (freq === 'DAILY' || freq === 'PER_SHIFT' || freq === 'CONTINUOUS') {
    return 'Due every clinic day';
  }
  if (freq === 'WEEKLY') {
    // Monday, unless the matrix names a day. One fixed day beats "some time
    // this week", which is how weekly work quietly becomes fortnightly.
    return ctx.weekday === 1 ? 'Due weekly, on Monday' : null;
  }
  if (freq === 'MONTHLY') {
    return ctx.dayOfMonth === 1 ? 'Due monthly, on the first' : null;
  }
  if (freq === 'QUARTERLY') {
    const quarterStart = ctx.today.getMonth() % 3 === 0;
    return quarterStart && ctx.dayOfMonth === 1 ? 'Due quarterly' : null;
  }
  if (freq === 'YEARLY' || freq === 'ANNUAL') {
    return ctx.today.getMonth() === 0 && ctx.dayOfMonth === 1 ? 'Due yearly' : null;
  }
  // AS_REQUIRED, PER_PLAN, PER_FAILURE and the rest are not a schedule — they
  // are raised by something happening, which is a different engine's job.
  return null;
}

/** Today's work, from the library. */
export function generateToday(
  library: readonly LibraryActivity[], ctx: GenerationContext,
): GeneratedTask[] {
  const out: GeneratedTask[] = [];
  for (const a of library) {
    const because = fallsDueToday(a, ctx);
    if (because === null) continue;
    out.push({
      activityId: a.id,
      title: a.activity,
      standard: a.standard,
      fn: a.fn,
      origin: a.origin,
      engine: a.engine,
      due: a.dueRule!,
      doer: a.doer,
      checker: a.checker,
      owner: a.owner,
      escalation: a.escalation,
      priority: a.priority ?? 'ROUTINE',
      evidenceType: a.evidenceType,
      kpi: a.kpi,
      because,
    });
  }
  // Most serious first. Within a class, matrix order — which is the order the
  // clinic wrote them in, and reads as the order of the day.
  const rank: Record<string, number> = {
    PATIENT_SAFETY: 0, CRITICAL: 1, IMPORTANT: 2, ROUTINE: 3,
  };
  return out.sort((x, y) => (rank[x.priority] ?? 9) - (rank[y.priority] ?? 9));
}

/** Today's work for one person, by the role name the matrix uses. */
export function generateForRole(
  library: readonly LibraryActivity[], ctx: GenerationContext, roleName: string,
): GeneratedTask[] {
  return generateToday(library, ctx).filter((t) => t.doer === roleName);
}

/** What one person must check today — never their own work. */
export function checksForRole(
  library: readonly LibraryActivity[], ctx: GenerationContext, roleName: string,
): GeneratedTask[] {
  return generateToday(library, ctx)
    .filter((t) => t.checker === roleName && t.doer !== roleName);
}
